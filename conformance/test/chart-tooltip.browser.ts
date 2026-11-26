import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit, type Locator } from 'playwright';
import { startMockServer, stopMockServer, getMockBootstrap } from '../../frontend/backend-mock/index.ts';

const html = await readFile(new URL('../../frontend/build/index.html', import.meta.url), 'utf8');
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: inspection stays full height across sparse readings and gaps`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(5000);
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
      await page.route('**/api/session-data', async (route) => {
        const response = await route.fetch();
        const value = await response.json();
        if (value.kind === 'series') {
          for (const column of Object.values(value.columns)) {
            Object.assign(column as object, {
              elapsedMs: [15000, 20000, 25000, 40000, 45000],
              sequence: [1, 2, 3, 4, 5],
              values: [1, 2, null, 2, 1],
              generations: [0, 0, 0, 1, 1],
            });
          }
        }
        await route.fulfill({ response, json: value });
      });
      await page.goto(`${endpoint.origin}/#/sessions/session-1`);
      const chart = page.getByRole('img', { name: 'Current over elapsed time', exact: true });
      await chart.waitFor();
      await page.getByRole('button', { name: 'Show/hide the map', exact: true }).click();
      await chart.scrollIntoViewIfNeeded();
      const plot = chart.locator('..');
      await page.waitForFunction(() =>
        document.querySelector('svg[aria-label="Current over elapsed time"] path[stroke]')
      );
      await page.mouse.move(0, 0);
      const chartBox = (await chart.boundingBox())!;
      // Round outward so screenshot clipping retains the last column on fractional layouts.
      const clip = {
        x: Math.floor(chartBox.x),
        y: Math.floor(chartBox.y),
        width: Math.ceil(chartBox.x + chartBox.width) - Math.floor(chartBox.x),
        height: Math.ceil(chartBox.y + chartBox.height) - Math.floor(chartBox.y),
      };
      const baseline = (await page.screenshot({ clip })).toString('base64');
      // Enter/leave both ends of a short segment and cross an internal gap.
      for (const ratio of [0.3, 0.1, 0.3, 0.5, 0.7, 0.9, 0.7, 0.5, 0.0001, 0.9999]) {
        const box = (await chart.boundingBox())!;
        await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2);
        await page.waitForFunction(
          ({ ratio }) => {
            const chart = document.querySelector('svg[aria-label="Current over elapsed time"]')!;
            const cursor = chart.parentElement!.querySelector('[data-history-inspection]');
            if (!cursor) return false;
            const box = chart.getBoundingClientRect();
            return Math.abs(cursor.getBoundingClientRect().x - (box.x + box.width * ratio)) < 1;
          },
          { ratio }
        );
        const cursor = plot.locator('[data-history-inspection]');
        assert.equal(await cursor.count(), 1, 'one cursor spans the entire plot');
        const bounds = (await cursor.boundingBox())!;
        assert.ok(Math.abs(bounds.y - box.y) < 1 && Math.abs(bounds.height - box.height) < 1);
        assert.equal(await cursor.evaluate((node) => getComputedStyle(node).left), '0px');
        assert.match(await cursor.evaluate((node) => getComputedStyle(node).transform), /^matrix3?d?\(/);
        const hasReading = ratio === 0.3 || ratio === 0.7;
        assert.equal(await plot.getByRole('status').count(), hasReading ? 1 : 0);
        assert.equal((await plot.locator('[data-history-point]').count()) > 0, hasReading);
        if (!hasReading) {
          // Bounds alone pass even when WebKit paints the cursor in two pieces.
          const hovered = (await page.screenshot({ clip })).toString('base64');
          const paint = await page.evaluate(
            async ({ baseline, hovered, ratio }) => {
              const decode = async (base64: string) => {
                const image = new Image();
                image.src = `data:image/png;base64,${base64}`;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext('2d')!;
                context.drawImage(image, 0, 0);
                return context.getImageData(0, 0, image.width, image.height);
              };
              const before = await decode(baseline);
              const after = await decode(hovered);
              const bands = Array.from({ length: 12 }, () => false);
              let strayPixels = 0;
              for (let y = 0; y < after.height; y++) {
                for (let x = 0; x < after.width; x++) {
                  const offset = (y * after.width + x) * 4;
                  if (
                    ![0, 1, 2].some(
                      (channel) => Math.abs(before.data[offset + channel]! - after.data[offset + channel]!) > 24
                    )
                  )
                    continue;
                  if (Math.abs(x - ratio * after.width) <= 6)
                    bands[Math.min(11, Math.floor((y / after.height) * 12))] = true;
                  else strayPixels++;
                }
              }
              return { bands, strayPixels };
            },
            { baseline, hovered, ratio: (box.x - clip.x + box.width * ratio) / clip.width }
          );
          assert.ok(
            paint.bands.every(Boolean),
            `cursor paints at the hovered x throughout its height at ${ratio}: ${JSON.stringify(paint)}`
          );
          assert.equal(paint.strayPixels, 0, 'no stale cursor fragments remain elsewhere in the plot');
        }
      }
      await page.mouse.move(0, 0);
      await plot.locator('[data-history-inspection]').waitFor({ state: 'detached' });
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
  test(`${name}: tooltips fit mobile charts and leave inspection dots visible`, { timeout: 60_000 }, async () => {
    const port = await startMockServer(11002, { safetyDisclaimerAccepted: true });
    const endpoint = getMockBootstrap(port);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      page.setDefaultTimeout(5000);
      if (name === 'chromium')
        await page.context().grantPermissions(['local-network-access'], { origin: endpoint.origin });
      await page.route(`${endpoint.origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
      await page.routeWebSocket('**/api/ws?*', (socket) => {
        const server = socket.connectToServer();
        server.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          if (message.result?.summary?.sessionId === 'session-1') message.result.markerCount = 1;
          socket.send(JSON.stringify(message));
        });
      });
      await page.route('**/api/session-data', async (route) => {
        const response = await route.fetch();
        const value = await response.json();
        if (value.kind === 'series') {
          for (const [field, column] of Object.entries(value.columns) as [
            string,
            {
              elapsedMs: number[];
              sequence: number[];
              values: number[];
              generations: number[];
            },
          ][]) {
            Object.assign(column, {
              elapsedMs: [0, 29_400, 30_000, 30_600, 60_000],
              sequence: [1, 2, 3, 4, 5],
              values:
                field === 'dutyCycle'
                  ? [-0.4, -0.4, -0.4, -0.4, -0.4]
                  : field === 'motorLoad'
                    ? [0.6, 0.8, 1, 0.91, 0.6]
                    : field === 'batteryLoad'
                      ? [0.75, 0.75, 0.75, 0.75, 0.75]
                      : [123.45, 198.76, 211.23, 222.34, 234.56],
              generations: [0, 0, 0, 0, 0],
            });
          }
        }
        if (value.kind === 'markers') {
          value.markers = [
            {
              sequence: 1,
              elapsedMs: 30000,
              observedAtMs: 30000,
              operationId: '00000000-0000-4000-8000-000000000001',
              location: null,
            },
          ];
          value.nextCursor = null;
        }
        await route.fulfill({ response, json: value });
      });
      await page.goto(`${endpoint.origin}/#/sessions/session-1`);
      const chart = page.getByRole('img', { name: 'Current over elapsed time', exact: true });
      await chart.waitFor();
      const load = page.getByRole('img', { name: 'Load over elapsed time', exact: true });
      await page.getByRole('button', { name: 'Show/hide the map', exact: true }).click();
      await page.mouse.move(0, 0);
      const plot = chart.locator('..');
      async function inspectAt(chart: Locator, ratio: number) {
        const box = (await chart.boundingBox())!;
        await chart.dispatchEvent('pointerleave');
        await chart.dispatchEvent('pointermove', {
          pointerType: 'mouse',
          buttons: 0,
          clientX: box.x + box.width * ratio,
          clientY: box.y + 90,
        });
        const plot = chart.locator('..');
        const tooltip = plot.getByRole('status');
        await tooltip.waitFor();
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        );
        const { bounds, plotBounds, dots } = await tooltip.evaluate((node) => ({
          bounds: node.getBoundingClientRect().toJSON() as DOMRect,
          plotBounds: node.parentElement!.querySelector('svg')!.getBoundingClientRect().toJSON() as DOMRect,
          dots: [...node.parentElement!.querySelectorAll('[data-history-point]')].map(
            (dot) => dot.getBoundingClientRect().toJSON() as DOMRect
          ),
        }));
        const location = `${await chart.getAttribute('aria-label')} at ${ratio}, ${page.viewportSize()!.width}px viewport`;
        assert.ok(bounds.left >= plotBounds.left - 1 && bounds.right <= plotBounds.right + 1, location);
        assert.ok(
          bounds.top >= plotBounds.top && bounds.bottom <= plotBounds.bottom,
          `${location}: tooltip ${JSON.stringify(bounds)}, plot ${JSON.stringify(plotBounds)}`
        );
        assert.equal(await tooltip.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
        assert.ok(dots.length > 0, 'inspection highlights the chart lines');
        for (const dot of dots) {
          assert.ok(Math.abs(dot.width - dot.height) < 0.1, `highlight stays circular: ${location}`);
          assert.equal(dot.width, 7, 'highlight size is independent of plot scaling');
          assert.ok(
            bounds.right <= dot.left - 6 || bounds.left >= dot.right + 6,
            `tooltip leaves space around every inspection dot: ${location}`
          );
        }
        assert.equal(await tooltip.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
        for (const value of await tooltip.locator('.text-right').all()) {
          const valueBounds = (await value.boundingBox())!;
          assert.ok(valueBounds.x >= bounds.x && valueBounds.x + valueBounds.width <= bounds.x + bounds.width);
          assert.match(await value.innerText(), /\d/);
        }
        return tooltip;
      }

      for (const width of [320, 390, 844]) {
        await page.setViewportSize({ width, height: 844 });
        // ResizeObserver reloads the chart series on the next animation frame.
        await page.waitForTimeout(250);
        await chart.scrollIntoViewIfNeeded();
        for (const ratio of [0.01, 0.4, 0.49, 0.51, 0.99]) {
          const tooltip = await inspectAt(chart, ratio);
          assert.match(await tooltip.innerText(), /Motor current/);
          if (ratio === 0.4) {
            assert.equal(
              await tooltip.evaluate((node) => {
                const markerBox = node.parentElement!.querySelector('button')!.getBoundingClientRect();
                const tooltipBox = node.getBoundingClientRect();
                (node as HTMLElement).style.pointerEvents = 'auto';
                const hit = document.elementFromPoint(markerBox.x + markerBox.width / 2, tooltipBox.y + 8);
                (node as HTMLElement).style.pointerEvents = '';
                return node.contains(hit);
              }),
              true,
              'tooltip paints over the ride marker when their bounds intersect'
            );
          }
        }
        await load.scrollIntoViewIfNeeded();
        await load.locator('path[stroke]').nth(2).waitFor({ state: 'attached' });
        const loadTooltip = await inspectAt(load, 0.5);
        assert.match(await loadTooltip.innerText(), /40%/);
        assert.match(await loadTooltip.innerText(), /Motor load:\s+100%/);
        assert.match(await loadTooltip.innerText(), /75%/);
      }
      await chart.scrollIntoViewIfNeeded();
      // Real touch input exercises browser scrolling and pointer cancellation;
      // dispatchEvent alone cannot establish which recognizer owns the gesture.
      if (name === 'chromium') {
        const input = await page.context().newCDPSession(page);
        const box = (await chart.boundingBox())!;
        const x = box.x + box.width * 0.4;
        const y = box.y + box.height * 0.7;
        const scrollY = await page.evaluate(() => window.scrollY);
        const move = async (clientX: number, clientY: number, type: 'touchStart' | 'touchMove' = 'touchMove') => {
          await input.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: [{ x: clientX, y: clientY }],
          });
          await page.waitForTimeout(30);
        };
        await move(x, y, 'touchStart');
        await move(x + 6, y);
        await move(x + 25, y);
        for (let drift = 10; drift <= 90; drift += 10) await move(x + 25, y - drift);
        assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'horizontal inspection owns vertical drift');
        await plot.getByRole('status').waitFor();
        await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await move(x, y, 'touchStart');
        for (let drift = 10; drift <= 90; drift += 10) await move(x, y - drift);
        await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.ok((await page.evaluate(() => window.scrollY)) > scrollY, 'vertical starts still scroll');
        await input.detach();
      }
    } finally {
      await browser.close();
      await stopMockServer();
    }
  });
}
