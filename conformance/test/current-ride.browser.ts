import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(
    `${name}: current ride follows, freezes for inspection and finishes without disconnect navigation`,
    { timeout: 90_000 },
    async () => {
      const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
      const endpoint = getMockBootstrap(port);
      const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
      const browser = await engine.launch();
      try {
        await client.request('bluetooth.requestPermission', {});
        await client.request('bluetooth.scan', { timeoutMs: 100 });
        const scanned = await client.waitForState((state) => state.discoveredDevices.length > 0);
        const deviceId = scanned.discoveredDevices[0]!.deviceId;
        await client.request('device.connect', { deviceId, trackingMode: 'saved' });
        const ready = await client.waitForState((state) => state.activeConnection?.state === 'ready');
        const sessionId = ready.activeConnection!.activeSession!.sessionId;
        // Retain even a short test ride.
        await client.request('session.marker.add', { sessionId, operationId: crypto.randomUUID() });
        const page = await browser.newPage({
          hasTouch: name === 'webkit',
          reducedMotion: 'reduce',
          viewport: name === 'webkit' ? { width: 390, height: 844 } : { width: 1000, height: 1000 },
        });
        if (name === 'chromium')
          await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
        page.setDefaultTimeout(10000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let metadataRequests = 0;
        let disconnectRequests = 0;
        let reconnecting = false;
        let failRefresh = false;
        let lastLongitude = 151.21;
        await page.routeWebSocket('**/api/ws?*', (socket) => {
          const server = socket.connectToServer();
          socket.onMessage((raw) => {
            const message = JSON.parse(String(raw));
            if (message.method === 'session.get') {
              metadataRequests++;
              if (failRefresh) {
                socket.send(
                  JSON.stringify({ id: message.id, error: { code: 'internal_error', message: 'Test refresh failure' } })
                );
                return;
              }
            }
            if (message.method === 'device.disconnect') disconnectRequests++;
            server.send(raw);
          });
          server.onMessage((raw) => {
            const message = JSON.parse(String(raw));
            if (message.result?.summary?.sessionId === sessionId && message.result.snapshot) {
              message.result.location = {
                available: true,
                count: 2,
                lastSequence: 2,
                lastElapsedMs: 100,
                status: 'available',
              };
              message.result.snapshot.committedLocationSequence = 2;
              message.result.snapshot.committedLocationElapsedMs = 100;
            }
            const state = message.data ?? message.result;
            if (reconnecting && state?.activeConnection) state.activeConnection.state = 'reconnecting';
            socket.send(JSON.stringify(message));
          });
        });
        let delaySeries = false;
        const ends: number[] = [];
        await page.route('**/api/session-data', async (route) => {
          const request = route.request().postDataJSON();
          if (request.kind === 'series') {
            ends.push(request.range.endElapsedMs);
            if (delaySeries) await new Promise((resolve) => setTimeout(resolve, 800));
          }
          if (request.kind === 'locations') {
            await route.fulfill({
              json: {
                kind: 'locations',
                sessionId,
                snapshot: request.snapshot,
                range: request.range,
                points: [
                  {
                    locationSequence: 1,
                    elapsedMs: 0,
                    latitude: -33.86,
                    longitude: 151.2,
                    accuracyM: 5,
                    altitudeM: null,
                    observedAt: '2026-01-01T00:00:00.000Z',
                  },
                  {
                    locationSequence: 2,
                    elapsedMs: 100,
                    latitude: -33.87,
                    longitude: lastLongitude,
                    accuracyM: 5,
                    altitudeM: null,
                    observedAt: '2026-01-01T00:00:00.100Z',
                  },
                ],
                gaps: [],
                nextCursor: null,
                locationBoundary: { lastSequence: 2, lastElapsedMs: 100 },
              },
            });
            return;
          }
          await route.continue();
        });
        await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
        await page.goto(`${endpoint.origin}/#/live`);
        const menu = page.getByRole('button', { name: 'Board actions', exact: true });
        assert.equal(await page.getByRole('button', { name: /Current ride/ }).count(), 0);
        await menu.click();
        const current = page.getByRole('button', { name: 'Session…', exact: true });
        await current.waitFor();
        await current.dispatchEvent('pointerdown', { pointerId: 11, isPrimary: false, button: 0 });
        await current.dispatchEvent('pointerup', { pointerId: 11, isPrimary: false, button: 0 });
        const currentBounds = (await current.boundingBox())!;
        await page.mouse.move(currentBounds.x + 20, currentBounds.y + 20);
        await page.mouse.down();
        await current.dispatchEvent('pointercancel', { pointerId: 1, isPrimary: true });
        await page.mouse.up();
        await page.mouse.move(0, 0);
        assert.match(page.url(), /#\/live$/);
        if (name === 'webkit') await current.tap();
        else {
          await current.focus();
          await page.keyboard.press('Enter');
        }
        await page.getByText('Recording · Following live', { exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('[data-history-group] svg').length > 0);
        const riderPosition = page.locator('.location-marker[title="Last known rider position"]');
        await riderPosition.waitFor();
        assert.equal(await page.getByRole('img', { name: 'Elevation over elapsed time' }).count(), 0);
        assert.equal(await riderPosition.getAttribute('aria-label'), 'Last known rider position');
        assert.equal(await riderPosition.locator('svg path').count(), 4);
        async function markerStyle() {
          return page.locator('.location-marker .rider-symbol').evaluate((node) => {
            const style = getComputedStyle(node);
            return { color: style.color, animation: style.animationName, duration: style.animationDuration };
          });
        }
        assert.equal((await markerStyle()).animation, 'none', 'reduced motion keeps the live rider static');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        for (const [theme, color] of [
          ['light', 'rgb(220, 38, 38)'],
          ['dark', 'rgb(248, 113, 113)'],
        ] as const) {
          await client.request('settings.update', {
            expectedRevision: (await client.request('state.get', {})).settings.revision,
            patch: { themePreference: theme },
          });
          await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
          assert.deepEqual(await markerStyle(), { color, animation: 'rider-live-pulse', duration: '2.8s' });
        }
        await riderPosition.evaluate((node) => node.setAttribute('data-preserved-rider', 'yes'));
        const initialPosition = await riderPosition.evaluate((node) => (node as HTMLElement).style.transform);
        lastLongitude = 151.209;
        const firstEnd = ends[0]!;
        await page.waitForTimeout(3400);
        assert(
          ends.some((end) => end > firstEnd),
          'growing snapshots should extend charts'
        );
        await page.waitForFunction((initial) => {
          const marker = document.querySelector<HTMLElement>('.location-marker[title="Last known rider position"]');
          return marker && marker.style.transform !== initial;
        }, initialPosition);
        assert.equal(
          await riderPosition.getAttribute('data-preserved-rider'),
          'yes',
          'updates preserve the pulsing element'
        );
        const legend = page.getByRole('button', { name: /^Hide .+ line$/ }).first();
        // Capture an element identity to prove refresh does not recreate the chart.
        await page
          .locator('[data-history-group] svg')
          .first()
          .evaluate((node) => node.setAttribute('data-preserved', 'yes'));
        const chart = page.locator('[data-history-group] svg').first();
        const box = (await chart.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
        await page.getByRole('button', { name: 'Jump to live', exact: true }).waitFor();
        assert.equal(await riderPosition.count(), 0);
        await page.locator('.location-marker[title="Selected location"]').waitFor();
        for (const [theme, color] of [
          ['light', 'rgb(15, 23, 42)'],
          ['dark', 'rgb(241, 245, 249)'],
        ] as const) {
          await client.request('settings.update', {
            expectedRevision: (await client.request('state.get', {})).settings.revision,
            patch: { themePreference: theme },
          });
          await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
          assert.equal((await markerStyle()).color, color);
          assert.equal((await markerStyle()).animation, 'none');
        }
        assert.equal(await page.locator('.location-marker-live').count(), 0);
        const pausedRequests = metadataRequests;
        await page.waitForTimeout(3400);
        assert.equal(metadataRequests, pausedRequests);
        assert.equal(await chart.getAttribute('data-preserved'), 'yes');
        const hiddenLabel = (await legend.getAttribute('aria-label'))!.replace(/^Hide /, 'Show ');
        await legend.click();
        const showLegend = page.getByRole('button', { name: hiddenLabel, exact: true });
        await showLegend.waitFor();
        if (name === 'webkit') {
          await page.getByRole('button', { name: 'Chart mode: info. Switch to zoom mode', exact: true }).tap();
          await page.getByRole('button', { name: 'Chart mode: zoom. Switch to pan mode', exact: true }).waitFor();
          const lowerChart = page.locator('[data-history-group] svg').nth(4);
          // WebKit can consider a chart visible underneath the sticky header.
          await lowerChart.evaluate((node) => node.scrollIntoView({ block: 'center' }));
          await lowerChart.evaluate((node) => node.setAttribute('data-zoom-preserved', 'yes'));
          const beforeScroll = await page.evaluate(() => window.scrollY);
          const zoomBox = (await lowerChart.boundingBox())!;
          delaySeries = true;
          const beforeZoomRequests = ends.length;
          const zoomRequest = page.waitForRequest(
            (request) =>
              request.url().endsWith('/api/session-data') &&
              request.method() === 'POST' &&
              request.postDataJSON().kind === 'series'
          );
          await page.mouse.move(zoomBox.x + zoomBox.width * 0.2, zoomBox.y + zoomBox.height / 2);
          await page.mouse.down();
          await page.mouse.move(zoomBox.x + zoomBox.width * 0.8, zoomBox.y + zoomBox.height / 2, { steps: 8 });
          await page.mouse.up();
          await page.waitForFunction(() => document.querySelector('[data-zoom-preserved="yes"]') !== null);
          await zoomRequest;
          assert(ends.length > beforeZoomRequests, 'zoom must request a new range');
          assert.equal(await lowerChart.getAttribute('data-zoom-preserved'), 'yes');
          assert(
            Math.abs((await page.evaluate(() => window.scrollY)) - beforeScroll) < 80,
            'zoom must preserve the scroll position while chart data loads'
          );
          await page.waitForTimeout(900);
          assert.equal(await lowerChart.getAttribute('data-zoom-preserved'), 'yes');
          delaySeries = false;
        }
        const jump = page.getByRole('button', { name: 'Jump to live', exact: true });
        if (name === 'webkit') await jump.tap();
        else await jump.click();
        await page.getByText('Recording · Following live', { exact: true }).waitFor();
        await riderPosition.waitFor();
        assert.equal((await markerStyle()).animation, 'rider-live-pulse');
        await page.waitForTimeout(500);
        assert(metadataRequests > pausedRequests);
        assert.equal(await chart.getAttribute('data-preserved'), 'yes');
        // Right-button dragging pans regardless of the chart's current interaction mode.
        await chart.scrollIntoViewIfNeeded();
        const panBox = (await chart.boundingBox())!;
        await page.mouse.move(panBox.x + panBox.width * 0.5, panBox.y + panBox.height * 0.5);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(panBox.x + panBox.width * 0.6, panBox.y + panBox.height * 0.5);
        await page.mouse.up({ button: 'right' });
        await jump.waitFor();
        assert.equal(await page.locator('.location-marker-live').count(), 0, 'chart panning stops the live pulse');
        assert.equal((await markerStyle()).animation, 'none');
        await jump.click();
        await page.getByText('Recording · Following live', { exact: true }).waitFor();
        assert.equal((await markerStyle()).animation, 'rider-live-pulse');
        reconnecting = true;
        await page.getByText('Reconnecting · Following live', { exact: true }).waitFor();
        reconnecting = false;
        await page.getByText('Recording · Following live', { exact: true }).waitFor();
        await showLegend.waitFor();
        failRefresh = true;
        await page.getByText(/Could not refresh this ride/).waitFor();
        assert(await chart.isVisible());
        failRefresh = false;
        await page.getByText(/Could not refresh this ride/).waitFor({ state: 'hidden' });
        const back = page.getByRole('link', { name: 'Back to board', exact: true });
        await back.dispatchEvent('pointerdown', { pointerId: 31, isPrimary: false, button: 0 });
        await back.dispatchEvent('pointerup', { pointerId: 31, isPrimary: false, button: 0 });
        assert.match(page.url(), new RegExp(sessionId));
        if (name === 'webkit') await back.tap();
        else {
          await back.focus();
          await page.keyboard.press('Enter');
        }
        await page.waitForURL(/#\/live$/);
        await menu.click();
        await current.waitFor();
        const afterReturn = metadataRequests;
        await page.waitForTimeout(3400);
        assert.equal(metadataRequests, afterReturn);
        assert.equal(disconnectRequests, 0);
        assert.equal((await client.request('state.get', {})).activeConnection?.activeSession?.sessionId, sessionId);
        await page.evaluate(() => {
          location.hash = '#/sessions';
        });
        await page.getByRole('button', { name: /Current ride/ }).click();
        await page.getByText('Recording · Following live', { exact: true }).waitFor();
        // Disconnect pauses a resumable ride; use the explicit completion command.
        await client.request('session.end', { sessionId });
        await page.getByText('Recording · Following live', { exact: true }).waitFor({ state: 'hidden' });
        await page.waitForTimeout(3500);
        assert.match(page.url(), new RegExp(sessionId));
        assert.equal((await client.request('session.get', { sessionId })).summary.state, 'completed');
        assert.equal(await page.getByRole('heading', { name: 'Current ride', exact: true }).count(), 0);
        assert.equal(await page.locator('.location-marker-live').count(), 0, 'completed rides stop pulsing');
        assert.equal((await markerStyle()).animation, 'none');
        const completedRequests = metadataRequests;
        await page.waitForTimeout(3400);
        assert.equal(metadataRequests, completedRequests);
        await client.request('device.connect', { deviceId, trackingMode: 'guest' });
        await client.waitForState((state) => state.activeConnection?.state === 'ready');
        await page.goto(`${endpoint.origin}/#/live`);
        await menu.click();
        await page.getByText('Guest connection — live data will not be saved or tracked.').waitFor();
        assert.equal(await current.count(), 0);
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        client.close();
        await stopMockServer();
      }
    }
  );
}
