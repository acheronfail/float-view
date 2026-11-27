import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';
const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: fault history and timed danger markers`, { timeout: 90_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.requestPermission', {});
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scanned = await client.waitForState((s) => s.discoveredDevices.length > 0);
      await client.request('device.connect', {
        deviceId: scanned.discoveredDevices[0]!.deviceId,
        trackingMode: 'saved',
      });
      const ready = await client.waitForState((s) => s.activeConnection?.state === 'ready');
      const sessionId = ready.activeConnection!.activeSession!.sessionId;
      await client.request('session.marker.add', { sessionId, operationId: crypto.randomUUID() });
      const page = await browser.newPage({
        hasTouch: true,
        reducedMotion: 'reduce',
        viewport: { width: 390, height: 844 },
      });
      page.setDefaultTimeout(10000);
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
      await page.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          if (message.result?.summary?.sessionId === sessionId && message.result.snapshot) {
            message.result.snapshot.committedEventSequence = Math.max(
              4,
              message.result.snapshot.committedEventSequence
            );
            message.result.snapshot.committedElapsedMs = 60000;
            message.result.summary.totalElapsedMs = 60000;
            message.result.location = {
              available: true,
              count: 3,
              lastSequence: 3,
              lastElapsedMs: 10000,
              status: 'available',
            };
            message.result.snapshot.committedLocationSequence = 3;
            message.result.snapshot.committedLocationElapsedMs = 10000;
          }
          socket.send(JSON.stringify(message));
        });
      });
      await page.route('**/api/session-data', async (route) => {
        const request = route.request().postDataJSON();
        if (request.kind === 'locations') {
          await route.fulfill({
            json: {
              kind: 'locations',
              sessionId,
              snapshot: request.snapshot,
              range: request.range,
              points: [0, 5000, 10000].map((elapsedMs, i) => ({
                elapsedMs,
                locationSequence: i + 1,
                latitude: -33.8688 - i * 0.001,
                longitude: 151.2093 + i * 0.001,
                accuracyM: 5,
                altitudeM: null,
                observedAt: new Date(Date.UTC(2026, 0, 1) + elapsedMs).toISOString(),
              })),
              gaps: [],
              nextCursor: null,
              locationBoundary: { lastSequence: 3, lastElapsedMs: 10000 },
            },
          });
          return;
        }
        if (request.kind !== 'events') {
          await route.continue();
          return;
        }
        await route.fulfill({
          json: {
            kind: 'events',
            sessionId,
            snapshot: request.snapshot,
            range: request.range,
            page: {
              sequence: [1, 2, 3],
              elapsedMs: [5000, 9000, 10000],
              sourceSampleSequence: [0, 0, 0],
              kinds: ['firmwareFaultHistory', 'firmwareFaultHistory', 'firmwareFaultHistory'],
              values: ['absoluteOverCurrent', 'unknown', 'driver'],
              faults: [
                { rawCode: 4, occurredElapsedMs: 2500 },
                { rawCode: 255, occurredElapsedMs: 8000 },
                { rawCode: 3, occurredElapsedMs: null },
              ],
            },
            nextCursor: null,
          },
        });
      });
      await page.goto(`${endpoint.origin}/#/live`);
      await page.getByRole('button', { name: 'Board actions', exact: true }).tap();
      const action = page.getByRole('button', { name: 'Faults and errors…', exact: true });
      await action.click({ button: 'right' });
      assert.equal(await page.getByRole('dialog', { name: 'Faults and errors', exact: true }).count(), 0);
      await action.tap();
      const dialog = page.getByRole('dialog', { name: 'Faults and errors', exact: true });
      await dialog.waitFor();
      await dialog.getByText('Absolute overcurrent', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('listitem').count(), 3);
      await dialog.getByText('Controller fault 255', { exact: true }).waitFor();
      await dialog.getByText(/Time unavailable\s*Observed/).waitFor();
      assert.equal((await client.request('uiState.get', {}))?.surface?.kind, 'faultHistory');
      await page.reload();
      await dialog.getByText('Absolute overcurrent', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Done', exact: true }).focus();
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });
      await client.request('device.disconnect', {});
      await page.goto(`${endpoint.origin}/#/sessions/${sessionId}`);
      const list = page.getByRole('region', { name: 'Ride faults and errors', exact: true });
      await list.getByText('Absolute overcurrent', { exact: true }).waitFor();
      const chartMarker = page
        .getByRole('button', { name: 'Inspect fault: Absolute overcurrent', exact: true })
        .first();
      await chartMarker.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Inspect fault: Driver fault', exact: true }).count(), 0);
      await list.getByRole('button', { name: /Absolute overcurrent/ }).tap();
      await chartMarker.focus();
      await page.keyboard.press('Enter');
      const mapMarker = page.locator('.firmware-fault-marker button').first();
      await mapMarker.waitFor().catch(async (error) => {
        console.error('FAULT MAP', errors, (await page.locator('body').innerText()).slice(0, 2200));
        await page.screenshot({ path: '/tmp/float-fault-map-debug.png' });
        throw error;
      });
      await mapMarker.tap();
      for (const width of [320, 390, 1000]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => scrollTo(0, 0));
      await mkdir(new URL('../generated/', import.meta.url), { recursive: true });
      await page.screenshot({ path: new URL(`../generated/fault-history-${name}.png`, import.meta.url).pathname });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
