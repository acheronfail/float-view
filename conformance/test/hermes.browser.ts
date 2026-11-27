import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { getMockBootstrap, startMockServer, stopMockServer } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: Ride Hermes settings and per-ride upload`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const { origin } = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ hasTouch: true, reducedMotion: 'reduce' });
      if (name === 'chromium') await page.context().grantPermissions(['local-network-access'], { origin });
      const methods: string[] = [];
      let uncertain = false;
      let retryRequested = false;
      await page.routeWebSocket('**/api/ws*', (route) => {
        const server = route.connectToServer();
        const statusReads = new Set<number>();
        route.onMessage((payload) => {
          const request = JSON.parse(String(payload));
          if (request.method === 'hermes.ride') statusReads.add(request.id);
          if (request.method === 'hermes.upload' && request.params.retry) {
            retryRequested = true;
            uncertain = false;
            route.send(JSON.stringify({ id: request.id, result: { accepted: true } }));
          } else {
            server.send(payload);
          }
        });
        server.onMessage((payload) => {
          const response = JSON.parse(String(payload));
          if (statusReads.delete(response.id) && uncertain && response.result) {
            response.result = { ...response.result, status: 'uncertain', rideId: null };
            route.send(JSON.stringify(response));
          } else {
            route.send(payload);
          }
        });
      });
      page.on('websocket', (socket) =>
        socket.on('framesent', (frame) => methods.push(JSON.parse(String(frame.payload)).method))
      );
      await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto(`${origin}/#/sessions/session-1`);
      await page.getByRole('button', { name: 'Session actions' }).click();
      assert.equal(await page.getByText('Upload to Ride Hermes', { exact: true }).count(), 0);

      await page.goto(`${origin}/#/settings`);
      await page.getByText('Integrations', { exact: true }).click();
      const signIn = page.getByRole('button', { name: 'Sign in to Ride Hermes' });
      await signIn.click({ button: 'right' });
      assert.equal(methods.filter((x) => x === 'hermes.signIn').length, 0);
      await signIn.tap();
      await page.getByText('Signed in as Demo rider.').waitFor();

      await page.goto(`${origin}/#/sessions/session-1`);
      await page.getByRole('button', { name: 'Session actions' }).click();
      await page.getByText('Upload to Ride Hermes', { exact: true }).click();
      await page.getByText('Ride data shared', { exact: true }).waitFor();
      assert.equal(methods.filter((x) => x === 'hermes.upload').length, 0);
      await page.getByRole('button', { name: 'Upload ride', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Ride Hermes accepted this ride.').waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).last().click();
      await page.getByRole('button', { name: 'Session actions' }).click();
      await page.getByText('Upload to Ride Hermes', { exact: true }).click();
      await page.getByText('Ride Hermes accepted this ride.').waitFor();
      assert.equal(methods.filter((x) => x === 'hermes.upload').length, 1);
      await page.getByRole('button', { name: 'Close', exact: true }).last().click();
      uncertain = true;
      await page.getByRole('button', { name: 'Session actions' }).click();
      await page.getByText('Upload to Ride Hermes', { exact: true }).click();
      await page.getByRole('heading', { name: 'Check your Ride Hermes history' }).waitFor();
      const retry = page.getByRole('button', { name: 'Retry upload', exact: true });
      await page.getByText(/We couldn’t confirm your last upload/).waitFor();
      assert.equal(await page.getByRole('alertdialog').getByRole('checkbox').count(), 0);
      assert.equal(
        await page.getByRole('link', { name: 'Open Ride Hermes' }).getAttribute('href'),
        'https://ridehermes.app/'
      );
      assert.ok(await retry.isEnabled());
      await retry.click();
      await page.getByText('Ride Hermes accepted this ride.').waitFor();
      assert.ok(retryRequested);
      await page.goto(`${origin}/#/settings/integrations`);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      const signOut = page.getByRole('alertdialog', { name: 'Sign out of Ride Hermes?' });
      await signOut.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('button', { name: 'Sign in to Ride Hermes' }).waitFor();
      await page.goto(`${origin}/#/sessions/session-1`);
      await page.getByRole('button', { name: 'Session actions' }).click();
      assert.equal(await page.getByText('Upload to Ride Hermes', { exact: true }).count(), 0);
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
