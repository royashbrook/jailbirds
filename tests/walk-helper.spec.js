import { test, expect } from './fixtures.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { state, waitSim, walkTo } from './helpers.js';

test.use({ viewport: { width: 390, height: 664 } });

test('a delayed captured state cannot certify arrival while the stick still drives past the desk', async ({ page }) => {
  const w = create(LEVELS, 0, 37);
  // Captured before the final steering command in deploy43700210513, not an invented far-away start.
  Object.assign(w.agents[0], { x: 147.20101531200942, y: 539.9999826479901 });
  w.ride = { state: 'away', x: -100, t: 1e9 };
  w.boost.t = w.fightIn = 1e9;
  await page.addInitScript(raw => localStorage.setItem('jailbirds:save', raw), JSON.stringify(w));
  await page.goto('/');
  const evaluate = page.evaluate.bind(page);
  // A reply is already a snapshot. Delay its delivery while the real browser and game keep running.
  page.evaluate = async (fn, arg) => {
    const result = await evaluate(fn, arg);
    if (fn.toString().includes('__jailbirds.state()')) await new Promise(resolve => setTimeout(resolve, 350));
    return result;
  };
  const desk = { x: 140, y: 584 };
  const at = await walkTo(page, desk);
  await waitSim(page, 0.1);
  const settled = (await state(page)).agents[0];
  expect(Math.hypot(at.x - desk.x, at.y - desk.y)).toBeLessThan(4);
  expect(Math.hypot(settled.x - desk.x, settled.y - desk.y), 'returned arrival is still true after release').toBeLessThan(4);
  expect(Math.hypot(settled.x - at.x, settled.y - at.y), 'there is no unobserved run-on after arrival').toBeLessThan(0.01);
  expect(settled.moving).toBe(false);
});

for (const target of [{ x: 430, y: 290 }, { x: 374, y: 275 }, { x: 426, y: 285 }]) {
  test(`the walk settles under slow native command delivery toward ${target.x},${target.y}`, async ({ page }) => {
    const w = create(LEVELS, 0, 17);
    w.bought = LEVELS[0].pads.filter(p => !p.unlock.level).map(p => p.id);
    w.fightIn = w.boost.t = 1e9;
    w.ride = { state: 'away', x: -100, t: 1e9 };
    // Initial world coordinate from the failed cutaway trace in run43718046542.
    Object.assign(w.agents[0], { x: 400, y: 290 });
    await page.addInitScript(raw => localStorage.setItem('jailbirds:save', raw), JSON.stringify(w));
    await page.goto('/');
    const move = page.mouse.move.bind(page.mouse), evaluate = page.evaluate.bind(page);
    const lag = ms => new Promise(resolve => setTimeout(resolve, ms));
    // A controlled latency class, not a claim to replay the runner's unobserved dispatch instant.
    // Keep actual native pointer events. Only their delivery and already-captured replies wait.
    page.mouse.move = async (...args) => {
      await lag(350);
      const result = await move(...args);
      await lag(350);
      return result;
    };
    page.evaluate = async (fn, arg) => {
      const result = await evaluate(fn, arg);
      if (/__jailbirds\.(state|drawn)\(\)/.test(fn.toString())) await lag(180);
      return result;
    };
    const at = await walkTo(page, target);
    await waitSim(page, .1);
    const settled = (await state(page)).agents[0];
    expect(Math.hypot(at.x - target.x, at.y - target.y)).toBeLessThan(4);
    expect(Math.hypot(settled.x - target.x, settled.y - target.y)).toBeLessThan(4);
    expect(Math.hypot(settled.x - at.x, settled.y - at.y)).toBeLessThan(.01);
    expect(settled.moving).toBe(false);
  });
}
