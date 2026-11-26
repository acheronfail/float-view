import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(
    `${name}: touch, cancelled pointers, keyboard and authoritative segmented settings`,
    { timeout: 60_000 },
    async () => {
      const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
      const endpoint = getMockBootstrap(port);
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          reducedMotion: 'reduce',
        });
        page.setDefaultTimeout(5000);
        if (name === 'chromium')
          await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
        const errors: string[] = [];
        const patches: unknown[] = [];
        let reject = false;
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.routeWebSocket('**/api/ws?*', (socket) => {
          const server = socket.connectToServer();
          socket.onMessage((raw) => {
            const message = JSON.parse(String(raw));
            if (message.method === 'settings.update') {
              patches.push(message.params.patch);
              if (reject) {
                socket.send(
                  JSON.stringify({
                    id: message.id,
                    error: { code: 'invalid_request', message: 'Settings save failed' },
                  })
                );
                return;
              }
            }
            server.send(raw);
          });
          server.onMessage((raw) => socket.send(raw));
        });
        await page.goto(`${endpoint.origin}/#/settings`);
        const theme = page.getByRole('group', { name: 'Theme', exact: true });
        const dark = theme.getByRole('button', { name: 'Dark', exact: true });
        await dark.waitFor();
        // A drag beginning on a choice must leave it unchanged and permit page scrolling.
        assert.equal(
          await dark.evaluate((el) => {
            const down = new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: 77,
              isPrimary: true,
              button: 0,
              clientX: 100,
              clientY: 200,
            });
            // Synthetic contacts cannot take native capture.
            const capture = el.setPointerCapture;
            el.setPointerCapture = () => {};
            try {
              el.dispatchEvent(down);
              for (const [type, y] of [
                ['pointermove', 140],
                ['pointerup', 200],
              ] as const) {
                el.dispatchEvent(
                  new PointerEvent(type, {
                    bubbles: true,
                    pointerId: 77,
                    isPrimary: true,
                    button: 0,
                    clientX: 100,
                    clientY: y,
                  })
                );
              }
              return down.defaultPrevented;
            } finally {
              el.setPointerCapture = capture;
            }
          }),
          false
        );
        if (name === 'chromium') {
          const cdp = await page.context().newCDPSession(page);
          const box = (await dark.boundingBox())!;
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let step = 1; step <= 8; step++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x, y: y - step * 12 }],
            });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          assert.equal(patches.length, 0, 'drag does not submit');
          await page.evaluate(() => window.scrollTo(0, 0));
          await cdp.detach();
        }
        assert.equal(patches.length, 0);
        await dark.click({ button: 'right' });
        await dark.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
        await dark.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
        await dark.evaluate((el) =>
          el.addEventListener(
            'pointerdown',
            (event) => el.setAttribute('data-pointer', String((event as PointerEvent).pointerId)),
            { once: true }
          )
        );
        await dark.hover();
        await page.mouse.down();
        await dark.dispatchEvent('pointercancel', { pointerId: Number(await dark.getAttribute('data-pointer')) });
        await page.mouse.up();
        assert.equal(patches.length, 0);
        await dark.tap();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        assert.equal(await dark.getAttribute('aria-pressed'), 'true');
        assert.equal(patches.length, 1);
        await dark.tap();
        assert.equal(patches.length, 1);
        const output = process.env.FLOAT_VIEW_SCREENSHOTS;
        if (output && name === 'chromium') {
          await mkdir(output, { recursive: true });
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${output}/settings-dark.png` });
        }
        const light = theme.getByRole('button', { name: 'Light', exact: true });
        await light.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        const imperial = page
          .getByRole('group', { name: 'Units', exact: true })
          .getByRole('button', { name: 'Imperial', exact: true });
        await imperial.focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(
          () =>
            document.querySelector('[aria-label="Units"] button:last-child')?.getAttribute('aria-pressed') === 'true'
        );
        assert.equal(patches.length, 3);
        if (output && name === 'chromium') {
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${output}/settings-light.png` });
        }
        reject = true;
        await page
          .getByRole('group', { name: 'Units', exact: true })
          .getByRole('button', { name: 'Metric', exact: true })
          .dispatchEvent('click', { detail: 0 });
        await page.getByRole('alert').filter({ hasText: 'Settings save failed' }).waitFor();
        assert.equal(await imperial.getAttribute('aria-pressed'), 'true');
        assert.equal(patches.length, 4);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        await stopMockServer();
      }
    }
  );
}
