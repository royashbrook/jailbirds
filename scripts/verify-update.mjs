// Run two real builds through the same local origin and service-worker lifecycle.
// The old build must be supplied separately so the oracle is not today's app twice.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, webkit, devices, expect } from '@playwright/test';

const oldRoot = resolve(process.argv[2]), nextRoot = resolve(process.argv[3]);
const identity = async root => JSON.parse(await readFile(`${root}/version.json`, 'utf8'));
const previous = await identity(oldRoot), next = await identity(nextRoot);
expect(previous.source).toBe('f068cab744f94301eb6234512e25a93e1033aea1');
expect(previous.build).toBe('261a2645ed27');
expect(next.build).not.toBe(previous.build);
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/v0.1.21-save.json', import.meta.url), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let root = oldRoot;
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + '/') || path === '/_headers') { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') res.writeHead(404).end();
    else res.destroy(error);
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [engine, driver] of Object.entries({ chromium, webkit })) {
    root = oldRoot;
    const browser = await driver.launch();
    try {
      const page = await browser.newPage(devices['iPhone 13']);
      await page.clock.install();
      await page.goto(`${origin}/manifest.json`);
      await page.evaluate(save => localStorage.setItem('jailbirds:save', JSON.stringify(save)), fixture);
      await page.goto(origin);
      await page.waitForFunction(() => window.__jailbirds?.drawn().frames > 3);
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      await page.click('#about');
      const saved = await page.evaluate(() => localStorage.getItem('jailbirds:save'));
      await expect(page.locator('meta[name=build]')).toHaveAttribute('content', previous.build);
      root = nextRoot;
      // 0.1.21 discovers automatically on its existing minute timer. It cannot
      // gain the new launch/foreground triggers until it has loaded the update.
      await page.clock.fastForward(60000);
      await expect(page.locator('.update')).toBeVisible();
      await expect(page.locator('meta[name=build]')).toHaveAttribute('content', previous.build);
      expect(await page.evaluate(() => localStorage.getItem('jailbirds:save'))).toBe(saved);
      await page.click('#close');
      await page.locator('.update').click();
      await expect(page.locator('meta[name=build]')).toHaveAttribute('content', next.build, { timeout: 30000 });
      await page.waitForFunction(() => window.__jailbirds?.drawn().frames > 3);
      const state = await page.evaluate(() => window.__jailbirds.state());
      expect(state.coins).toBe(fixture.coins);
      expect(state.rank).toBe(fixture.rank);
      expect(state.bought).toEqual(fixture.bought);
      await page.click('#camera');
      await page.locator('#camera-zoom').press('End');
      const camera = await page.evaluate(() => window.__jailbirds.camera());
      expect(camera.zoom).toBe(3);
      await page.click('#close');
      await page.reload();
      await page.waitForFunction(() => window.__jailbirds?.drawn().frames > 3);
      expect(await page.evaluate(() => window.__jailbirds.camera())).toEqual(camera);
      console.log(JSON.stringify({ engine, previous, next, preserved: { coins: state.coins, rank: state.rank }, camera }));
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
