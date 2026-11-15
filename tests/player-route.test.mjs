import test from 'node:test';
import assert from 'node:assert/strict';
import { create, step, player, route, isOpen, DT } from '../src/engine/sim.ts';
import { nav, walls, route as navRoute } from '../src/engine/geom.ts';
import { LEVELS } from '../src/content/jail.ts';

// The NPC grid can go below the road edge, but a thumb-driven player is clamped above it.
for (let level = 0; level < LEVELS.length; level++) {
  test(`jail${level + 1}: the player route from the staff corner stays above the road and is walkable`, () => {
    const l = LEVELS[level];
    for (const start of [{ x: 850, y: 700 }, { x: 850, y: 765 }]) {
      const w = create(LEVELS, level, 37), p = player(w);
      w.bought = l.pads.map(pad => pad.id);
      w.ride.t = w.fightIn = w.boost.t = 1e9;
      Object.assign(p, start);
      const target = { x: 320, y: 785 };
      const path = route(w, l, p, target);
      const maxY = l.stations.find(s => s.kind === 'spawn').roadY - 30;
      assert.ok(path.every(pt => pt.y <= maxY), JSON.stringify(path));
      for (let i = 0; i < 3600 && path.length; i++) {
        while (path.length && Math.hypot(p.x - path[0].x, p.y - path[0].y) < .1) path.shift();
        if (!path.length) break;
        const t = path[0], d = Math.max(Math.hypot(t.x - p.x, t.y - p.y), w.speed * DT);
        step(w, LEVELS, { x: (t.x - p.x) / d, y: (t.y - p.y) / d });
      }
      assert.ok(Math.hypot(p.x - target.x, p.y - target.y) < .1,
        `from ${JSON.stringify(start)} stopped at ${p.x},${p.y}`);
    }
  });
  test(`jail${level + 1}: player bounds do not change helper or resident paths`, () => {
    const l = LEVELS[level], w = create(LEVELS, level, 37);
    w.bought = l.pads.map(pad => pad.id);
    Object.assign(player(w), { x: 850, y: 765 });
    const target = { x: 320, y: 785 };
    for (const kind of ['agent', 'escort', 'carrier', 'cleaner', 'clerk', 'collector', 'calmer']) {
      const a = { ...player(w), kind };
      const expected = navRoute(nav(l, walls(l, r => isOpen(w, r.locked), kind === 'agent')), a, target);
      assert.deepEqual(route(w, l, a, target), expected, kind);
      route(w, l, player(w), target);
      assert.deepEqual(route(w, l, a, target), expected, `${kind}: cache after a player route`);
    }
  });
}
