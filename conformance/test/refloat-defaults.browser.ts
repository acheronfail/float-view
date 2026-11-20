import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: field defaults preserve other edits and never write automatically`, { timeout: 60000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scanned = await client.waitForState((state) => state.discoveredDevices.length > 0);
      const deviceId = scanned.discoveredDevices[0]!.deviceId;
      await client.request('device.connect', { deviceId, trackingMode: 'saved' });
      await client.waitForState((state) => state.activeConnection?.state === 'ready');
      const context = await browser.newContext({
        viewport: { width: 390, height: 640 },
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      if (name === 'chromium') await context.grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await context.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      let reads = 0;
      let writes = 0;
      let hold = true;
      let fail = false;
      let release!: () => void;
      let announceDefault!: () => void;
      const arrived = new Promise<void>((resolve) => {
        announceDefault = resolve;
      });
      await context.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          // This draft-only scenario never submits a write. Keep its preview ready.
          const snapshot = message.event === 'state.changed' ? message.data : message.result;
          if (snapshot?.activeConnection?.refloatConfiguration)
            snapshot.activeConnection.refloatConfiguration.writeBlockReason = null;
          if (message.result && 'writeBlockReason' in message.result) message.result.writeBlockReason = null;
          const send = () => socket.send(JSON.stringify(message));
          if (hold && message.result?.source === 'default') {
            release = send;
            announceDefault();
          } else send();
        });
        socket.onMessage((raw) => {
          const request = JSON.parse(String(raw));
          if (request.method === 'refloat.configuration.write' || request.method === 'refloat.tune.apply') writes++;
          if (request.method === 'refloat.configuration.read' && request.params.source === 'default') {
            reads++;
            assert.equal(request.params.refresh, false);
            if (fail) {
              socket.send(
                JSON.stringify({
                  id: request.id,
                  error: { code: 'unavailable', message: 'Backend service is unavailable' },
                })
              );
              return;
            }
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
      const editor = page.getByRole('dialog', { name: 'Configure Refloat', exact: true });
      const input = editor.getByRole('spinbutton', { name: 'Duty Tiltback', exact: true });
      const reset = editor.getByRole('button', { name: 'Use default for Duty Tiltback', exact: true });
      const help = editor.getByRole('button', { name: 'Show help for Duty Tiltback', exact: true });
      await input.fill('85');
      const sections = editor.getByRole('combobox', { name: 'Section', exact: true });
      const balance = await sections.inputValue();
      const lighting = await sections.locator('option').filter({ hasText: 'Startup defaults' }).getAttribute('value');
      assert.ok(lighting);
      await sections.selectOption(lighting);
      await editor
        .getByRole('group', { name: 'LEDs On (persistent startup default)', exact: true })
        .getByRole('button', { name: 'Off', exact: true })
        .tap();
      await sections.selectOption(balance);
      await input.fill('');
      await page.setViewportSize({ width: 390, height: 400 });
      await reset.hover();
      const box = (await reset.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.down();
      await page.mouse.move(x, y - 40);
      await page.mouse.move(x, y);
      await page.mouse.up();
      assert.equal(await reset.isEnabled(), true, 'drag started loading a default');
      if (name === 'chromium') {
        const scrollTop = await reset.evaluate((el) => el.closest('.overflow-y-auto')!.scrollTop);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 8; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: y - step * 12 }],
          });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForFunction(
          ({ start, id }) => document.getElementById(id)!.closest('.overflow-y-auto')!.scrollTop > start,
          { start: scrollTop, id: 'refloat-tiltback_duty' }
        );
      }
      assert.equal(await input.inputValue(), '');
      await page.setViewportSize({ width: 390, height: 640 });
      for (const pointer of [
        { button: 2, isPrimary: true },
        { button: 0, isPrimary: false },
      ]) {
        await reset.dispatchEvent('pointerdown', { ...pointer, pointerId: 30 });
        await reset.dispatchEvent('pointerup', { ...pointer, pointerId: 30 });
      }
      await reset.evaluate((element) =>
        element.addEventListener(
          'pointerdown',
          (event) => {
            element.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId));
          },
          { once: true }
        )
      );
      await reset.hover();
      await page.mouse.down();
      await reset.dispatchEvent('pointercancel', { pointerId: Number(await reset.getAttribute('data-test-pointer')) });
      await page.mouse.up();
      assert.equal(reads, 0);
      await reset.tap();
      await arrived;
      assert.equal(await reset.isDisabled(), true);
      await reset.dispatchEvent('click', { detail: 0 });
      assert.equal(reads, 1, 'disabled default started another read');
      hold = false;
      release();
      const waitValue = (value: string) =>
        page.waitForFunction(
          (expected) => (document.getElementById('refloat-tiltback_duty') as HTMLInputElement)?.value === expected,
          value
        );
      await waitValue('80');
      assert.equal(await reset.isEnabled(), true);
      const defaultBox = (await reset.boundingBox())!;
      const helpBox = (await help.boundingBox())!;
      assert.ok(defaultBox.x + defaultBox.width <= helpBox.x, 'Default must be immediately left of Help');
      await input.fill('85');
      await reset.focus();
      await page.keyboard.press('Enter');
      await waitValue('80');
      await reset.dispatchEvent('click', { detail: 1 });
      assert.equal(reads, 2, 'keyboard or synthesized click duplicated default activation');

      const output = process.env.FLOAT_VIEW_SCREENSHOTS;
      if (output && name === 'chromium') {
        await mkdir(output, { recursive: true });
        await page.screenshot({ path: join(output, 'refloat-default-phone.png') });
      }
      await input.fill('85');
      fail = true;
      await reset.tap();
      await editor
        .getByText('Could not load the default for Duty Tiltback. Check the connection and try again.', { exact: true })
        .waitFor();
      assert.equal(await input.inputValue(), '85');
      fail = false;
      await reset.tap();
      await waitValue('80');
      await sections.selectOption(lighting);
      const leds = editor.getByRole('group', { name: 'LEDs On (persistent startup default)', exact: true });
      assert.equal(
        await leds.getByRole('button', { name: 'Off', exact: true }).getAttribute('aria-pressed'),
        'true',
        'numeric default discarded another field edit'
      );
      await editor
        .getByRole('button', { name: 'Use default for LEDs On (persistent startup default)', exact: true })
        .tap();
      await page.waitForFunction(
        () =>
          document
            .getElementById('refloat-leds-on')
            ?.querySelector('button[aria-pressed=true]')
            ?.textContent?.trim() === 'On'
      );
      assert.equal(reads, 5);
      assert.equal(writes, 0);
      if (output && name === 'chromium') {
        await page.setViewportSize({ width: 1100, height: 720 });
        await page.screenshot({ path: join(output, 'refloat-default-desktop.png') });
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
