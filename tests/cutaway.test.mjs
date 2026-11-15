import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/content/jail.ts';
import { create, isOpen } from '../src/engine/sim.ts';
import { doorMid } from '../src/engine/geom.ts';
import { pegs } from '../src/skins/pegs.ts';
import { upperWallPieces, doorBarPieces, WALL_H, WALL_CAP, UPPER_WALL_H } from '../src/view/scene.ts';

test('upper walls are a bounded deterministic visual layer above the old low walls', () => {
  for (let level = 0; level < LEVELS.length; level++) for (const dark of [false, true]) {
    const l = LEVELS[level], w = create(LEVELS, level, 9), pal = pegs.palette(dark);
    w.bought = l.pads.map(p => p.id);
    const before = JSON.stringify({ w, l, pal });
    const pieces = upperWallPieces(l, w, pal);
    assert.ok(pieces.length > 20 && pieces.length < 200);
    assert.deepEqual(pieces, upperWallPieces(l, w, pal));
    for (const p of pieces) {
      assert.equal(Math.abs(p.nx) + Math.abs(p.nz), 1);
      assert.ok(p.y - p.sy / 2 >= WALL_H + WALL_CAP - 0.001);
      assert.ok(p.y + p.sy / 2 <= UPPER_WALL_H + WALL_CAP + 0.001);
      assert.ok([p.x, p.y, p.z, p.sx, p.sy, p.sz].every(Number.isFinite));
      assert.match(p.colour, /^#[0-9a-f]{6}$/i);
    }
    assert.equal(JSON.stringify({ w, l, pal }), before);
  }
});

test('open cell gates sit beside actual door gaps, closed gates cover only a closed route', () => {
  for (let level = 0; level < LEVELS.length; level++) {
    const l = LEVELS[level], w = create(LEVELS, level, 9), pal = pegs.palette(false);
    for (const bought of [[], l.pads.map(p => p.id)]) {
      w.bought = bought;
      const before = JSON.stringify({ w, l });
      const pieces = doorBarPieces(l, w, pal);
      assert.ok(pieces.length > 80 && pieces.length < 200);
      for (const room of l.rooms.filter(r => r.look === 'cell')) for (const d of room.doors) {
        const { mid, out } = doorMid(room, d), tx = -out.y, tz = out.x;
        const mine = pieces.filter(p => Math.abs((p.x - mid.x) * out.x + (p.z - mid.y) * out.y - 5) < 0.01
          && Math.abs((p.x - mid.x) * tx + (p.z - mid.y) * tz) < d.width * 1.6);
        assert.ok(mine.length, `${room.id}: real gate pieces`);
        const intrudes = mine.some(p => {
          const t = (p.x - mid.x) * tx + (p.z - mid.y) * tz;
          const half = (Math.abs(tx) * p.sx + Math.abs(tz) * p.sz) / 2;
          return t + half > -d.width / 2 && t - half < d.width / 2;
        });
        assert.equal(intrudes, !isOpen(w, room.locked), `${room.id}: follows real openness`);
      }
      assert.equal(JSON.stringify({ w, l }), before);
    }
  }
});
