import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: persisted footpad map toggles and exact fault states`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ hasTouch: true, reducedMotion: 'reduce' });
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
      await page.route('**/api/session-data', async (route) => {
        const response = await route.fetch();
        const value = await response.json();
        if (value.kind === 'events') {
          value.page = {
            elapsedMs: [100, 200, 800, 2000, 2100, 3500],
            sequence: [0, 1, 2, 3, 4, 5],
            sourceSampleSequence: [1, 2, 4, 6, 7, 9],
            kinds: ['footpadState', 'packageMode', 'packageMode', 'packageMode', 'footpadState', 'packageMode'],
            values: ['none', 'flywheel', 'normal', 'flywheel', 'left', 'normal'],
          };
          value.nextCursor = null;
        }
        if (value.kind === 'samples' && value.fields.length === 1 && value.fields[0].name === 'speedKph') {
          value.elapsedMs = [0, 100, 200, 500, 800, 1000, 2000, 2100, 2200, 3500, 4000, 5000, 12000];
          value.sequence = value.elapsedMs.map((_: number, i: number) => i);
          value.values = { speedKph: [0, 0, 0, 10, 0, 10, 0, 0, 10, 0, 10, 0, 10] };
          value.nextCursor = null;
        }
        if (value.kind === 'locations') {
          value.points = [0, 5000, 20000].map((elapsedMs, i) => ({
            locationSequence: i + 1,
            elapsedMs,
            latitude: -33.8 + i * 0.001,
            longitude: 151.2 + i * 0.001,
            accuracyM: 5,
            altitudeM: null,
            observedAt: '2026-01-01T00:00:00Z',
          }));
          value.gaps = [];
          value.nextCursor = null;
        }
        await route.fulfill({ response, json: value });
      });
      await page.goto(`${endpoint.origin}/#/sessions/session-1`);
      await page.getByRole('button', { name: 'Session actions', exact: true }).click();
      const both = page.getByRole('switch', { name: 'Both footpads off at speed', exact: true });
      const one = page.getByRole('switch', { name: 'One footpad off at speed', exact: true });
      assert.equal(await both.getAttribute('aria-checked'), 'false');
      await both.dispatchEvent('pointerdown', { button: 2, isPrimary: true, pointerId: 1 });
      await both.dispatchEvent('pointerup', { button: 2, isPrimary: true, pointerId: 1 });
      assert.equal(await both.getAttribute('aria-checked'), 'false');
      await both.tap();
      await page.locator('.footpad-fault-marker').waitFor();
      assert.equal(await both.getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('.footpad-fault-marker').count(), 1, 'flywheel must not add a both-pad marker');
      assert.equal(await page.locator('.footpad-fault-marker path[fill="#ef4444"]').count(), 2);
      await one.focus();
      await page.keyboard.press('Space');
      await page.getByRole('button', { name: /Right footpad inactive; left active/ }).waitFor();
      assert.equal(
        await page.locator('.footpad-fault-marker').count(),
        2,
        'flywheel and GPS gaps must not add markers'
      );
      assert.equal(await page.locator('.footpad-fault-marker path[fill="#22c55e"]').count(), 1);
      await page.getByRole('button', { name: 'Session actions', exact: true }).click();
      const rightFault = page.getByRole('button', { name: /Right footpad inactive; left active/ });
      const bothFault = page.getByRole('button', { name: /Both footpads inactive above/ });
      const cursors = page.locator('[data-history-inspection]');
      await rightFault.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 9 });
      await rightFault.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 9 });
      assert.equal(await cursors.count(), 0);
      await rightFault.tap();
      await cursors.first().waitFor({ state: 'attached' });
      const expectCursorAt = async (elapsedMs: number) => {
        await page.waitForFunction((ratio) => {
          const lines = [...document.querySelectorAll('[data-history-inspection]')];
          return (
            lines.length > 0 &&
            lines.every((line) => {
              const parent = line.parentElement!.getBoundingClientRect();
              return Math.abs(line.getBoundingClientRect().left - parent.left - parent.width * ratio) < 0.75;
            })
          );
        }, elapsedMs / 60000);
      };
      await expectCursorAt(4000);
      await bothFault.focus();
      await page.keyboard.press('Enter');
      await expectCursorAt(1000);
      await rightFault.focus();
      await page.keyboard.press('Space');
      await expectCursorAt(4000);
      await page.reload();
      await page.getByRole('button', { name: /Right footpad inactive; left active/ }).waitFor();
      await page.getByRole('button', { name: 'Session actions', exact: true }).click();
      assert.equal(await both.getAttribute('aria-checked'), 'true');
      assert.equal(await one.getAttribute('aria-checked'), 'true');
      await both.tap();
      await page.getByRole('button', { name: /Both footpads inactive above/ }).waitFor({ state: 'detached' });
      assert.equal(await page.locator('.footpad-fault-marker').count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
