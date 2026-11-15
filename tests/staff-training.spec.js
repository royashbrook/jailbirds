import { test, expect } from './fixtures.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { waitFrames, untilSim } from './helpers.js';

const l = LEVELS[0];
const training = p => p.unlock.helperSpeed !== undefined || p.unlock.helperCarry !== undefined;
function world(bought = []) {
  const w = create(LEVELS, 0, 37);
  w.rank = 10;
  w.ride.t = w.fightIn = w.boost.t = 1e9;
  w.bought = [...l.pads.filter(p => !training(p)).map(p => p.id), ...bought];
  Object.assign(w.agents[0], { x: 850, y: 735 });
  return w;
}
async function open(page, w) {
  await page.addInitScript(raw => {
    if (sessionStorage.getItem('staff-training:seeded')) return;
    sessionStorage.setItem('staff-training:seeded', 'yes');
    localStorage.removeItem('jailbirds:map');
    localStorage.setItem('jailbirds:save', raw);
  }, JSON.stringify(w));
  await page.goto('/'); await waitFrames(page, 20);
  const later = page.getByRole('button', { name: 'later', exact: true });
  if (await later.isVisible()) await later.click();
  await expect.poll(() => page.evaluate(() => window.__jailbirds.drawn().frames)).toBeGreaterThan(5);
}

test('training plaques update across paid stages within the scene resource budget', async ({ browser, browserName }, info) => {
  const records = [];
  for (const [index, bought] of [[], ['staff2', 'cookcarry2'], ['staff2', 'staff3', 'cookcarry2', 'cookcarry3']].entries()) {
    const context = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
    try {
      const page = await context.newPage(); await open(page, world(bought));
      const actual = await page.evaluate(() => window.__jailbirds.drawn());
      expect(actual.training).toBe([12, 16, 20][index]);
      records.push({ training: actual.training, calls: actual.calls, triangles: actual.triangles, geometries: actual.geometries, textures: actual.textures });
      await page.screenshot({ path: info.outputPath(`staff-stage-${index + 1}-${browserName}.png`) });
    } finally { await context.close(); }
  }
  expect(records[2].calls).toBeLessThanOrEqual(records[0].calls + 1);
  expect(records[2].geometries).toBeLessThanOrEqual(records[0].geometries);
  expect(records[2].textures).toBeLessThanOrEqual(records[0].textures);
  expect(records[2].triangles - records[0].triangles).toBeLessThanOrEqual(96);
  console.log('[staff-training]', browserName, JSON.stringify(records));
});

for (const id of ['staff2', 'cookcarry2']) test(`paying ${id} buys its effect and reload keeps it`, async ({ page }) => {
  const p = l.pads.find(p => p.id === id), w = world();
  w.rank = 5; w.coins = p.cost; Object.assign(w.agents[0], p.at);
  await open(page, w);
  const paid = await untilSim(page, s => s.bought.includes(id), 5, id);
  expect(paid.coins).toBe(0); expect(paid.paid[id]).toBe(p.cost);
  expect(await page.evaluate(() => window.__jailbirds.drawn().training)).toBe(14);
  await page.reload(); await waitFrames(page, 10);
  expect((await page.evaluate(() => window.__jailbirds.state())).bought).toContain(id);
  expect(await page.evaluate(() => window.__jailbirds.drawn().training)).toBe(14);
});

for (const id of ['staff3', 'cookcarry3']) test(`${id} goal keeps its money inside a narrow, large-text phone`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const p = l.pads.find(p => p.id === id), w = world(l.pads.filter(training).map(p => p.id).filter(p => p !== id));
  Object.assign(w.agents[0], { x: 330, y: 540 }); w.paid[id] = p.cost - 1;
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.play{padding-left:44px!important;padding-right:44px!important}.goal{font-size:20px!important}.goal small{font-size:18px!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }));
  await open(page, w);
  await expect(page.locator('#goal')).toHaveText(`${p.label} ${p.cost - 1}/${p.cost}`);
  const metrics = await page.evaluate(() => {
    const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right }; };
    return { width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, row: box('#goal'), money: box('#goal small') };
  });
  expect(metrics.width).toBe(320); expect(metrics.client).toBe(320); expect(metrics.scroll).toBe(320);
  expect(metrics.row.left).toBeGreaterThanOrEqual(43.5);
  expect(metrics.row.right).toBeLessThanOrEqual(276.5);
  expect(metrics.money.right).toBeLessThanOrEqual(276.5);
});

test('training survives close low-angle and far overhead views in both orientations', async ({ browser, browserName }, info) => {
  for (const [width, height] of [[390, 844], [844, 390]]) for (const camera of [
    { zoom: 3, tilt: 15, turn: -180 }, { zoom: .5, tilt: 85, turn: 180 },
  ]) {
    const context = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width, height } });
    try {
      const page = await context.newPage();
      await page.addInitScript(value => localStorage.setItem('jailbirds:camera', JSON.stringify(value)), camera);
      await open(page, world());
      expect(await page.evaluate(() => window.__jailbirds.camera())).toEqual(camera);
      expect(await page.evaluate(() => window.__jailbirds.drawn().training)).toBe(12);
      expect(await page.locator('.nogl').count()).toBe(0);
      const boxes = await page.locator('.tag').evaluateAll(tags => tags.filter(t => !t.hidden).map(t => {
        const r = t.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }));
      expect(boxes.length).toBeGreaterThan(0);
      for (const r of boxes) {
        expect(r.left).toBeGreaterThanOrEqual(-.5); expect(r.right).toBeLessThanOrEqual(width + .5);
        expect(r.top).toBeGreaterThanOrEqual(-.5); expect(r.bottom).toBeLessThanOrEqual(height + .5);
      }
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(viewport).toEqual({ width, height, client: width, scroll: width });
      await page.screenshot({ path: info.outputPath(`staff-view-${width}-${camera.zoom}-${browserName}.png`) });
    } finally { await context.close(); }
  }
});
