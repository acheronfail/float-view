import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: live battery temperatures and BMS shortcut`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(0, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.requestPermission', {});
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scanned = await client.waitForState((s) => s.discoveredDevices.length > 0);
      await client.request('device.connect', {
        deviceId: scanned.discoveredDevices[0]!.deviceId,
        trackingMode: 'guest',
      });
      await client.waitForState((s) => s.activeConnection?.state === 'ready');
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(5000);
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let cellTemperature = 26.1;
      let mode: 'absent' | 'discovering' | 'unavailable' | 'offline' | 'detected' | 'fresh' | 'stale' = 'discovering';
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route(`${endpoint.origin}/api/bootstrap`, (route) =>
        route.fulfill({ json: { webSocketUrl: endpoint.webSocketUrl, platform: 'web' } })
      );
      await page.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          const state =
            message.event === 'state.changed' ? message.data : message.result?.activeConnection ? message.result : null;
          if (state?.activeConnection) {
            state.activeConnection.bms = {
              status:
                mode === 'absent'
                  ? 'not_found'
                  : mode === 'offline'
                    ? 'unavailable'
                    : mode === 'discovering' || mode === 'unavailable'
                      ? mode
                      : 'attached',
              connection:
                mode === 'absent' || mode === 'discovering' || mode === 'unavailable'
                  ? null
                  : { kind: 'can', canId: 42 },
              candidates: [],
              latestSnapshot:
                mode === 'fresh' || mode === 'stale'
                  ? {
                      observedAt: new Date(Date.now() - (mode === 'stale' ? 10_000 : 0)).toISOString(),
                      temperaturesC: [43, 24.9, cellTemperature, 31.1, -300, cellTemperature, 24.9, 26.1, 25.8],
                      highestCellTemperatureC: cellTemperature,
                      highestCircuitryTemperatureC: 43,
                      cellVoltagesV: [3.8, 3.81],
                      balancing: [false, false],
                      totalVoltageV: 68.4,
                      chargeVoltageV: 75.6,
                      inputCurrentA: 2,
                      inputIcCurrentA: 2,
                      sessionAmpHoursAh: 0,
                      sessionWattHoursWh: 0,
                      icTemperatureC: 43,
                      humiditySensorTemperatureC: 35.1,
                      humidityPercent: 40,
                      stateOfCharge: 0.8,
                      stateOfHealth: 1,
                      reportedCanId: 42,
                      lifetimeChargeAmpHoursAh: 0,
                      lifetimeChargeWattHoursWh: 0,
                      lifetimeDischargeAmpHoursAh: 0,
                      lifetimeDischargeWattHoursWh: 0,
                      pressurePa: 101325,
                      dataVersion: 1,
                      status: null,
                    }
                  : null,
            };
          }
          socket.send(JSON.stringify(message));
        });
      });
      await page.goto(`${endpoint.origin}/#/live`);
      const temperatures = page.getByRole('region', { name: 'Temperatures', exact: true });
      await temperatures.getByRole('progressbar', { name: 'Motor temperature', exact: true }).waitFor();
      assert.equal(await temperatures.getByRole('progressbar').count(), 2);
      const height = (await temperatures.boundingBox())!.height;
      const shortcut = page.getByRole('button', { name: 'Open battery management system', exact: true });
      assert.equal(await shortcut.count(), 0);
      mode = 'unavailable';
      await shortcut.waitFor();
      assert.equal(await temperatures.getByRole('progressbar').count(), 2);
      mode = 'absent';
      await shortcut.waitFor({ state: 'hidden' });
      assert.equal(await temperatures.getByRole('progressbar').count(), 2);
      mode = 'detected';
      const battery = temperatures.getByRole('progressbar', { name: 'Battery cells temperature', exact: true });
      await battery.waitFor();
      const circuitry = temperatures.getByRole('progressbar', { name: 'BMS circuitry temperature', exact: true });
      await circuitry.waitFor();
      assert.equal(await temperatures.getByRole('progressbar').count(), 4);
      assert.equal(await battery.getAttribute('aria-valuetext'), 'Unavailable');
      assert.ok((await temperatures.boundingBox())!.height >= height + 18);
      mode = 'fresh';
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Battery cells temperature"]')?.getAttribute('aria-valuenow') === '26.1'
      );
      assert.ok((await temperatures.boundingBox())!.height >= height + 18);
      assert.equal((await battery.boundingBox())!.height, 12);
      assert.equal((await circuitry.boundingBox())!.height, 12);
      assert.equal(await circuitry.getAttribute('aria-valuenow'), '43');
      for (const bar of await temperatures.getByRole('progressbar').all()) {
        assert.equal((await bar.boundingBox())!.height, 12);
      }
      assert.ok((await battery.boundingBox())!.y > (await circuitry.boundingBox())!.y);
      const regionBox = (await temperatures.boundingBox())!;
      const lastBox = (await battery.boundingBox())!;
      assert.ok(lastBox.y + lastBox.height + 20 <= regionBox.y + regionBox.height + 1);
      await page.waitForFunction(() => {
        const bar = document.querySelector('[aria-label="Battery cells temperature"]');
        const fill = bar?.lastElementChild;
        return (
          !!bar &&
          !!fill &&
          Math.abs(fill.getBoundingClientRect().width / bar.getBoundingClientRect().width - 0.261) < 0.01
        );
      });
      for (const viewport of [
        { width: 360, height: 640 },
        { width: 1280, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        const bounds = (await temperatures.boundingBox())!;
        const last = (await battery.boundingBox())!;
        assert.ok(last.y + last.height + 20 <= bounds.y + bounds.height + 1);
        for (const bar of await temperatures.getByRole('progressbar').all())
          assert.equal((await bar.boundingBox())!.height, 12);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (name === 'chromium') {
        await page.screenshot({ path: '/tmp/float-view-live-battery-temperature.png' });
        await temperatures.screenshot({ path: '/tmp/float-view-temperature-bars.png' });
      }
      cellTemperature = 45;
      await page.waitForFunction(() => {
        const bar = document.querySelector('[aria-label="Battery cells temperature"]');
        return (
          bar?.getAttribute('aria-valuenow') === '45' &&
          (bar.lastElementChild as HTMLElement)?.style.getPropertyValue('--temperature-color') === 'rgb(220, 38, 38)'
        );
      });
      const dialog = page.getByRole('dialog', { name: 'Battery management system', exact: true });
      await shortcut.click({ button: 'right' });
      await shortcut.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
      await shortcut.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
      assert.equal(await dialog.count(), 0);
      await shortcut.evaluate((el) =>
        el.addEventListener(
          'pointerdown',
          (event) => {
            el.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId));
          },
          { once: true }
        )
      );
      await shortcut.hover();
      await page.mouse.down();
      const pointerId = Number(await shortcut.getAttribute('data-test-pointer'));
      await shortcut.dispatchEvent('pointercancel', { pointerId });
      await page.mouse.up();
      assert.equal(await dialog.count(), 0);
      await shortcut.tap();
      await dialog.waitFor();
      assert.equal(await dialog.count(), 1);
      const batteryReadings = dialog.getByRole('list', { name: 'Battery cells', exact: true });
      const bmsReadings = dialog.getByRole('list', { name: 'BMS and environment', exact: true });
      assert.equal(await batteryReadings.getByRole('progressbar').count(), 6);
      assert.equal(await bmsReadings.getByRole('progressbar').count(), 4);
      const missingSensor = bmsReadings.getByRole('progressbar', { name: 'Ambient temperature', exact: true });
      assert.equal(await missingSensor.getAttribute('aria-valuetext'), 'Unavailable');
      assert.equal(await missingSensor.getAttribute('aria-valuenow'), null);
      const missingCard = missingSensor.locator('xpath=ancestor::li');
      assert.match((await missingCard.textContent())!, /Unavailable/);
      assert.equal(await missingCard.evaluate((el) => getComputedStyle(el).opacity), '0.5');
      assert.equal(await missingSensor.locator(':scope > div').evaluate((el) => el.getBoundingClientRect().width), 0);
      assert.equal(
        await bmsReadings
          .getByRole('progressbar', { name: 'BMS chip temperature', exact: true })
          .getAttribute('aria-valuenow'),
        '43'
      );
      assert.equal(
        await batteryReadings
          .getByRole('progressbar', { name: 'Hottest cell probe temperature', exact: true })
          .getAttribute('aria-valuenow'),
        '45'
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await shortcut.focus();
      await page.keyboard.press('Enter');
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await shortcut.click();
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await shortcut.focus();
      await page.keyboard.press('Space');
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      mode = 'stale';
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Battery cells temperature"]')?.getAttribute('aria-valuetext') ===
          'Unavailable'
      );
      assert.equal(await circuitry.getAttribute('aria-valuetext'), 'Unavailable');
      mode = 'offline';
      await shortcut.click();
      await dialog.waitFor();
      await dialog.getByText('Unavailable', { exact: true }).first().waitFor();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await temperatures.getByRole('progressbar').count(), 4);
      mode = 'absent';
      await battery.waitFor({ state: 'hidden' });
      assert.equal(await shortcut.count(), 0);
      assert.equal((await temperatures.boundingBox())!.height, height);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
