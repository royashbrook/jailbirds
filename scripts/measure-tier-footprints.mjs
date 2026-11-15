import assert from 'node:assert/strict';
import { create, step, player, route, DT, isOpen } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { walls, dist } from '../src/engine/geom.ts';

// Proposed centres only. This is a current-layout planning probe, not a test of shipped tier pads.
const proposed = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `cell-${i}`, x: 67 + i * 84 + (i === 3 ? -15 : i === 4 ? 13 : 0), y: 244 })),
  { id: 'kitchen', x: 370, y: 490 }, { id: 'canteen', x: 240, y: 540 },
  { id: 'shower', x: 735, y: 560 }, { id: 'staff-speed', x: 850, y: 700 },
  { id: 'staff-carry', x: 850, y: 765 },
];
for (let n = 0; n < 2; n++) {
  const l = LEVELS[n];
  for (const target of proposed) {
    const w = create(LEVELS, n, 37), p = player(w);
    // Layout projection: open all rooms, no people or money. Not a purchase or earning capture.
    w.bought = l.pads.map(p => p.id);
    w.ride.t = w.fightIn = w.boost.t = 1e9;
    const ws = walls(l, r => isOpen(w, r.locked));
    const nearestWall = Math.min(...ws.map(r => Math.hypot(target.x - Math.max(r.x, Math.min(target.x, r.x+r.w)),
      target.y - Math.max(r.y, Math.min(target.y, r.y+r.h)))));
    assert.ok(nearestWall > 10, `${target.id} body hits wall`);
    for (const old of l.pads) assert.ok(dist(target, old.at) > 48, `${target.id} shares two pad payment zones with ${old.id}`);
    for (const other of proposed) if (other !== target) assert.ok(dist(target, other) > 48);
    assert.ok(dist(target, l.riot.at) > 24 + 40, `${target.id} overlaps the manual incident response zone`);
    for (const st of l.stations) {
      if ('r' in st) assert.ok(dist(target, st.at) > 24 + st.r, `${target.id} overlaps ${st.id}'s work radius`);
      if ('zone' in st && st.zone) {
        const r = st.zone;
        const d = Math.hypot(target.x - Math.max(r.x,Math.min(target.x,r.x+r.w)),
          target.y - Math.max(r.y,Math.min(target.y,r.y+r.h)));
        assert.ok(d > 24, `${target.id} overlaps ${st.id}'s service zone`);
      }
    }
    const path = route(w, l, p, target);
    let ticks = 0;
    while (path.length && ticks < 60*60) {
      const t = path[0], d = dist(p,t);
      if (d < 0.1) { path.shift(); continue; }
      const stride = w.speed*DT;
      step(w, LEVELS, { x: (t.x-p.x)/Math.max(d,stride), y: (t.y-p.y)/Math.max(d,stride) });
      ticks++;
      for (const r of ws) {
        const d = Math.hypot(p.x - Math.max(r.x,Math.min(p.x,r.x+r.w)), p.y - Math.max(r.y,Math.min(p.y,r.y+r.h)));
        assert.ok(d >= 10 - 1e-6, `${target.id} overlaps wall at ${p.x},${p.y}`);
      }
    }
    assert.ok(dist(p,target) < 0.1, `${target.id} route stopped at ${p.x},${p.y}`);
    console.log(JSON.stringify({ jail: l.id, target: target.id, at: { x:target.x,y:target.y }, nearestWall, steps:ticks }));
  }
}
