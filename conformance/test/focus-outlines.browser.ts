import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: touch focus stays quiet and keyboard focus remains visible`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      for (const hasTouch of [true, false]) {
        const page = await browser.newPage({ hasTouch, viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(5000);
        if (name === 'chromium')
          await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
        await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto(`${endpoint.origin}/#/settings`);
        const theme = page.getByRole('group', { name: 'Theme', exact: true });
        const system = theme.getByRole('button', { name: 'System', exact: true });
        const light = theme.getByRole('button', { name: 'Light', exact: true });
        await system.waitFor();
        assert.equal(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), hasTouch);
        // Initial programmatic focus includes Tailwind's explicit focus-visible outline.
        await system.focus();
        if (hasTouch) assert.equal(await system.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
        // macOS WebKit uses Option-Tab to include buttons in sequential focus.
        await page.keyboard.press(name === 'webkit' ? 'Alt+Tab' : 'Tab');
        assert.equal(await light.evaluate((el) => el === document.activeElement), true);
        assert.notEqual(await light.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
        if (hasTouch) {
          await light.tap();
          // Restored focus after pointer dismissal must also stay quiet.
          await system.focus();
          assert.equal(await system.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
          await page.goto(`${endpoint.origin}/#/settings/recording`);
          const input = page.locator('input').first();
          await input.tap();
          await input.press('1');
          assert.equal(await input.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
          await page.goto(`${endpoint.origin}/#/settings`);
          await system.waitFor();
          await page.keyboard.press('Tab');
          await system.focus();
          assert.notEqual(await system.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
        }
        await page.close();
      }
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
