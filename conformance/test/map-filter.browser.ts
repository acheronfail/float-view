import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  for (const hasTouch of [false, true]) {
    test(
      `${name} ${hasTouch ? 'touch' : 'desktop'}: map filtering owns navigation and shows disjoint visits`,
      { timeout: 90_000 },
      async () => {
        const port = await startMockServer(11002, { safetyDisclaimerAccepted: true }),
          endpoint = getMockBootstrap(port);
        const browser = await engine.launch();
        try {
          const page = await browser.newPage({
            hasTouch,
            reducedMotion: 'reduce',
            viewport: { width: 1000, height: 900 },
          });
          if (name === 'chromium')
            await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
          page.setDefaultTimeout(8000);
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.route(`${endpoint.origin}/`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
          await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
          let failSeries = false,
            metadataRequests = 0,
            locationPages = 0;
          await page.routeWebSocket('**/api/ws?*', (socket) => {
            const server = socket.connectToServer();
            socket.onMessage((raw) => {
              if (JSON.parse(String(raw)).method === 'session.get') metadataRequests++;
              server.send(raw);
            });
            server.onMessage((raw) => {
              const message = JSON.parse(String(raw));
              if (message.result?.summary?.sessionId === 'session-1') message.result.markerCount = 1;
              socket.send(JSON.stringify(message));
            });
          });
          let holdSelection = false;
          let releaseSelection!: () => void;
          let notifyHeld!: () => void;
          const selectionReleased = new Promise<void>((resolve) => {
            releaseSelection = resolve;
          });
          const selectionHeld = new Promise<void>((resolve) => {
            notifyHeld = resolve;
          });
          const delayedCompletions: Promise<void>[] = [];
          const requests: { startElapsedMs: number; endElapsedMs: number }[] = [];
          await page.route('**/api/session-data', async (route) => {
            const request = route.request().postDataJSON();
            let finishDelayed: (() => void) | undefined;
            if (holdSelection && request.kind === 'series' && request.range.startElapsedMs > 0) {
              delayedCompletions.push(
                new Promise<void>((resolve) => {
                  finishDelayed = resolve;
                })
              );
              notifyHeld();
              await selectionReleased;
            }
            if (
              request.kind === 'series' &&
              failSeries &&
              (request.range.startElapsedMs === 1000 || request.range.endElapsedMs <= 31000)
            ) {
              await route.fulfill({ status: 409, body: '' });
              return;
            }
            if (request.kind === 'locations') {
              locationPages++;
              const index = request.cursor ? Number(request.cursor.split('-').at(-1)) : 0;
              const value = {
                ...request,
                points: [
                  {
                    locationSequence: index + 1,
                    elapsedMs: 1000 + index * 5000,
                    latitude: 0,
                    longitude: [-0.02, 0, 0.02, 0, -0.02, 0, 0.02][index],
                    accuracyM: 5,
                    altitudeM: [10, 20, null, -5, 0, 30, 40][index],
                    observedAt: '2026-01-01T00:00:00Z',
                  },
                ],
                gaps: index === 3 ? [{ startElapsedMs: 12000, endElapsedMs: 15000, reason: 'noFix' }] : [],
                nextCursor: index < 6 ? `map-page-${index + 1}` : null,
                locationBoundary: { lastSequence: 7, lastElapsedMs: 31000 },
              };
              await route.fulfill({ json: value });
              return;
            }
            const response = await route.fetch(),
              value = await response.json();
            if (value.kind === 'markers') {
              value.markers = [
                {
                  sequence: 1,
                  elapsedMs: 50000,
                  observedAtMs: 50000,
                  operationId: '00000000-0000-4000-8000-000000000001',
                  location: null,
                },
              ];
              value.nextCursor = null;
            }
            if (value.kind === 'series') {
              requests.push(request.range);
              for (const column of Object.values(value.columns) as {
                elapsedMs: number[];
                sequence: number[];
                values: number[];
                generations: number[];
              }[]) {
                column.elapsedMs = [
                  request.range.startElapsedMs,
                  Math.floor((request.range.startElapsedMs + request.range.endElapsedMs) / 2),
                  request.range.endElapsedMs,
                ];
                column.sequence = [0, 1, 2];
                column.values = [1, 3, 2];
                column.generations = [0, 0, 0];
              }
            }
            try {
              await route.fulfill({ response, json: value });
            } finally {
              finishDelayed?.();
            }
          });
          await page.goto(`${endpoint.origin}/#/sessions/session-1`);

          const toggle = page.getByRole('switch', { name: 'Filter charts by map', exact: true });
          await toggle.waitFor().catch(async (error) => {
            console.error(await page.locator('body').innerText(), errors);
            throw error;
          });
          await page.waitForFunction(
            () =>
              !(
                document.querySelector(
                  'button[aria-checked="false"][title="Use the visible map area to select chart data"]'
                ) as HTMLButtonElement
              )?.disabled
          );
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          const inactiveBackground = await toggle
            .locator('[aria-hidden="true"]')
            .evaluate((node) => getComputedStyle(node).backgroundColor);
          await toggle.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
          await toggle.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          await toggle.dispatchEvent('pointerdown', { button: 2, isPrimary: true, pointerId: 1 });
          await toggle.dispatchEvent('pointerup', { button: 2, isPrimary: true, pointerId: 1 });
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          const toggleBox = await toggle.boundingBox();
          assert.ok(toggleBox);
          await page.mouse.move(toggleBox.x + 10, toggleBox.y + 10);
          await page.mouse.down();
          await toggle.dispatchEvent('pointercancel', { pointerId: 1 });
          await page.mouse.up();
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          assert.equal(locationPages, 7);
          const elevation = page.getByRole('img', { name: 'Elevation over elapsed time' });
          const elevationTrace = elevation.locator('[data-elevation-trace]');
          await elevationTrace.waitFor({ state: 'attached' });
          assert.equal((await elevationTrace.getAttribute('d'))?.match(/M/g)?.length, 2);
          if (!hasTouch) {
            await elevation.scrollIntoViewIfNeeded();
            const elevationBox = await elevation.boundingBox();
            assert.ok(elevationBox);
            await elevation.hover({ position: { x: elevationBox.width * 0.1, y: elevationBox.height / 2 } });
            await page.getByText('20 m · 6s', { exact: true }).waitFor();
          }
          let ordinaryRange = { startElapsedMs: 0, endElapsedMs: 60000 };
          if (hasTouch) {
            await page.getByRole('img', { name: 'Speed over elapsed time' }).waitFor();
            await page
              .getByRole('button', { name: /Chart mode: info/ })
              .last()
              .click();
            const chart = page.getByRole('img', { name: 'Speed over elapsed time' });
            await chart.scrollIntoViewIfNeeded();
            let b = await chart.boundingBox();
            assert.ok(b);
            const zoomResponse = page.waitForResponse((response) => {
              if (!response.url().endsWith('/api/session-data')) return false;
              const request = response.request().postDataJSON();
              return (
                request.kind === 'series' && request.range.startElapsedMs > 0 && request.range.endElapsedMs < 60000
              );
            });
            await chart.hover({ position: { x: b.width * 0.2, y: b.height / 2 } });
            b = await chart.boundingBox();
            assert.ok(b);
            await page.mouse.down();
            await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 5 });
            await page.mouse.up();
            ordinaryRange = (await zoomResponse).request().postDataJSON().range;
          }
          const priorMetadataRequests = metadataRequests;
          requests.length = 0;
          failSeries = true;
          await (hasTouch ? toggle.tap() : toggle.click());
          await page.getByRole('button', { name: 'Retry chart data' }).waitFor();
          await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes('409'));
          assert.equal(metadataRequests, priorMetadataRequests + 1, 'only one automatic metadata refresh');
          failSeries = false;
          await page.getByRole('button', { name: 'Retry chart data' }).click();
          await page.getByRole('img', { name: 'Speed over elapsed time' }).waitFor();
          assert.equal(await toggle.getAttribute('aria-checked'), 'true');
          assert.notEqual(
            await toggle.locator('[aria-hidden="true"]').evaluate((node) => getComputedStyle(node).backgroundColor),
            inactiveBackground
          );
          assert.equal(await page.locator('[data-map-separator]').count(), 0, 'GPS gaps do not split the full route');
          assert.ok(
            requests.some((r) => r.startElapsedMs === 1000 && r.endElapsedMs === 60000),
            'last fix extends through session end'
          );
          const mode = page.getByRole('button', { name: /Chart mode: info/ }).last();
          if (hasTouch) assert.equal(await mode.isDisabled(), true);
          // A late response for abandoned bounds must not repaint the current range.
          holdSelection = true;
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          await selectionHeld;
          holdSelection = false;
          await page.getByRole('button', { name: 'Re-center route map' }).click();
          await page.waitForFunction(
            () =>
              document.querySelectorAll('[data-map-separator]').length === 0 &&
              document.querySelector('svg[aria-label="Speed over elapsed time"]')
          );
          releaseSelection();
          await Promise.all(delayedCompletions);
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          );
          await page.getByRole('img', { name: 'Speed over elapsed time' }).waitFor();
          assert.equal(await page.locator('[data-map-separator]').count(), 0);
          // Zoom the actual Leaflet map around the route centre to select repeated passes.
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          await page
            .locator('[data-map-separator]')
            .first()
            .waitFor({ state: 'attached' })
            .catch(async (error) => {
              console.error(await page.locator('body').innerText(), errors, requests);
              throw error;
            });
          const before = await page.locator('[data-map-separator]').first().getAttribute('x1');
          const svg = page.getByRole('img', { name: 'Speed over elapsed time' });
          await svg.scrollIntoViewIfNeeded();
          const box = await svg.boundingBox();
          assert.ok(box);
          await svg.hover({ position: { x: box.width * 0.25, y: box.height / 2 } });
          await page
            .locator('[data-history-inspection]')
            .first()
            .waitFor({ state: 'attached' })
            .catch(async (error) => {
              console.error(
                'inspection',
                box,
                errors,
                await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML, {
                  x: box.x + box.width * 0.25,
                  y: box.y + box.height / 2,
                })
              );
              throw error;
            });
          await page.mouse.down({ button: 'right' });
          await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
          await page.mouse.up({ button: 'right' });
          for (const [pointerId, isPrimary, x] of [
            [11, true, box.x + 20],
            [12, false, box.x + 100],
          ] as const)
            await svg.dispatchEvent('pointerdown', {
              pointerType: 'touch',
              pointerId,
              isPrimary,
              button: 0,
              clientX: x,
              clientY: box.y + box.height / 2,
            });
          await svg.dispatchEvent('pointermove', {
            pointerType: 'touch',
            pointerId: 12,
            isPrimary: false,
            button: 0,
            clientX: box.x + 200,
            clientY: box.y + box.height / 2,
          });
          for (const pointerId of [11, 12])
            await svg.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId });
          await svg.dispatchEvent('wheel', { deltaY: -100, ctrlKey: true });
          assert.equal(await page.locator('[data-map-separator]').first().getAttribute('x1'), before);
          assert.ok(requests.some((r) => r.startElapsedMs > 0 && r.endElapsedMs < 30000));
          await page.getByRole('button', { name: 'Next marker', exact: true }).click();
          await page.getByText('Selected point is outside the map filter.', { exact: true }).waitFor();
          assert.equal(await page.locator('svg line[stroke-dasharray="3 2"]').count(), 0);
          assert.equal(await page.locator('[data-map-separator]').first().getAttribute('x1'), before);

          const map = page.getByRole('img', { name: 'Recorded session route' });
          await map.focus();
          await page.keyboard.press('Shift+ArrowUp');
          await page.getByText('No ride segments in this map area.', { exact: false }).waitFor();
          await page.getByRole('button', { name: 'Re-center route map' }).click();
          await page.waitForFunction(() => document.querySelectorAll('[data-map-separator]').length === 0);
          await toggle.focus();
          await page.keyboard.press('Space');
          assert.equal(
            await toggle.locator('[aria-hidden="true"]').evaluate((node) => getComputedStyle(node).backgroundColor),
            inactiveBackground
          );
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          if (hasTouch) assert.equal(await mode.isDisabled(), false);
          await page.getByRole('button', { name: /State transitions/ }).click();
          assert.match(
            await page.locator('#session-events-content').innerText(),
            new RegExp(`Current chart range: ${ordinaryRange.startElapsedMs}–${ordinaryRange.endElapsedMs}`)
          );
          await (hasTouch ? toggle.tap() : toggle.click());
          await page.getByRole('button', { name: 'Show/hide the map' }).click();
          await page.getByRole('button', { name: 'Show/hide the map' }).click();
          assert.equal(await toggle.getAttribute('aria-checked'), 'false');
          assert.deepEqual(errors, []);
        } finally {
          for (const context of browser.contexts())
            for (const page of context.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' });
          try {
            await browser.close();
          } finally {
            await stopMockServer();
          }
        }
      }
    );
  }
}
