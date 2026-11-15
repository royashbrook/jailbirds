import assert from 'node:assert/strict';
import { create, step, player, route, DT, isOpen, ALERT_R } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { walls, dist } from '../src/engine/geom.ts';

const upgrade = p => /tier[23]$|^(kitchen|canteen|wash|staff|cookcarry)[23]$/.test(p.id);
// Geometric projection; actual incident no-payment tests separately exercise the engine.
const PAD_R = 24;
for (let n = 0; n < 2; n++) {
  const l = LEVELS[n];
  // Every centre comes from authored data, one per two-stage purchase chain.
  const proposed = [
    ...l.pads.filter(p => /tier2$|^(kitchen|canteen|wash|staff|cookcarry)2$/.test(p.id)).map(p => ({ id: p.id, ...p.at })),
  ];
  for (const target of proposed) {
    const w = create(LEVELS, n, 37), p = player(w);
    // Layout projection: open all rooms, no people or money. Not a purchase or earning capture.
    w.bought = l.pads.map(p => p.id);
    w.ride.t = w.fightIn = w.boost.t = 1e9;
    const ws = walls(l, r => isOpen(w, r.locked));
    const nearestWall = Math.min(...ws.map(r => Math.hypot(target.x - Math.max(r.x, Math.min(target.x, r.x+r.w)),
      target.y - Math.max(r.y, Math.min(target.y, r.y+r.h)))));
    assert.ok(nearestWall > 10, `${target.id} body hits wall`);
    for (const old of l.pads.filter(p => !upgrade(p))) assert.ok(dist(target, old.at) > PAD_R * 2, `${target.id} shares two pad payment zones with ${old.id}`);
    for (const other of proposed) if (other !== target) assert.ok(dist(target, other) > PAD_R * 2);
    assert.ok(dist(target, l.riot.at) > PAD_R + ALERT_R, `${target.id} overlaps the riot response zone`);
    for (const st of l.stations) {
      if (st.kind === 'house') assert.ok(dist(target, st.at) > PAD_R + ALERT_R, `${target.id} overlaps ${st.id}'s squabble response zone`);
      if ('r' in st) assert.ok(dist(target, st.at) > PAD_R + st.r, `${target.id} overlaps ${st.id}'s work radius`);
      if ('zone' in st && st.zone) {
        const r = st.zone;
        const d = Math.hypot(target.x - Math.max(r.x,Math.min(target.x,r.x+r.w)),
          target.y - Math.max(r.y,Math.min(target.y,r.y+r.h)));
        assert.ok(d > PAD_R, `${target.id} overlaps ${st.id}'s service zone`);
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
