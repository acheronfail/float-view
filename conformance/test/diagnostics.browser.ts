import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: single-button diagnostics export and manual reporting`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: name === 'webkit' ? 390 : 1280, height: 844 },
        hasTouch: true,
      });
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      const methods: string[] = [];
      let sockets = 0;
      page.on('websocket', (socket) => {
        sockets++;
        socket.on('framesent', ({ payload }) => {
          const request = JSON.parse(String(payload));
          if (request.method?.startsWith('diagnostics.')) methods.push(request.method);
        });
      });
      const requests: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('github.com')) requests.push(r.url());
      });
      await page.goto(`${endpoint.origin}/#/settings/help`);
      const section = page.locator('#diagnostics');
      const open = section.getByRole('button', { name: 'Export logs', exact: true });
      await open.waitFor();
      assert.equal(await section.getByRole('button').count(), 1);
      await open.click({ button: 'right' });
      assert.equal(methods.includes('diagnostics.prepare'), false);
      await open.focus();
      await page.keyboard.press('Enter');
      await open.waitFor();
      await page.waitForFunction(
        () => document.querySelector<HTMLButtonElement>('#diagnostics button')?.disabled === false
      );
      assert.equal(await section.getByRole('status').count(), 0);
      assert.deepEqual(
        methods.filter((m) => m !== 'diagnostics.report'),
        ['diagnostics.list', 'diagnostics.prepare', 'diagnostics.export']
      );
      assert.equal(await page.getByLabel('Diagnostic report preview').count(), 0);
      const link = section.getByRole('link', { name: 'GitHub Issues', exact: true });
      assert.equal(await link.getAttribute('href'), 'https://github.com/acheronfail/float-view/issues');
      assert.equal(requests.length, 0);
      assert.match(await section.innerText(), /add a new report/);
      assert.match(await section.innerText(), /Anyone can see reports and attached files/);
      // Navigating away must not lose the connection-owned replacement handle.
      for (let i = 0; i < 3; i++) {
        await page.locator('a[href="#/settings"]').first().click();
        await section.waitFor({ state: 'detached' });
        await page.locator('a[href="#/settings/help"]').first().click();
        await open.waitFor();
        await open.tap();
        await page.waitForFunction(
          () => document.querySelector<HTMLButtonElement>('#diagnostics button')?.disabled === false
        );
        assert.equal(await section.getByRole('status').count(), 0);
        assert.equal(await section.getByRole('alert').count(), 0);
      }
      assert.equal(methods.filter((m) => m === 'diagnostics.export').length, 4);
      assert.equal(sockets, 1, 'the report owner survives in-app navigation');
      assert.equal(await section.getByRole('button').count(), 1);
      await page.screenshot({ path: `/tmp/float-view-diagnostics-${name}.png`, fullPage: true });
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
