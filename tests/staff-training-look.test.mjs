import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { trainingPieces } from '../src/view/scene.ts';
import { pegs } from '../src/skins/pegs.ts';

for (const dark of [false, true]) test(`training markers reflect bought capabilities in the ${dark ? 'dark' : 'light'} palette`, () => {
  const l = LEVELS[0], w = create(LEVELS, 0, 37), pal = pegs.palette(dark);
  assert.deepEqual(trainingPieces(l, w, pal), [], 'no training marker before its helper is hired');
  for (const [bought, count] of [
    [['guard'], 3], [['guard', 'staff2'], 5], [['guard', 'staff2', 'staff3'], 7],
    [['cook'], 9], [['cook', 'cookcarry2'], 11], [['cook', 'cookcarry2', 'cookcarry3'], 13],
  ]) {
    w.bought = bought;
    const pieces = trainingPieces(l, w, pal);
    assert.equal(pieces.length, count);
    assert.ok(pieces.every(p => p.shape === 'box' && p.y + p.sy / 2 < 10));
    assert.ok(pieces.every(p => [pal.wood, pal.metal, pal.pillow].includes(p.colour)), 'reuse batched scene colours');
    const pad = l.pads.find(p => p.id === (bought[0] === 'guard' ? 'staff2' : 'cookcarry2'));
    for (const p of pieces) {
      const dx = (Math.abs(Math.cos(p.ry)) * p.sx + Math.abs(Math.sin(p.ry)) * p.sz) / 2;
      const dz = (Math.abs(Math.sin(p.ry)) * p.sx + Math.abs(Math.cos(p.ry)) * p.sz) / 2;
      assert.ok(Math.abs(p.x - pad.at.x) + dx < 26);
      assert.ok(Math.abs(p.z - pad.at.y) + dz < 20);
    }
  }
});
