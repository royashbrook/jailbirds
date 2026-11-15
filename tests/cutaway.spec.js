import { test, expect } from './fixtures.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { waitFrames } from './helpers.js';
import { Matrix4, Vector3 } from 'three';

function instrumentUpper(raw) {
  localStorage.setItem('jailbirds:save', raw);
  window.__upperDraws = 0;
  window.__hideUpper = false;
  const original = WebGL2RenderingContext.prototype.drawElementsInstanced;
  WebGL2RenderingContext.prototype.drawElementsInstanced = function(...args) {
    const program = this.getParameter(this.CURRENT_PROGRAM);
    if (this.getAttribLocation(program, 'wallNormal') >= 0) {
      window.__upperDraws++;
      window.__upperGL = this;
      window.__upperProgram = program;
      if (window.__hideUpper) return;
    }
    return original.apply(this, args);
  };
}

test('the actual renderer submits a separate camera-aware upper-wall batch', async ({ page }) => {
  const w = create(LEVELS, 0, 17);
  w.bought = LEVELS[0].pads.filter(p => !p.unlock.level).map(p => p.id);
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  w.ride = { state: 'away', x: -100, t: 1e9 };
  Object.assign(w.agents[0], { x: 319, y: 184 });
  await page.addInitScript(instrumentUpper, JSON.stringify(w));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => window.__jailbirds?.drawn().frames > 2);
  await waitFrames(page, 10);
  expect(await page.evaluate(() => window.__upperDraws)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

for (const tilt of [35, 15]) test(`at tilt ${tilt}, actual wall pixels cut away on the near side${tilt === 15 ? ' and the far side' : ' only'}`, async ({ page }) => {
  const w = create(LEVELS, 0, 17);
  w.bought = LEVELS[0].pads.filter(p => !p.unlock.level).map(p => p.id);
  w.fightIn = w.boost.t = 1e9;
  w.ride = { state: 'away', x: -100, t: 1e9 };
  Object.assign(w.agents[0], { x: 319, y: 184 });
  await page.addInitScript(instrumentUpper, JSON.stringify(w));
  await page.addInitScript(tilt => localStorage.setItem('jailbirds:camera', JSON.stringify({ zoom: 2, turn: 30, tilt })), tilt);
  await page.goto('/');
  await page.waitForFunction(() => window.__upperDraws > 0);
  await waitFrames(page, 10);
  // Project with the matrices the GPU actually used, not a second copy of the app's camera formula.
  const m = await page.evaluate(() => {
    const gl = window.__upperGL, p = window.__upperProgram;
    return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
      view: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'viewMatrix'))),
      projection: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'projectionMatrix'))) };
  });
  const view = new Matrix4().fromArray(m.view), projection = new Matrix4().fromArray(m.projection);
  const samples = [20, 270].map(z => {
    const p = new Vector3(350, 35, z).applyMatrix4(view).applyMatrix4(projection);
    const x = Math.floor((p.x * 0.5 + 0.5) * m.w), y = Math.floor((p.y * 0.5 + 0.5) * m.h);
    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThan(m.w - 1);
    expect(y).toBeGreaterThanOrEqual(1);
    expect(y).toBeLessThan(m.h - 1);
    return { x, y };
  });
  const read = () => page.evaluate(samples => new Promise(resolve => requestAnimationFrame(() => {
    const gl = window.__upperGL;
    resolve(samples.map(({ x, y }) => {
      const pixels = new Uint8Array(3 * 3 * 4);
      gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return Array.from(pixels);
    }));
  })), samples);
  const normal = await read();
  // Replay the same frame without ONLY the upper-wall draw. Everything else still renders normally.
  await page.evaluate(() => { window.__hideUpper = true; });
  await waitFrames(page, 3);
  const without = await read();
  const delta = normal.map((p, i) => Math.max(...p.map((v, j) => Math.abs(v - without[i][j]))));
  expect(delta[1], 'camera-facing upper wall adds no pixels').toBeLessThanOrEqual(2);
  if (tilt === 15) expect(delta[0], 'low view also cuts the far upper wall').toBeLessThanOrEqual(2);
  else expect(delta[0], 'the far upper wall really paints pixels').toBeGreaterThan(15);
});

test('theme rebuilds release old scene instance buffers, not just their geometries', async ({ page, browserName }) => {
  const w = create(LEVELS, 0, 17);
  w.fightIn = w.boost.t = 1e9;
  w.ride = { state: 'away', x: -100, t: 1e9 };
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(raw => {
    localStorage.setItem('jailbirds:save', raw);
    const proto = WebGL2RenderingContext.prototype, make = proto.createBuffer, drop = proto.deleteBuffer;
    const live = new Set();
    window.__staticBuffers = { made: 0, dropped: 0, live: 0 };
    proto.createBuffer = function(...args) {
      const b = make.apply(this, args);
      if (b) { live.add(b); window.__staticBuffers.made++; window.__staticBuffers.live = live.size; }
      return b;
    };
    proto.deleteBuffer = function(b) {
      if (live.delete(b)) { window.__staticBuffers.dropped++; window.__staticBuffers.live = live.size; }
      return drop.call(this, b);
    };
  }, JSON.stringify(w));
  await page.goto('/');
  await page.waitForFunction(() => window.__jailbirds?.drawn().frames > 5);
  await waitFrames(page, 10);
  const sample = () => page.evaluate(() => ({ ...window.__staticBuffers, ...window.__jailbirds.drawn() }));
  const initial = await sample();
  expect(initial.live).toBeGreaterThan(0);
  const snapshots = [initial.live];
  let builds = initial.rubble.builds;
  for (let i = 0; i < 6; i++) {
    await page.emulateMedia({ colorScheme: i % 2 ? 'light' : 'dark' });
    await page.waitForFunction(was => window.__jailbirds.drawn().rubble.builds > was, builds);
    await waitFrames(page, 10);
    const s = await sample();
    snapshots.push(s.live);
    expect(s.made).toBeGreaterThan(initial.made);
    expect(s.dropped).toBeGreaterThan(0);
    expect(s.live).toBe(initial.live);
    expect(s.geometries).toBe(initial.geometries);
    expect(s.textures).toBe(initial.textures);
    builds = s.rubble.builds;
  }
  console.log(`static buffers ${browserName}: ${snapshots.join(',')}`);
});
