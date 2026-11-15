import { test, expect } from './fixtures.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { waitFrames, walkTo } from './helpers.js';
import { Matrix4, Vector3 } from 'three';
import { upperWallPieces } from '../src/view/scene.ts';
import { pegs } from '../src/skins/pegs.ts';

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
  // modelView is required for positions even without cutaway logic; viewMatrix alone may be optimized
  // out when the low-view guard is removed. The scene root is identity, so this projects level points.
  const m = await page.evaluate(() => {
    const gl = window.__upperGL, p = window.__upperProgram;
    return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
      view: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'modelViewMatrix'))),
      projection: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'projectionMatrix'))) };
  });
  const view = new Matrix4().fromArray(m.view), projection = new Matrix4().fromArray(m.projection);
  // Prove each sample hits real upper geometry, not an open doorway that would pass without a cutaway.
  const pieces = upperWallPieces(LEVELS[0], w, pegs.palette(false));
  const samples = [{ x: 350, y: 35, z: 20 }, { x: 305, y: 35, z: 270 }].map(at => {
    expect(pieces.some(p => Math.abs(at.x - p.x) < p.sx / 2 && Math.abs(at.y - p.y) < p.sy / 2
      && Math.abs(at.z - p.z) < p.sz / 2), `real wall at ${JSON.stringify(at)}`).toBe(true);
    const p = new Vector3(at.x, at.y, at.z).applyMatrix4(view).applyMatrix4(projection);
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
  console.log(`wall pixel deltas at ${tilt}: far ${delta[0]}, near ${delta[1]}`);
  if (tilt === 15) {
    // A ray through the near sample can meet a far wall too. At low view BOTH must contribute nothing.
    expect(delta[0], 'low view cuts upper-wall pixels on the far sample ray').toBeLessThanOrEqual(2);
    expect(delta[1], 'low view cuts upper-wall pixels on the near sample ray').toBeLessThanOrEqual(2);
  } else {
    expect(delta[0], 'the far upper wall really paints pixels').toBeGreaterThan(15);
    expect(delta[1], 'the near sample ray adds no upper-wall pixels').toBeLessThanOrEqual(2);
  }
});

for (const at of [{ x: 330, y: 540 }, { x: 400, y: 290 }]) for (const turn of [30, -150])
test(`upper walls leave the warden visible outside rooms at ${at.x},${at.y}, turn ${turn}`, async ({ page, browserName }, info) => {
  const w = create(LEVELS, 0, 17);
  w.bought = LEVELS[0].pads.filter(p => !p.unlock.level).map(p => p.id);
  w.fightIn = w.boost.t = 1e9;
  w.ride = { state: 'away', x: -100, t: 1e9 };
  Object.assign(w.agents[0], at);
  await page.addInitScript(instrumentUpper, JSON.stringify(w));
  // Compare the same pose, not two moments of the warden's breathing animation.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(now => cb(window.__stillFrame ?? now));
  });
  await page.addInitScript(turn => localStorage.setItem('jailbirds:camera', JSON.stringify({ zoom: 2, turn, tilt: 35 })), turn);
  await page.goto('/');
  await page.waitForFunction(() => window.__upperDraws > 0);
  await waitFrames(page, 10);
  await page.evaluate(() => { window.__stillFrame = performance.now(); });
  await waitFrames(page, 3);
  const m = await page.evaluate(() => {
    const gl = window.__upperGL, p = window.__upperProgram;
    return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
      view: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'modelViewMatrix'))),
      projection: Array.from(gl.getUniform(p, gl.getUniformLocation(p, 'projectionMatrix'))) };
  });
  const view = new Matrix4().fromArray(m.view), projection = new Matrix4().fromArray(m.projection);
  // Sample the actual lower body, torso and head, not an empty bit of hallway beside the actor.
  const samples = [6, 14, 24].map(height => {
    const p = new Vector3(at.x, height, at.y).applyMatrix4(view).applyMatrix4(projection);
    return { x: Math.floor((p.x * 0.5 + 0.5) * m.w), y: Math.floor((p.y * 0.5 + 0.5) * m.h) };
  });
  const read = () => page.evaluate(samples => new Promise(resolve => requestAnimationFrame(() => {
    const gl = window.__upperGL;
    resolve(samples.map(({ x, y }) => {
      const p = new Uint8Array(3 * 3 * 4);
      gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, p);
      return Array.from(p);
    }));
  })), samples);
  await page.screenshot({ path: info.outputPath(`hall-${browserName}.png`) });
  const normal = await read();
  await page.evaluate(() => { window.__hideUpper = true; });
  await waitFrames(page, 3);
  const without = await read();
  const delta = normal.map((p, i) => Math.max(...p.map((v, j) => Math.abs(v - without[i][j]))));
  console.log(`hall ${at.x},${at.y} turn ${turn}: body/torso/head ${delta.join(',')}`);
  for (const d of delta) expect(d, 'upper walls cannot paint over the warden in an open hall').toBeLessThanOrEqual(2);
});

test('the upper-wall focus follows the actual moving warden without rebuilding the scene', async ({ page }) => {
  const w = create(LEVELS, 0, 17);
  w.bought = LEVELS[0].pads.filter(p => !p.unlock.level).map(p => p.id);
  w.fightIn = w.boost.t = 1e9;
  w.ride = { state: 'away', x: -100, t: 1e9 };
  Object.assign(w.agents[0], { x: 400, y: 290 });
  await page.addInitScript(instrumentUpper, JSON.stringify(w));
  await page.goto('/');
  await page.waitForFunction(() => window.__upperDraws > 0);
  await waitFrames(page, 10);
  const sample = () => page.evaluate(() => {
    const gl = window.__upperGL, p = window.__upperProgram;
    return { focus: gl.getUniform(p, gl.getUniformLocation(p, 'wallFocus')),
      player: window.__jailbirds.state().agents[0], builds: window.__jailbirds.drawn().rubble.builds };
  });
  const before = await sample();
  await walkTo(page, { x: 430, y: 290 });
  await waitFrames(page, 3);
  const after = await sample();
  expect(after.builds).toBe(before.builds);
  expect(after.player.x - before.player.x).toBeGreaterThan(20);
  expect(after.focus, 'the linked shader has a live warden focus').not.toBeNull();
  expect(after.focus[0]).toBeCloseTo(after.player.x, 2);
  expect(after.focus[1]).toBeCloseTo(after.player.y, 2);
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
