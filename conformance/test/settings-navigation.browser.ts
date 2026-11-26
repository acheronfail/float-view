import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';
import { ConformanceClient } from '../src/client.ts';
import { dragFromControl } from './support/drag-from-control.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: focused Settings navigation, saved controls and review layouts`, { timeout: 60_000 }, async () => {
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
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      const screenshot = async (label: string, fullPage = false) => {
        if (!process.env.FLOAT_VIEW_SCREENSHOTS || name !== 'chromium') return;
        await mkdir(process.env.FLOAT_VIEW_SCREENSHOTS, { recursive: true });
        await page.locator('[data-route-content]').waitFor({ state: 'visible' });
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        );
        await page.screenshot({
          path: `${process.env.FLOAT_VIEW_SCREENSHOTS}/${label}.png`,
          fullPage,
          animations: 'disabled',
        });
      };
      await page.goto(`${endpoint.origin}/#/settings`);
      const categories = page.getByRole('navigation', { name: 'Settings categories' });
      await categories.waitFor();
      const version = await page.locator('header p').innerText();
      assert.match(version, /^(?:v\d+\.\d+\.\d+(?:-\S+)?|Development build)$/);
      const tabs = page.getByRole('navigation', { name: 'Primary' });
      await dragFromControl(tabs.getByRole('link', { name: 'sessions', exact: true }));
      assert.match(page.url(), /#\/settings$/);
      assert.equal(await categories.getByRole('link').count(), 7);
      assert.deepEqual(
        await categories
          .getByRole('link')
          .evaluateAll((links) => links.slice(0, 3).map((link) => link.getAttribute('href'))),
        ['#/settings/appearance', '#/settings/announcements', '#/settings/recording']
      );
      assert.equal(await page.getByRole('spinbutton').count(), 0);
      assert.equal(await page.getByRole('switch').count(), 0);
      assert.doesNotMatch(await page.locator('header').innerText(), /tracked across|Loading/);
      await screenshot('settings-home');
      for (const title of [
        'Appearance & units',
        'Ride recording',
        'Ride announcements',
        'Connection & permissions',
        'Data & backups',
        'Help & diagnostics',
        'About',
      ]) {
        await categories.getByRole('link').filter({ hasText: title }).tap();
        await page.getByRole('heading', { name: title, exact: true }).waitFor();
        await page.getByRole('link', { name: 'Settings', exact: true }).tap();
        await categories.waitFor();
      }
      await page.setViewportSize({ width: 320, height: 568 });
      const about = categories.getByRole('link', { name: 'About Source code and licences' });
      await about.focus();
      await page.keyboard.press('Tab');
      await about.focus();
      const top = (await about.boundingBox())!.y;
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'About', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Settings', exact: true }).focus();
      await page.keyboard.press('Enter');
      await categories.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('href') === '#/settings/about');
      assert.ok(Math.abs((await about.boundingBox())!.y - top) < 2, 'keyboard return restores position');
      await screenshot('settings-home-narrow', true);
      await categories.getByRole('link').filter({ hasText: 'Ride recording' }).tap();
      await page.getByRole('heading', { name: 'Ride recording', exact: true }).waitFor();
      await page.goBack();
      await categories.waitFor();
      await categories.getByRole('link').filter({ hasText: 'Ride recording' }).tap();
      await page.getByRole('heading', { name: 'Ride recording', exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event('floatview:back')));
      await categories.waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await categories.getByRole('link').filter({ hasText: 'Ride recording' }).tap();
      const advanced = page.locator('details');
      await advanced.waitFor();
      assert.equal(await advanced.getAttribute('open'), null);
      assert.equal(await page.getByLabel('Idle samples / second').isVisible(), false);
      assert.equal(await page.getByLabel('Minimum ride distance (meters)', { exact: true }).isVisible(), false);
      assert.ok(
        (await page.getByRole('group', { name: 'Record ride location', exact: true }).boundingBox())!.y <
          (await page.getByLabel('Keep ride open after a break (minutes)').boundingBox())!.y,
        'route recording is first'
      );
      await screenshot('settings-recording');
      const disclosure = advanced.locator('summary');
      assert.ok(
        (await disclosure.locator('.disclosure-arrow').boundingBox())!.width >= 24,
        'disclosure arrow is clearly sized'
      );
      await disclosure.tap();
      assert.notEqual(await advanced.getAttribute('open'), null);
      assert.notEqual(
        await disclosure.locator('.disclosure-arrow').evaluate((arrow) => getComputedStyle(arrow).transform),
        'none'
      );
      await disclosure.focus();
      await disclosure.press('Space');
      assert.equal(await advanced.getAttribute('open'), null);
      await disclosure.press('Enter');
      assert.notEqual(await advanced.getAttribute('open'), null);
      await screenshot('settings-recording-advanced', true);
      const samples = page.getByLabel('Riding samples / second');
      await samples.fill('7');
      await samples.blur();
      await client
        .waitForState((s) => s.settings.ridingPersistIntervalMs === Math.round(1000 / 7))
        .catch(() => {
          throw new Error('(s) => s.settings.ridingPersistIntervalMs === Math.round(1000 / 7)');
        });
      const recording = page.getByRole('group', { name: 'Record ride location', exact: true });
      const on = recording.getByRole('button', { name: 'On', exact: true });
      const off = recording.getByRole('button', { name: 'Off', exact: true });
      await off.waitFor();
      assert.equal(await off.getAttribute('aria-pressed'), 'true');
      await on.click({ button: 'right' });
      await on.dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 2 });
      await on.dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 2 });
      assert.equal(await off.getAttribute('aria-pressed'), 'true');
      await on.tap();
      await client.waitForState((s) => s.settings.locationRecordingEnabled);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Record ride location"] button[aria-pressed="true"]')
            ?.textContent?.trim() === 'On'
      );
      await off.focus();
      await page.keyboard.press('Space');
      await client.waitForState((s) => !s.settings.locationRecordingEnabled);
      assert.ok((await on.boundingBox())!.height >= 44);
      const permissionsLink = page.getByRole('link', { name: 'Location permissions', exact: true });
      assert.equal(await permissionsLink.getAttribute('href'), '#/settings/connection');
      assert.equal(await permissionsLink.getAttribute('target'), null);
      assert.equal(await permissionsLink.locator('.i-lucide-chevron-right').count(), 1);
      await permissionsLink.tap();
      await page.getByRole('heading', { name: 'Connection & permissions', exact: true }).waitFor();
      await page.goto(`${endpoint.origin}/#/settings/announcements`);
      const speed = page
        .getByRole('group', { name: 'Speed', exact: true })
        .getByRole('button', { name: 'On', exact: true });
      const speedOff = page
        .getByRole('group', { name: 'Speed', exact: true })
        .getByRole('button', { name: 'Off', exact: true });
      await speed.waitFor();
      await screenshot('settings-announcements');
      await page.setViewportSize({ width: 390, height: 568 });
      const audioHeading = page.getByRole('heading', { name: 'Audio & timing', exact: true });
      await audioHeading.evaluate((heading) => {
        const top = parseFloat(getComputedStyle(heading).top);
        window.scrollTo({ top: window.scrollY + heading.getBoundingClientRect().top - top + 4, behavior: 'instant' });
      });
      await screenshot('settings-announcements-audio-sticky');
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      const sticky = await audioHeading.evaluate((heading) => ({
        top: heading.getBoundingClientRect().top,
        expected: parseFloat(getComputedStyle(heading).top),
        width: heading.getBoundingClientRect().width,
        contentWidth: document.querySelector('[data-route-content]')!.getBoundingClientRect().width,
      }));
      assert.ok(
        Math.abs(sticky.top - sticky.expected) < 2,
        `audio heading sticks below the page header: ${JSON.stringify(sticky)}`
      );
      assert.ok(Math.abs(sticky.width - sticky.contentWidth) < 2, 'heading spans the content without card insets');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.setViewportSize({ width: 390, height: 844 });
      await speed.tap();
      const threshold = page.getByLabel('Speed threshold (km/h)', { exact: true });
      await threshold.fill('31');
      await threshold.blur();
      await client
        .waitForState((s) => s.settings.announcements.speedThresholdKph === 31)
        .catch(() => {
          throw new Error('(s) => s.settings.announcements.speedThresholdKph === 31');
        });
      await speedOff.tap();
      await client
        .waitForState((s) => !s.settings.announcements.speedEnabled)
        .catch(() => {
          throw new Error('(s) => !s.settings.announcements.speedEnabled');
        });
      await threshold.waitFor({ state: 'hidden' });
      await speed.tap();
      assert.equal(await threshold.inputValue(), '31');
      await screenshot('settings-announcements-enabled', true);
      for (const themePreference of ['light', 'dark'] as const) {
        const state = await client.request('state.get', {});
        await client.request('settings.update', {
          expectedRevision: state.settings.revision,
          patch: { themePreference },
        });
        await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, themePreference);
        for (const category of [
          '',
          '/recording',
          '/announcements',
          '/appearance',
          '/connection',
          '/data',
          '/help',
          '/about',
        ]) {
          await page.goto(`${endpoint.origin}/#/settings${category}`);
          const titles: Record<string, string> = {
            '': 'Settings',
            '/recording': 'Ride recording',
            '/announcements': 'Ride announcements',
            '/appearance': 'Appearance & units',
            '/connection': 'Connection & permissions',
            '/data': 'Data & backups',
            '/help': 'Help & diagnostics',
            '/about': 'About',
          };
          const title = titles[category]!;
          await page.getByRole('heading', { name: title, exact: true }).waitFor();
          await page.getByRole('region', { name: 'Settings', exact: true }).waitFor();
          await screenshot(`settings${category.replace('/', '-') || '-home'}-${themePreference}`, true);
          await page.setViewportSize({ width: 320, height: 568 });
          const style = await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
          await screenshot(`settings${category.replace('/', '-') || '-home'}-${themePreference}-large-text`, true);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
            `${category} fits large text at 320px: ${JSON.stringify(await page.locator('body *').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().right > innerWidth).map((node) => ({ tag: node.tagName, text: node.textContent?.slice(0, 60), width: node.getBoundingClientRect().width }))))}`
          );
          const splitWords = await page.locator('header h1').evaluate((heading) => {
            const text = heading.firstChild!;
            const value = text.textContent!;
            return [...value.matchAll(/\S+/g)]
              .filter((word) => {
                const range = document.createRange();
                range.setStart(text, word.index!);
                range.setEnd(text, word.index! + word[0].length);
                return range.getClientRects().length > 1;
              })
              .map((word) => word[0]);
          });
          assert.deepEqual(splitWords, [], 'large-text titles wrap between words');
          await style.evaluate((element) => element.parentNode?.removeChild(element));
          await page.setViewportSize({ width: 390, height: 844 });
        }
      }
      // iOS voice guidance has the same labelled section as hosts with a voice chooser.
      await page.route(`${endpoint.origin}/api/bootstrap`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ json: { ...(await response.json()), platform: 'ios' } });
      });
      await page.goto(`${endpoint.origin}/#/settings/announcements`);
      const voice = page.getByRole('region', { name: 'Announcement voice', exact: true });
      await voice.getByRole('heading', { name: 'Announcement voice', exact: true }).waitFor();
      assert.match(await voice.innerText(), /On iPhone: Settings.*Voices/);
      await voice.scrollIntoViewIfNeeded();
      await screenshot('settings-announcements-voice-ios');
      await page.goto(`${endpoint.origin}/#/settings/about`);
      await page.getByRole('heading', { name: 'About', exact: true }).waitFor();
      const aboutHeading = page.getByRole('heading', { name: 'Open source and licences', exact: true, level: 3 });
      await aboutHeading.waitFor();
      assert.equal(await aboutHeading.evaluate((heading) => getComputedStyle(heading).position), 'sticky');
      assert.equal(await page.getByText(version, { exact: true }).count(), 0);
      await screenshot('settings-about');
      await page.goto(`${endpoint.origin}/#/settings/missing`);
      await page.getByText('This settings page is unavailable.', { exact: false }).waitFor();
      await page.getByRole('link', { name: 'Settings', exact: true }).tap();
      await categories.waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      client.close();
      await stopMockServer();
    }
  });
}
