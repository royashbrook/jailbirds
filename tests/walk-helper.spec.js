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
