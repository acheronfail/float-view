import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: licences open in a separate scrollable route offline`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 700 } });
      if (name === 'chromium') {
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      }
      const externalRequests: string[] = [];
      await page.route('**/*', async (route) => {
        if (route.request().url().startsWith(endpoint.origin)) await route.continue();
        else {
          externalRequests.push(route.request().url());
          await route.abort();
        }
      });
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto(`${endpoint.origin}/#/settings/about`);
      const section = page.getByRole('region', { name: 'Open source and licences' });
      await section.waitFor();
      assert.match(await section.innerText(), /Copyright © 2025 acheronfail/);
      assert.match(await section.innerText(), /Luis Prado/);
      assert.equal(
        await section.getByRole('link', { name: 'Privacy policy', exact: true }).getAttribute('href'),
        'https://github.com/acheronfail/float-view/blob/master/PRIVACY.md'
      );
      assert.equal(
        await section.getByRole('link', { name: 'Support', exact: true }).getAttribute('href'),
        'https://github.com/acheronfail/float-view/issues'
      );
      const button = section.getByRole('link', { name: 'View licences and notices' });
      await button.scrollIntoViewIfNeeded();
      const alignment = await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        return {
          x: Math.abs(text.x + text.width / 2 - bounds.x - bounds.width / 2),
          y: Math.abs(text.y + text.height / 2 - bounds.y - bounds.height / 2),
        };
      });
      assert.ok(alignment.x < 2 && alignment.y < 2, 'licences link text is centred');
      for (const pointer of [
        { button: 2, isPrimary: true },
        { button: 0, isPrimary: false },
      ]) {
        await button.dispatchEvent('pointerdown', { ...pointer, pointerId: 1 });
        await button.dispatchEvent('pointerup', { ...pointer, pointerId: 1 });
      }
      await button.dispatchEvent('pointerdown', { button: 0, isPrimary: true, pointerId: 2 });
      await button.dispatchEvent('pointercancel', { pointerId: 2 });
      await button.dispatchEvent('pointerup', { button: 0, isPrimary: true, pointerId: 2 });
      assert.ok(page.url().endsWith('#/settings/about'));
      assert.equal(await page.getByRole('region', { name: 'Project licence', exact: true }).count(), 0);
      await button.tap();
      await page.getByRole('heading', { name: 'Licences and notices', exact: true }).waitFor();
      assert.ok(page.url().endsWith('#/settings/licences'));
      const main = page.locator('main');
      assert.equal(await main.locator('button[aria-expanded="true"]').count(), 0);
      assert.equal(await main.locator('pre:visible').count(), 0);
      const project = main.getByRole('button', { name: 'Project licence', exact: true });
      for (const pointer of [
        { button: 2, isPrimary: true },
        { button: 0, isPrimary: false },
      ]) {
        await project.dispatchEvent('pointerdown', { ...pointer, pointerId: 10 });
        await project.dispatchEvent('pointerup', { ...pointer, pointerId: 10 });
      }
      await project.dispatchEvent('pointerdown', { button: 0, isPrimary: true, pointerId: 12 });
      await project.dispatchEvent('pointercancel', { pointerId: 12 });
      await project.dispatchEvent('pointerup', { button: 0, isPrimary: true, pointerId: 12 });
      assert.equal(await project.getAttribute('aria-expanded'), 'false');
      await project.tap();
      assert.equal(await project.getAttribute('aria-expanded'), 'true');
      assert.match(await main.innerText(), /GNU AFFERO GENERAL PUBLIC LICENSE/);
      await page.evaluate(() => window.scrollTo(0, 2000));
      assert.ok(await page.evaluate(() => window.scrollY > 0));
      await project.focus();
      await page.keyboard.press('Space');
      assert.equal(await project.getAttribute('aria-expanded'), 'false');
      await main.getByRole('button', { name: 'Project and artwork notices', exact: true }).tap();
      assert.match(await main.innerText(), /Luis Prado/);
      await main.getByRole('button', { name: 'Third-party notices', exact: true }).tap();
      const frontend = main.getByRole('button', { name: 'Frontend dependencies', exact: true });
      await frontend.focus();
      await page.keyboard.press('Enter');
      const leaflet = main.getByRole('button', { name: 'Frontend: leaflet 1.9.4', exact: true });
      assert.equal(await leaflet.getAttribute('aria-expanded'), 'false');
      await leaflet.tap();
      assert.match(await main.innerText(), /Volodymyr Agafonkin/);
      await main.getByRole('button', { name: 'Artwork and bundled runtimes', exact: true }).tap();
      await main.getByRole('button', { name: /^Generated icons:/ }).tap();
      assert.match(await main.innerText(), /Cole Bemis/);
      await main.getByRole('button', { name: /^Rust runtime / }).tap();
      assert.match(await main.innerText(), /Rust Standard Library/);
      assert.match(await main.innerText(), /Apache License/);
      for (const viewport of [
        { width: 834, height: 1194 },
        { width: 1194, height: 834 },
        { width: 375, height: 760 },
      ]) {
        await page.setViewportSize(viewport);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          'expanded notices fit iPad portrait, landscape and a narrow resized window'
        );
      }
      const back = page.getByRole('link', { name: 'About', exact: true });
      await back.focus();
      await page.keyboard.press('Enter');
      await section.waitFor();
      assert.ok(page.url().endsWith('#/settings/about'));
      // Keyboard opens the route too; native Back returns to Settings.
      await button.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Licences and notices', exact: true }).waitFor();
      assert.equal(await main.locator('button[aria-expanded="true"]').count(), 0, 'returning starts collapsed');
      await page.evaluate(() => window.dispatchEvent(new Event('floatview:back')));
      await section.waitFor();
      assert.deepEqual(externalRequests, []);
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
