import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';
import { dragFromControl } from './support/drag-from-control.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
const description = [
  'Angle I considers "error" & rider input. Literal <script>text</script> stays visible.',
  ...Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}: ${'Long Refloat configuration guidance. '.repeat(8)}`),
  'Final recommendation.',
].join('\n\n');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: long Refloat help scrolls with its title and Done button visible`, { timeout: 60000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
    const browser = await engine.launch();
    try {
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const scan = await client.waitForState((state) => state.discoveredDevices.length > 0);
      await client.request('device.connect', { deviceId: scan.discoveredDevices[0]!.deviceId, trackingMode: 'guest' });
      await client.waitForState((state) => state.activeConnection?.state === 'ready');
      const context = await browser.newContext({
        viewport: { width: 390, height: 600 },
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      if (name === 'chromium') await context.grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await context.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await context.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const response = JSON.parse(String(raw));
          // Supply a long normalized schema description without changing the shared mock fixture.
          if (response.result?.fields) {
            for (const field of response.result.fields) field.description = description;
          }
          socket.send(JSON.stringify(response));
        });
        socket.onMessage((raw) => server.send(raw));
      });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${endpoint.origin}/`);
      await page.getByRole('button', { name: 'Board actions', exact: true }).tap();
      await page.getByRole('button', { name: 'Configure Refloat', exact: true }).tap();
      const help = page.getByRole('button', { name: 'Show help for Duty Tiltback', exact: true });
      for (const viewport of [
        { width: 390, height: 600 },
        { width: 600, height: 320 },
      ]) {
        await page.setViewportSize(viewport);
        const dialog = page.getByRole('dialog', { name: 'Duty Tiltback', exact: true });
        await dragFromControl(help);
        assert.equal(await dialog.count(), 0);
        await help.tap();
        const body = dialog.getByRole('region', { name: 'Duty Tiltback help' });
        const done = dialog.getByRole('button', { name: 'Done', exact: true });
        assert.equal(await body.textContent(), description);
        assert.equal(await dialog.locator('script').count(), 0);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds && bounds.y >= 16 && bounds.y + bounds.height <= viewport.height - 16, JSON.stringify(bounds));
        const doneBounds = await done.boundingBox();
        assert.ok(doneBounds && doneBounds.y >= 16 && doneBounds.y + doneBounds.height <= viewport.height - 16);
        assert.equal(await body.evaluate((el) => el.scrollTop), 0);
        assert.ok(await body.evaluate((el) => el.scrollHeight > el.clientHeight));
        await page.waitForFunction(() => {
          const el = document.querySelector('[role="dialog"] [role="region"]')!;
          return (
            el.classList.contains('scrollable') &&
            el.classList.contains('more-below') &&
            !el.classList.contains('more-above')
          );
        });
        const border = await body.evaluate((el) => getComputedStyle(el).borderTopWidth);
        assert.equal(border, '0px');
        await body.hover();
        await page.mouse.wheel(0, 300);
        await page.waitForFunction(() => document.querySelector('[role="dialog"] [role="region"]')!.scrollTop > 0);
        await body.focus();
        await page.keyboard.press('End');
        await page.waitForFunction(() => {
          const el = document.querySelector('[role="dialog"] [role="region"]')!;
          return (
            el.scrollTop + el.clientHeight >= el.scrollHeight - 1 &&
            el.classList.contains('more-above') &&
            !el.classList.contains('more-below')
          );
        });
        await page.setViewportSize({ width: 600, height: 12000 });
        await page.waitForFunction(
          () => !document.querySelector('[role="dialog"] [role="region"]')!.classList.contains('scrollable')
        );
        await page.setViewportSize(viewport);
        await page.waitForFunction(() =>
          document.querySelector('[role="dialog"] [role="region"]')!.classList.contains('scrollable')
        );
        await done.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
        await dragFromControl(done);
        assert.equal(await dialog.count(), 1);
        await done.tap();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await help.evaluate((el) => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        await dialog.waitFor();
        assert.equal(await body.evaluate((el) => el.scrollTop), 0);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await help.evaluate((el) => el === document.activeElement), true);
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
