import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: Refloat edits and position survive a destroyed frontend`, { timeout: 60000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.requestPermission', {});
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scan = await client.waitForState((s) => s.discoveredDevices.length > 0);
      await client.request('device.connect', { deviceId: scan.discoveredDevices[0]!.deviceId, trackingMode: 'saved' });
      const state = await client.waitForState((s) => s.activeConnection?.state === 'ready');
      const deviceId = state.activeConnection!.deviceId;
      const context = await browser.newContext({ viewport: { width: 390, height: 600 }, hasTouch: true });
      if (name === 'chromium') await context.grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await context.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      const mutations: string[] = [];
      const reads: Array<{ source: string; refresh?: boolean }> = [];
      const errors: string[] = [];
      await context.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => socket.send(raw));
        socket.onMessage((raw) => {
          const request = JSON.parse(String(raw));
          if (request.method === 'refloat.configuration.read') reads.push(request.params);
          if (request.method === 'refloat.configuration.write' || request.method === 'refloat.tune.apply')
            mutations.push(request.method);
          server.send(raw);
        });
      });
      let page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${endpoint.origin}/`);
      await page.getByRole('button', { name: 'Board actions', exact: true }).tap();
      await page.getByRole('button', { name: 'Configure Refloat', exact: true }).tap();
      const number = () => page.getByRole('spinbutton', { name: 'Duty Tiltback', exact: true });
      await number().fill('85');
      await page.getByRole('heading', { name: 'Duty Pushback', level: 4, exact: true }).waitFor();
      const controls = () => page.getByRole('button', { name: 'Section and search controls', exact: true });
      const section = () => page.locator('select[aria-label="Section"]');
      assert.equal(await controls().getAttribute('aria-expanded'), 'false');
      const balanceKey = await section().inputValue();
      const startupKey = await section()
        .locator('option')
        .filter({ hasText: 'Startup defaults' })
        .getAttribute('value');
      assert.ok(startupKey);
      // Native select popups are outside Playwright's page surface; use its selection API.
      await section().selectOption(startupKey);
      await page.getByRole('heading', { name: 'Lighting · Startup defaults', exact: true }).waitFor();
      const lightsHeading = page.getByRole('heading', { name: 'Lights', level: 4, exact: true });
      const headlightsHeading = page.getByRole('heading', { name: 'Headlights', level: 4, exact: true });
      await lightsHeading.waitFor();
      await headlightsHeading.waitFor();
      for (const width of [390, 1024]) {
        await page.setViewportSize({ width, height: 600 });
        const lights = await lightsHeading.boundingBox();
        const headlights = await headlightsHeading.boundingBox();
        assert.ok(lights && headlights);
        assert.ok(Math.abs(lights.x - headlights.x) < 1);
        assert.ok(Math.abs(lights.width - headlights.width) < 1);
        const grid = await lightsHeading.locator('..').boundingBox();
        assert.ok(grid);
        assert.ok(Math.abs(lights.width - grid.width) < 1, 'subsection headings must span the control grid');
      }
      await page.setViewportSize({ width: 390, height: 600 });
      assert.equal(await controls().getAttribute('aria-expanded'), 'false');
      await section().selectOption(balanceKey);
      await number().waitFor();
      assert.equal(await section().inputValue(), balanceKey);
      assert.equal(await controls().getAttribute('aria-expanded'), 'false');
      await controls().dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
      await controls().dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
      assert.equal(await controls().getAttribute('aria-expanded'), 'false');
      await controls().tap();
      assert.equal(await controls().getAttribute('aria-expanded'), 'true');
      await page.getByRole('button', { name: 'Startup defaults', exact: true }).tap();
      await page
        .getByRole('group', { name: 'LEDs On (persistent startup default)', exact: true })
        .getByRole('button', { name: 'Off', exact: true })
        .tap();
      await page.getByRole('searchbox').fill('Headlights');
      await headlightsHeading.waitFor();
      assert.equal(await lightsHeading.count(), 0);
      await page.getByRole('searchbox').fill('on');
      await lightsHeading.waitFor();
      await headlightsHeading.waitFor();
      await page.getByRole('button', { name: 'Section and search controls', exact: true }).tap();
      await page.getByRole('searchbox').waitFor({ state: 'hidden' });
      const scroller = () =>
        page
          .locator('div.overflow-y-auto')
          .filter({ has: page.getByRole('heading', { name: 'Lighting · Startup defaults', exact: true }) });
      await page.setViewportSize({ width: 390, height: 300 });
      const { pinnedLights, releasedLights, pinnedHeadlights } = await scroller().evaluate((el) => {
        const [lights, headlights] = el.querySelectorAll('h4');
        el.scrollTop = 0;
        const top = el.getBoundingClientRect().top;
        const lightsStart = lights!.getBoundingClientRect().top - top;
        const headlightsStart = headlights!.getBoundingClientRect().top - top;
        el.scrollTop = lightsStart + 12;
        const pinnedLights = lights!.getBoundingClientRect().top - top;
        el.scrollTop = headlightsStart + 12;
        return {
          pinnedLights,
          releasedLights: lights!.getBoundingClientRect().bottom - top,
          pinnedHeadlights: headlights!.getBoundingClientRect().top - top,
        };
      });
      assert.ok(
        Math.abs(pinnedLights) < 1,
        `Lights stays at the top while its fields scroll (offset: ${pinnedLights})`
      );
      assert.ok(releasedLights <= 0, `Lights leaves the scrollport at the next subsection (offset: ${releasedLights})`);
      assert.ok(Math.abs(pinnedHeadlights) < 1, `Headlights takes the sticky position (offset: ${pinnedHeadlights})`);
      await page.setViewportSize({ width: 390, height: 320 });
      await scroller().evaluate((el) => {
        el.scrollTop = 60;
      });
      const waitDraft = async (predicate: (draft: NonNullable<Awaited<ReturnType<typeof readDraft>>>) => boolean) => {
        for (let i = 0; i < 100; i++) {
          const draft = await readDraft();
          if (draft && predicate(draft)) return draft;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Draft was not saved');
      };
      const readDraft = () => client.request('refloat.configuration.draft.get', { deviceId });
      const saved = await waitDraft(
        (d) =>
          d.values['leds.on']?.value === false &&
          d.position.search === 'on' &&
          !d.position.controlsExpanded &&
          d.position.scrollTop > 0
      );
      await page.close();
      page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: 390, height: 320 });
      await page.goto(`${endpoint.origin}/`);
      await page.getByRole('dialog', { name: 'Configure Refloat', exact: true }).waitFor();
      await page.getByText('Draft restored · 2 changes', { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Section and search controls', exact: true })
          .getAttribute('aria-expanded'),
        'false'
      );
      assert.ok(Math.abs((await scroller().evaluate((el) => el.scrollTop)) - saved.position.scrollTop) < 2);
      // A secondary pointer must not activate the collapse control; keyboard activates once.
      await page
        .getByRole('button', { name: 'Section and search controls', exact: true })
        .dispatchEvent('pointerdown', { button: 2, isPrimary: true });
      assert.equal(
        await page
          .getByRole('button', { name: 'Section and search controls', exact: true })
          .getAttribute('aria-expanded'),
        'false'
      );
      await page.setViewportSize({ width: 390, height: 600 });
      await page.getByRole('button', { name: 'Section and search controls', exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('searchbox').inputValue(), 'on');
      assert.equal(
        await page.getByRole('button', { name: 'Startup defaults', exact: true }).getAttribute('aria-pressed'),
        'true'
      );
      await page.getByRole('searchbox').fill('');
      await page.getByRole('button', { name: 'Balance', exact: true }).tap();
      assert.equal(await number().inputValue(), '85');
      await number().fill('');
      await waitDraft((d) => d.inputs.tiltback_duty === '');
      await page.close();
      page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${endpoint.origin}/`);
      await number().waitFor();
      assert.equal(await number().inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Write configuration', exact: true }).isDisabled(), true);
      const disabledWrite = page.getByRole('button', { name: 'Write configuration', exact: true });
      const writeBounds = await disabledWrite.boundingBox();
      assert.ok(writeBounds);
      // Tap coordinates directly: locator.tap() waits for disabled controls to become enabled.
      await page.touchscreen.tap(writeBounds.x + writeBounds.width / 2, writeBounds.y + writeBounds.height / 2);
      await disabledWrite.dispatchEvent('pointerdown', { button: 0, isPrimary: true, pointerId: 7 });
      await disabledWrite.dispatchEvent('pointerup', { button: 0, isPrimary: true, pointerId: 7 });
      await disabledWrite.dispatchEvent('click', { detail: 0 });
      assert.equal(
        await page.getByRole('alertdialog', { name: 'Write persistent Refloat configuration?' }).count(),
        0,
        'disabled write button opened the confirmation'
      );
      assert.equal(reads.length, 3);
      assert.ok(
        reads.every((read) => read.refresh === false),
        'restoration requested fresh board reads'
      );
      await page.getByRole('button', { name: 'Read current', exact: true }).tap();
      await waitDraft(
        (d) => Object.keys(d.inputs).length === 0 && d.values.tiltback_duty?.value === 0.8 && d.source === 'current'
      );
      assert.equal(await number().inputValue(), '80');
      await number().fill('86');
      await page.getByRole('button', { name: 'Read defaults', exact: true }).tap();
      await waitDraft(
        (d) => Object.keys(d.inputs).length === 0 && d.values.tiltback_duty?.value === 0.8 && d.source === 'default'
      );
      assert.equal(await number().inputValue(), '80');
      assert.deepEqual(reads.slice(-2), [
        { source: 'current', refresh: true },
        { source: 'default', refresh: true },
      ]);
      assert.equal(await page.getByRole('button', { name: 'Discard changes', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Done', exact: true }).tap();
      assert.equal(await page.getByRole('dialog', { name: /Discard/ }).count(), 0);
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
  test(`${name}: numeric edits and write failures stay consistent`, { timeout: 60000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.requestPermission', {});
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scan = await client.waitForState((s) => s.discoveredDevices.length > 0);
      await client.request('device.connect', {
        deviceId: scan.discoveredDevices[0]!.deviceId,
        trackingMode: 'saved',
      });
      await client.waitForState((s) => s.activeConnection?.state === 'ready');
      const context = await browser.newContext({ viewport: { width: 390, height: 600 }, hasTouch: true });
      if (name === 'chromium') await context.grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await context.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      const current = await client.request('refloat.configuration.read', { source: 'current', refresh: true });
      let failWrite = true;
      let writeFailure: 'invalid_state' | 'unavailable' | 'timeout' = 'invalid_state';
      let injectedBlockReason: 'riding' | null = null;
      let writes = 0;
      await context.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const envelope = JSON.parse(String(raw));
          // This UI scenario controls backend admission independently of the mock's riding telemetry.
          const snapshot = envelope.event === 'state.changed' ? envelope.data : envelope.result;
          if (snapshot?.activeConnection?.refloatConfiguration) {
            snapshot.activeConnection.refloatConfiguration.writeBlockReason = injectedBlockReason;
          }
          // Exercise the same scaled, whole-number editor metadata as brightness.
          const numeric = envelope.result?.fields?.find((field: { name: string }) => field.name === 'tiltback_duty');
          if (numeric)
            Object.assign(numeric, {
              editorScale: 100,
              editAsPercentage: false,
              precision: 0,
              step: 5,
              suffix: '%',
              wireMinimum: 0,
              wireMaximum: 0.9,
            });
          if (envelope.result && 'writeBlockReason' in envelope.result)
            envelope.result.writeBlockReason = injectedBlockReason;
          socket.send(JSON.stringify(envelope));
        });
        socket.onMessage((raw) => {
          const request = JSON.parse(String(raw));
          if (request.method === 'refloat.configuration.write') {
            assert.deepEqual(request.params.values.tiltback_duty, { type: 'double', value: 0.85 });
            writes++;
            if (failWrite) {
              if (writeFailure === 'timeout') return;
              socket.send(
                JSON.stringify({
                  id: request.id,
                  error: {
                    code: writeFailure,
                    message:
                      writeFailure === 'unavailable'
                        ? 'Backend service is unavailable'
                        : 'Backend state does not permit the operation',
                  },
                })
              );
              return;
            }
            socket.send(
              JSON.stringify({
                id: request.id,
                result: { ...current, revision: current.revision + 1, values: request.params.values },
              })
            );
            return;
          }
          server.send(raw);
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${endpoint.origin}/`);
      await page.getByRole('button', { name: 'Board actions', exact: true }).tap();
      await page.getByRole('button', { name: 'Configure Refloat', exact: true }).tap();
      const input = page.getByRole('spinbutton', { name: 'Duty Tiltback', exact: true });
      assert.equal(await input.inputValue(), '80');
      assert.equal(await input.getAttribute('max'), '90');
      await input.fill('95');
      await page
        .getByText('This controller can store at most 90 %. Enter this value or lower.', { exact: true })
        .waitFor();
      assert.equal(await page.getByRole('button', { name: 'Write configuration', exact: true }).isDisabled(), true);
      assert.equal(writes, 0, 'overflow sent a write request');
      await input.fill('80');
      assert.equal(await input.getAttribute('step'), '5');
      await input.press('ArrowUp');
      await input.blur();
      assert.equal(await input.inputValue(), '85');
      await input.fill('84.6');
      assert.equal(await input.inputValue(), '84.6', 'rounding disrupted active typing');
      await input.blur();
      assert.equal(await input.inputValue(), '85', 'editor precision was not applied on blur');
      await page.getByRole('button', { name: 'Section and search controls', exact: true }).tap();
      await page.setViewportSize({ width: 390, height: 400 });
      const scroller = page.locator('div.overflow-y-auto').filter({ has: input });
      await page.waitForFunction(() => {
        const input = document.querySelector('input[type=number]');
        const scroller = input?.closest('div.overflow-y-auto');
        return scroller && scroller.scrollHeight > scroller.clientHeight;
      });
      await page.waitForFunction(() =>
        document
          .getElementById('refloat-configuration-controls')
          ?.getAnimations()
          .every((animation) => animation.playState !== 'running')
      );
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const scrollTop = await scroller.evaluate((el) => el.scrollTop);
      assert.ok(scrollTop > 0);
      const open = page.getByRole('button', { name: 'Write configuration', exact: true });
      await open.tap();
      const dialog = page.getByRole('alertdialog', { name: 'Write persistent Refloat configuration?' });
      await dialog.getByText('Current → New', { exact: true }).waitFor();
      assert.match(
        (await dialog.getByRole('list', { name: 'Configuration differences' }).textContent()) ?? '',
        /Duty Tiltback:\s*80\s*%\s*→\s*85\s*%/
      );
      const confirm = dialog.getByRole('button', { name: 'Write and verify', exact: true });
      injectedBlockReason = 'riding';
      await dialog
        .getByText('Stop riding and wait for the board to be ready before writing.', { exact: false })
        .waitFor();
      assert.equal(await confirm.isDisabled(), true);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await dialog.waitFor({ state: 'hidden' });
      const status = page.getByRole('status').filter({ hasText: 'Stop riding' });
      await status.waitFor();
      const warningBounds = await status.boundingBox();
      assert.ok(warningBounds && warningBounds.y >= 0 && warningBounds.y + warningBounds.height <= 400);
      assert.equal(await open.isDisabled(), true);
      assert.equal(await input.inputValue(), '85');
      injectedBlockReason = null;
      await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>('button[aria-describedby="refloat-write-readiness"]')
      );
      await open.tap();

      await confirm.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
      await confirm.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
      assert.equal(writes, 0);
      await confirm.tap();
      const alert = dialog.getByRole('alert');
      await alert.waitFor();
      assert.match((await alert.textContent()) ?? '', /Check that the board is connected, stopped and ready/);
      assert.doesNotMatch((await alert.textContent()) ?? '', /Backend state/);
      const bounds = await alert.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 400, 'write error is outside the viewport');
      assert.equal(await scroller.evaluate((el) => el.scrollTop), scrollTop);
      assert.equal(await confirm.isEnabled(), true);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await input.inputValue(), '85');
      const retainedFailure = page
        .getByRole('dialog', { name: 'Configure Refloat', exact: true })
        .getByRole('alert')
        .filter({ hasText: 'Write could not be confirmed.' });
      await retainedFailure.waitFor();
      const failureBounds = await retainedFailure.boundingBox();
      assert.ok(failureBounds && failureBounds.y >= 0 && failureBounds.y + failureBounds.height <= 400);
      await page.setViewportSize({ width: 390, height: 600 });
      await open.tap();
      assert.equal(
        await dialog.getByRole('alert').textContent(),
        'The configuration write could not be confirmed. Check that the board is connected, stopped and ready, then read current values before trying again.',
        'reopening lost the previous failure'
      );
      writeFailure = 'unavailable';
      await confirm.tap();
      await alert.waitFor();
      assert.match((await alert.textContent()) ?? '', /controller may have timed out or disconnected/);
      assert.match((await alert.textContent()) ?? '', /Read current values before retrying/);
      assert.equal(await input.inputValue(), '85');
      const unavailableBounds = await alert.boundingBox();
      assert.ok(unavailableBounds && unavailableBounds.y >= 0 && unavailableBounds.y + unavailableBounds.height <= 600);
      writeFailure = 'timeout';
      await confirm.tap();
      await dialog
        .getByText('Timed out waiting for the configuration write to be confirmed.', { exact: false })
        .waitFor({ timeout: 10000 });
      assert.match((await alert.textContent()) ?? '', /write may have reached the controller/);
      assert.equal(await input.inputValue(), '85');
      failWrite = false;
      await confirm.focus();
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(writes, 4, 'pointer or keyboard activation duplicated a write');
      assert.equal(await open.isDisabled(), true, 'successful write did not clear the pending changes');
      assert.equal(await retainedFailure.count(), 0, 'successful write retained a stale footer failure');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
