import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
// WCAG 2.x relative luminance; do not round before comparing thresholds.
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    if (/^#[a-f0-9]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map((channel) => channel + channel).join('');
    const channels = color.startsWith('#')
      ? [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16))
      : color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
    return channels
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  };
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(
    `${name}: accent presets apply across themes and retain authoritative selection`,
    { timeout: 60000 },
    async () => {
      const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
      const endpoint = getMockBootstrap(port);
      const client = await ConformanceClient.open(endpoint.webSocketUrl, endpoint.origin);
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
        page.on('pageerror', (error) => errors.push(error.message));
        let updates = 0;
        await page.routeWebSocket('**/api/ws?*', (socket) => {
          const server = socket.connectToServer();
          socket.onMessage((raw) => {
            if (JSON.parse(String(raw)).method === 'settings.update') updates++;
            server.send(raw);
          });
          server.onMessage((raw) => socket.send(raw));
        });
        await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto(`${endpoint.origin}/#/settings`);
        const group = page.getByRole('group', { name: 'Accent color', exact: true });
        const initialTeal = group.getByRole('button', { name: 'Teal', exact: true });
        await initialTeal.waitFor();
        assert.equal(await initialTeal.getAttribute('aria-pressed'), 'true');
        for (const width of [320, 390, 768]) {
          await page.setViewportSize({ width, height: 844 });
          const bounds = await group.getByRole('button').evaluateAll((buttons) =>
            buttons.map((button) => {
              const { x, y, width, height } = button.getBoundingClientRect();
              return { x, y, width, height, text: button.textContent?.trim() };
            })
          );
          assert.equal(bounds.length, 5);
          assert.equal(new Set(bounds.map((box) => box.y)).size, 1, 'swatches stay on one line');
          assert.ok(
            bounds.every((box) => box.width >= 44 && box.height >= 44 && !box.text),
            'circles keep touch targets without visible names'
          );
          assert.ok(
            bounds.every((box) => box.x >= 0 && box.x + box.width <= width),
            'all swatches fit'
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });

        const blue = group.getByRole('button', { name: 'Blue', exact: true });
        await blue.click({ button: 'right' });
        await blue.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
        await blue.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
        assert.equal(updates, 0);
        await blue.tap();
        await page.waitForFunction(() => document.documentElement.dataset.accent === 'blue');
        await page.waitForTimeout(150);
        assert.equal(updates, 1, 'touch submits once');
        assert.equal(await blue.getAttribute('aria-pressed'), 'true');
        const teal = group.getByRole('button', { name: 'Teal', exact: true });
        await teal.focus();
        await teal.press('Enter');
        await page.waitForFunction(() => document.documentElement.dataset.accent === 'teal');
        assert.equal(updates, 2, 'keyboard submits once');
        for (const themePreference of ['light', 'dark'] as const) {
          const state = await client.request('state.get', {});
          await client.request('settings.update', {
            expectedRevision: state.settings.revision,
            patch: { themePreference },
          });
          await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, themePreference);
          const colors = new Set<string>();
          for (const accent of ['Purple', 'Blue', 'Teal', 'Amber', 'Rose']) {
            await group.getByRole('button', { name: accent, exact: true }).tap();
            await page.waitForFunction(
              (value) => document.documentElement.dataset.accent === value,
              accent.toLowerCase()
            );
            colors.add(
              await page.evaluate(() =>
                getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim()
              )
            );
            const tokens = await page.evaluate(() => {
              const style = getComputedStyle(document.documentElement);
              return Object.fromEntries(
                [
                  'canvas',
                  'surface',
                  'elevated',
                  'foreground',
                  'muted',
                  'accent',
                  'accent-fill',
                  'on-accent',
                  'accent-soft',
                  'on-accent-soft',
                  'warning',
                  'on-warning',
                  'danger',
                  'on-danger',
                ].map((token) => [token, style.getPropertyValue(`--app-${token}`).trim()])
              );
            });
            const assertContrast = (foreground: string, background: string, minimum: number, use: string) => {
              const ratio = contrast(tokens[foreground]!, tokens[background]!);
              assert.ok(
                ratio >= minimum,
                `${themePreference}/${accent}: ${use} (${foreground}/${background}) is ${ratio.toFixed(3)}:1; needs ${minimum}:1`
              );
            };
            // Headings, links, live readings and labels on ordinary and selected cards.
            for (const background of ['canvas', 'surface', 'elevated', 'accent-soft']) {
              assertContrast('accent', background, 4.5, 'small accent text');
              assertContrast('foreground', background, 4.5, 'card title');
              assertContrast('muted', background, 4.5, 'card subtitle / selected-value hint');
              // Also used for chart lines, gauge strokes, borders and focus outlines.
              assertContrast('accent', background, 3, 'graphics / focus / selection border');
            }
            const approvedLightFills: Record<string, string> = { Teal: '#14b8a6', Amber: '#e9a008' };
            if (themePreference === 'light' && approvedLightFills[accent]) {
              assert.equal(
                tokens['accent-fill'],
                approvedLightFills[accent],
                'approved icon colour is used for UI fills'
              );
            }
            assertContrast('on-accent', 'accent-fill', 4.5, 'solid button / segmented control / toggle');
            assertContrast('on-accent-soft', 'accent-soft', 4.5, 'selected navigation / status / preset');
            assertContrast('on-warning', 'warning', 4.5, 'warning confirmation / flywheel disable');
            assertContrast('on-danger', 'danger', 4.5, 'destructive confirmation');

            // Resolve actual rendered classes and inherited backgrounds as well.
            const rendered = await page.evaluate(() => {
              const targets = [
                ...document.querySelectorAll('section[aria-label="Settings"] button[aria-pressed="true"]'),
                ...document.querySelectorAll('section[aria-label="Settings"] .text-accent'),
                ...document.querySelectorAll('nav [aria-current="page"]'),
                ...document.querySelectorAll('header h1'),
              ];
              return targets.map((element) => {
                let parent: Element | null = element;
                let background = '';
                while (parent) {
                  background = getComputedStyle(parent).backgroundColor;
                  if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
                  parent = parent.parentElement;
                }
                return { label: element.textContent?.trim(), foreground: getComputedStyle(element).color, background };
              });
            });
            assert.ok(rendered.length >= 4, 'checks real headings and selected controls');
            for (const element of rendered) {
              assert.ok(
                contrast(element.foreground, element.background) >= 4.5,
                `${themePreference}/${accent}: rendered ${element.label} (${element.foreground} on ${element.background}) has insufficient contrast`
              );
            }
            const selected = group.locator('button[aria-pressed="true"]');
            assert.equal(await group.locator('button[aria-pressed="true"]').count(), 1);
            assert.equal(await selected.locator('svg').count(), 1, 'selected circle has a checkmark');
            const selection = await selected.evaluate((button) => {
              const swatch = button.querySelector('span')!;
              return {
                check: getComputedStyle(button.querySelector('svg')!).color,
                swatch: getComputedStyle(swatch).backgroundColor,
                ring: getComputedStyle(button).borderColor,
                background: getComputedStyle(document.body).backgroundColor,
                accentFill: getComputedStyle(document.documentElement).getPropertyValue('--app-accent-fill').trim(),
              };
            });
            assert.equal(
              contrast(selection.swatch, selection.accentFill),
              1,
              'swatch matches the applied solid fill in each theme'
            );
            assert.ok(contrast(selection.check, selection.swatch) >= 3, 'checkmark contrasts with swatch');
            assert.ok(contrast(selection.ring, selection.background) >= 3, 'selection ring contrasts with canvas');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          }
          assert.equal(colors.size, 5);
          await page.goto(`${endpoint.origin}/#/sessions/session-1`);
          for (const action of ['Prune', 'Delete session']) {
            await page.getByRole('button', { name: 'Session actions', exact: true }).tap();
            await page.getByRole('button', { name: action, exact: true }).tap();
            const dialog = page.getByRole('alertdialog');
            await dialog.waitFor();
            const buttons = await dialog.getByRole('button').evaluateAll((elements) =>
              elements.map((element) => {
                let parent: Element | null = element;
                let background = '';
                while (parent) {
                  background = getComputedStyle(parent).backgroundColor;
                  if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
                  parent = parent.parentElement;
                }
                return { label: element.textContent?.trim(), foreground: getComputedStyle(element).color, background };
              })
            );
            assert.equal(buttons.length, 2);
            for (const button of buttons) {
              assert.ok(
                contrast(button.foreground, button.background) >= 4.5,
                `${themePreference}: ${action} dialog ${button.label} (${button.foreground} on ${button.background}) needs 4.5:1 contrast`
              );
            }
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
            await dialog.waitFor({ state: 'hidden' });
          }
          await page.goto(`${endpoint.origin}/#/settings`);
          await group.waitFor();
        }
        await page.reload();
        await group.waitFor();
        await page.waitForFunction(() => document.documentElement.dataset.accent === 'rose');
        assert.equal(
          await group.getByRole('button', { name: 'Rose', exact: true }).getAttribute('aria-pressed'),
          'true'
        );
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        client.close();
        await stopMockServer();
      }
    }
  );
}
