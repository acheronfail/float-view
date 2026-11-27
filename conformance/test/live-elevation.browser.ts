import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { getMockBootstrap, startMockServer, stopMockServer } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: elevation is configurable in both dashboards and follows GPS availability`, async () => {
    const browser = await engine.launch();
    const endpoint = getMockBootstrap(await startMockServer(0, { safetyDisclaimerAccepted: true }));
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    try {
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scanned = await client.waitForState((state) => state.discoveredDevices.length > 0);
      await client.request('device.connect', {
        deviceId: scanned.discoveredDevices[0]!.deviceId,
        trackingMode: 'saved',
      });
      const ready = await client.waitForState((state) => state.activeConnection?.latestLocation != null);
      const savedDeviceId = ready.activeConnection!.savedDeviceId!;
      const page = await browser.newPage({ viewport: { width: 420, height: 900 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(7_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route(`${endpoint.origin}/api/bootstrap`, (route) =>
        route.fulfill({ json: { ...endpoint, platform: 'web' } })
      );
      await page.routeWebSocket('**/api/ws?*', (socket) => {
        socket.connectToServer().onMessage((raw) => {
          const message = JSON.parse(String(raw));
          const state = message.event === 'state.changed' ? message.data : message.result;
          const fix = state?.activeConnection?.latestLocation;
          if (fix && state.settings.locationRecordingEnabled) fix.altitudeM = 24;
          socket.send(JSON.stringify(message));
        });
      });
      await page.goto(`${endpoint.origin}/#/live`);
      const actions = page.getByRole('button', { name: 'Board actions', exact: true });
      await actions.click();
      await page.getByRole('button', { name: 'Live View', exact: true }).click();
      const empty = page.getByRole('button', { name: 'Choose value for box 1: Empty', exact: true });
      const chooser = page.getByRole('dialog', { name: 'Choose a value' });
      await empty.hover();
      await page.mouse.down();
      await chooser.waitFor();
      await page.mouse.up();
      const option = chooser.getByRole('button', { name: 'Elevation', exact: true });
      await option.click({ button: 'right' });
      assert.equal(await chooser.isVisible(), true);
      if (name === 'chromium') await option.click();
      else await option.press('Enter');
      const slot = page.getByRole('button', { name: 'Choose value for box 1: Elevation', exact: true });
      await slot.getByText(/—\s*m/).waitFor();

      const enable = await client.request('state.get', {});
      assert.equal(enable.settings.locationRecordingEnabled, false);
      await client.request('settings.update', {
        expectedRevision: enable.settings.revision,
        patch: { locationRecordingEnabled: true, unitPreference: 'imperial' },
      });
      await slot.getByText(/79\s*ft/).waitFor();

      await actions.click();
      await page.getByRole('button', { name: 'Custom View', exact: true }).click();
      const dashboard = page.getByRole('region', { name: 'Custom dashboard', exact: true });
      const first = dashboard.locator('[data-dashboard-widget]').first();
      await first.hover();
      await page.mouse.down();
      await dashboard.getByRole('toolbar', { name: 'Edit dashboard' }).waitFor();
      await page.mouse.up();
      await dashboard.getByRole('button', { name: 'Add widget', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search widgets', exact: true }).fill('Elevation');
      await page.getByRole('button', { name: 'Elevation', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Add widget', exact: true })
        .getByRole('button', { name: 'Add widget', exact: true })
        .click();
      await dashboard.getByRole('button', { name: 'Save dashboard', exact: true }).click();
      const tile = dashboard.locator('[data-dashboard-widget][aria-label="Elevation"]').last();
      await tile.getByText(/79\s*ft/).waitFor();
      const profile = await client.request('boardProfile.get', { savedDeviceId });
      assert.equal(profile.values.liveWidgetSlots?.[0], 'altitudeM');
      assert.ok(
        profile.values.customDashboard?.widgets.some(
          (widget) => widget.kind === 'reading' && widget.field === 'altitudeM'
        )
      );

      const disable = await client.request('state.get', {});
      await client.request('settings.update', {
        expectedRevision: disable.settings.revision,
        patch: { locationRecordingEnabled: false },
      });
      await tile.getByText(/—\s*ft/).waitFor();
      await page.reload();
      await tile.getByText(/—\s*ft/).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      client.close();
      await browser.close();
      await stopMockServer();
    }
  });
}
