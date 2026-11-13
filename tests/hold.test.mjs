import { test } from "node:test";
import assert from "node:assert/strict";
import {
  create, step, route, player, followers, boostMult, restore, catchUp, CATCH_MIN, CATCH_MAX, DT, FOLLOW_GAP, HOLD, PICKUP_RADIUS, SETTLE,
} from "../src/engine/sim.ts";
import { walls } from "../src/engine/geom.ts";
import { LEVELS } from "../src/content/jail.ts";
import { clearance, sway } from "../src/view/view.ts";

// the player's pickup is a hold: stand still by someone for HOLD seconds and they join. one at a
// time, the same one throughout, and anything that breaks it starts it over. helpers still pick up
// at once. the player's drop-off is instant, at a cell and at the release desk; helpers keep
// their own pace. and the player's followers each catch up at their own speed, above the leader's
const L = LEVELS[0];
const station = (id) => L.stations.find((s) => s.id === id);
const desk = station("desk"), stamp = station("stamp");
const HALL = { x: 330, y: 540 };
const STILL = { x: 0, y: 0 };
/** steps in a hold, counted the way the sim adds them up */
const STEPS = (() => {
  let t = 0, n = 0;
  while (t < HOLD - 1e-9) (t += DT), n++;
  return n;
})();

function go(w, to, each = () => {}, levels = LEVELS) {
  const l = levels[w.level], p = player(w);
  const path = route(w, l, p, to);
  for (let i = 0; i < 60 * 40; i++) {
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      path.shift();
      continue;
    }
    const s = w.speed * boostMult(w, l) * DT;
    step(w, levels, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
    each();
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const still = (w, n, levels = LEVELS) => {
  for (let i = 0; i < n; i++) step(w, levels, STILL);
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const inmates = (w) => w.agents.filter((a) => a.kind === "agent");
const line = (w) => followers(w, player(w));
const ids = (as) => as.map((a) => a.id);
const close = (a, b) => Math.abs(a - b) < 1e-9;

/** the first bus checked in and standing at the desk's out spots, the player still at the desk */
function checkedIn(seed = 7) {
  const w = create(LEVELS, 0, seed);
  until(w, () => inmates(w).filter((a) => a.state === "queue").length === 3, 20, "the first bus to queue up");
  go(w, desk.at);
  until(w, () => inmates(w).filter((a) => a.state === "ready" && !a.path.length).length === 3, 8, "three checked in and standing");
  const out = (k) => inmates(w).find((a) => a.state === "ready" && a.slot === k);
  return { w, out: [out(0), out(1), out(2)] };
}
/** a helper of a kind, standing at a spot */
function hire(w, kind, at) {
  const h = { ...structuredClone(player(w)), id: w.nextId++, kind, state: "idle", x: at.x, y: at.y, trail: [], path: [], carry: 0, cash: 0 };
  w.agents.push(h);
  return h;
}
/** someone in a line: checked in, full up, and walking behind `leader` */
function follower(w, leader, k, extra = {}) {
  const b = {
    id: w.nextId++, kind: "agent", x: leader.x, y: leader.y + 10 + k * 4, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"],
    state: "follow", leader: leader.id, house: "", slot: -1, station: "", seat: -1, needs: Object.fromEntries(L.needs.map((n) => [n.id, 1])),
    served: 0, rest: 0, t: k, carry: 0, cash: 0, path: [], trail: [], ...extra,
  };
  w.agents.push(b);
  return b;
}

test("nothing before the hold is full; at HOLD the lowest id joins, and the next starts from nothing", () => {
  assert.equal(STEPS, 36, "0.6s is 36 steps");
  const { w, out } = checkedIn();
  go(w, desk.out[0]);
  // in reach: the ones at the first two spots, not the third
  const reach = out.filter((b) => Math.hypot(b.x - player(w).x, b.y - player(w).y) <= PICKUP_RADIUS);
  assert.deepEqual(ids(reach).sort(), ids([out[0], out[1]]).sort());
  const first = Math.min(...ids(reach)), second = Math.max(...ids(reach));
  assert.equal(line(w).length, 0, "walking up takes nobody");
  for (let i = 1; i < STEPS; i++) {
    step(w, LEVELS, STILL);
    assert.equal(line(w).length, 0, `nobody yet after ${i} steps`);
    assert.equal(w.grab.id, first, "the lowest id, every step");
    assert.ok(close(w.grab.t, i * DT));
  }
  step(w, LEVELS, STILL);
  assert.deepEqual(ids(line(w)), [first], "full: they join");
  assert.equal(w.grab, null);
  step(w, LEVELS, STILL);
  assert.equal(w.grab.id, second);
  assert.ok(close(w.grab.t, DT), "nothing carried over from the last hold");
  still(w, STEPS - 2);
  assert.deepEqual(ids(line(w)), [first]);
  step(w, LEVELS, STILL);
  assert.deepEqual(ids(line(w)), [first, second]);
});

test("moving off, or pushing the stick against a wall, ends the hold; back again it starts over", () => {
  const { w, out } = checkedIn();
  go(w, desk.out[0]);
  still(w, 20);
  assert.ok(w.grab);
  // a step away and straight back: the hold is gone, and a whole new one is needed
  step(w, LEVELS, { x: 1, y: 0 });
  assert.equal(w.grab, null, "moving ends it");
  go(w, desk.out[0]);
  still(w, STEPS - 1);
  assert.equal(line(w).length, 0, "the time before the step away counts for nothing");
  still(w, 1);
  assert.equal(line(w).length, 1);
  // the intake's east wall: pushed against it the player does not move, but the stick is not let go
  const p = player(w);
  go(w, { x: 246, y: desk.out[0].y });
  step(w, LEVELS, { x: 1, y: 0 });
  const x = p.x;
  for (let i = 0; i < 60; i++) {
    step(w, LEVELS, { x: 1, y: 0 });
    assert.equal(p.x, x, "against the wall");
    assert.equal(w.grab, null, "a stick held over is not standing still");
  }
  assert.equal(line(w).length, 1);
  assert.ok(out.some((b) => b.state === "ready" && Math.hypot(b.x - p.x, b.y - p.y) <= PICKUP_RADIUS), "someone still in reach");
  still(w, STEPS);
  assert.equal(line(w).length, 2, "let go, and the hold runs");
});

test("the one held stays held when a lower id comes into reach, and one who leaves passes nothing on", () => {
  const { w, out } = checkedIn();
  go(w, { x: 228, y: 700 });
  const reach = [out[1], out[2]];
  const held = Math.min(...ids(reach)), other = Math.max(...ids(reach));
  still(w, 10);
  assert.equal(w.grab.id, held);
  // the first spot's one comes right up: a lower id, perhaps, and in reach. the hold does not flicker over
  out[0].y = 690;
  for (let i = 0; i < 10; i++) {
    step(w, LEVELS, STILL);
    assert.equal(w.grab.id, held);
  }
  // the one held is taken off out of reach: the next is held from nothing
  const gone = w.agents.find((a) => a.id === held);
  gone.x += 200;
  step(w, LEVELS, STILL);
  assert.notEqual(w.grab.id, held);
  assert.ok(close(w.grab.t, DT), "nothing carried over");
  const next = w.grab.id;
  assert.ok([other, out[0].id].includes(next));
  assert.equal(next, Math.min(other, out[0].id), "the lowest of those in reach");
  still(w, STEPS - 1);
  assert.deepEqual(ids(line(w)), [next], "a whole hold from the swap");
});

test("a full line holds nobody and takes nobody; a line that fills mid-hold ends it", () => {
  const { w } = checkedIn();
  assert.equal(w.lineMax, 2);
  go(w, desk.out[1]);
  until(w, () => line(w).length === 2, 2, "two to join");
  for (let i = 0; i < 120; i++) {
    step(w, LEVELS, STILL);
    assert.equal(w.grab, null, "full: no hold at all");
  }
  assert.equal(line(w).length, 2);
  // a fresh one: half a hold, then the line is full (as if the room shrank)
  const v = checkedIn().w;
  go(v, desk.out[0]);
  still(v, STEPS);
  still(v, 20);
  assert.ok(v.grab);
  v.lineMax = 1;
  step(v, LEVELS, STILL);
  assert.equal(v.grab, null);
  still(v, 120);
  assert.equal(line(v).length, 1);
});

test("a guard who reaches the one held takes them and ends the hold; a hold that completes first wins", () => {
  // the guard gets there mid-hold: the guard has them, the hold is gone, nobody joins the player
  const a = checkedIn();
  go(a.w, desk.out[0]);
  still(a.w, 20);
  const held = a.w.agents.find((b) => b.id === a.w.grab.id);
  const guard = hire(a.w, "escort", held);
  step(a.w, LEVELS, STILL);
  assert.equal(held.leader, guard.id);
  assert.equal(a.w.grab, null, "ended the same step");
  assert.equal(line(a.w).length, 0);
  // the guard took everyone it could reach, so there is nobody to hold now
  still(a.w, STEPS * 2);
  assert.equal(line(a.w).length, 0);

  // the guard gets there the very step the hold fills: the player acts first and has them, once
  const b = checkedIn();
  go(b.w, desk.out[0]);
  still(b.w, STEPS - 1);
  const mine = b.w.agents.find((x) => x.id === b.w.grab.id);
  const late = hire(b.w, "escort", mine);
  step(b.w, LEVELS, STILL);
  assert.equal(mine.leader, player(b.w).id);
  assert.ok(!followers(b.w, late).includes(mine), "never in two lines");
  assert.equal(inmates(b.w).filter((x) => x.id === mine.id).length, 1);
});

test("a resident at a far bed behind a door the player cannot use is held from the doorway", () => {
  // the first cell's door made residents-only: the player can stand outside it, never go in
  const SHUT = LEVELS.map((lv, i) =>
    i ? lv : { ...lv, id: `${lv.id}-shut`, rooms: lv.rooms.map((r) => (r.id === "c0" ? { ...r, doors: r.doors.map((d) => ({ ...d, actors: false })) } : r)) },
  );
  const l = SHUT[0], c0 = l.stations.find((s) => s.id === "c0");
  const w = create(SHUT, 0, 7);
  w.ride.t = 9999;
  const p = player(w);
  const bed = c0.seats[0].at;
  const hungry = follower(w, p, 0, { state: "home", leader: -1, house: "c0", slot: 0, x: bed.x, y: bed.y, rest: SETTLE + 1 });
  hungry.needs.food = 0.1;
  // the player at the doorway, the resident far off at the bed through a wall the player cannot pass
  p.x = c0.at.x;
  p.y = c0.at.y;
  assert.ok(Math.hypot(p.x - bed.x, p.y - bed.y) > PICKUP_RADIUS * 2, "far out of a pickup's reach");
  const room = l.rooms.find((r) => r.id === "c0").rect, gap = { x: room.x + 39, y: room.y + room.h };
  const covers = (ws) => ws.some((r) => gap.x >= r.x && gap.x <= r.x + r.w && gap.y >= r.y && gap.y <= r.y + r.h);
  assert.ok(covers(walls(l, () => true, false)), "the door is a wall to the player");
  assert.ok(!covers(walls(l, () => true, true)), "and a door to the residents");
  still(w, STEPS - 1, SHUT);
  assert.equal(hungry.state, "home");
  assert.equal(w.grab.id, hungry.id);
  still(w, 1, SHUT);
  assert.equal(hungry.state, "follow");
  assert.equal(hungry.leader, p.id);
});

test("a reload mid-hold starts the hold over; a save with no hold or a junk one comes back with none", () => {
  const { w } = checkedIn();
  go(w, desk.out[0]);
  still(w, 20);
  assert.ok(w.grab.t > 0);
  const back = restore(JSON.stringify(w), LEVELS);
  assert.equal(back.grab, null);
  const { grab, ...old } = w;
  assert.equal(restore(JSON.stringify(old), LEVELS).grab, null);
  assert.equal(restore(JSON.stringify({ ...w, grab: { id: "x", t: 9 } }), LEVELS).grab, null);
  assert.equal(create(LEVELS, 1, 3).grab, null, "a new level starts with none");
  still(back, STEPS - 1);
  assert.equal(line(back).length, 0, "the 20 steps before the reload count for nothing");
  still(back, 1);
  assert.equal(line(back).length, 1);
});

test("the player's line moves into a cell all at once, as many as there are beds, and each once", () => {
  const { w } = checkedIn();
  w.lineMax = 3;
  go(w, desk.out[1]);
  until(w, () => line(w).length === 3, 3, "three to join");
  const three = line(w);
  const moved = new Map();
  const watch = () => {
    for (const b of three) if (b.house && !moved.has(b.id)) moved.set(b.id, { step: w.steps, house: b.house, slot: b.slot });
  };
  // to the first cell's door from below, clear of the second's
  go(w, { x: station("c0").at.x, y: 230 }, watch);
  assert.equal(moved.size, 0, "nobody moves in on the way");
  go(w, station("c0").at, watch);
  still(w, 30);
  watch();
  assert.equal(moved.size, 2, "two beds, two in");
  const [x, y] = [...moved.values()];
  assert.equal(x.step, y.step, "both on the same step");
  assert.deepEqual([x.house, y.house], ["c0", "c0"]);
  assert.notEqual(x.slot, y.slot);
  assert.equal(line(w).length, 1, "the third stays in line");
  // the next cell takes the third the step the player gets there
  const third = line(w)[0];
  let at = -1;
  go(w, station("c1").at, () => {
    if (third.house && at < 0) at = w.steps;
  });
  assert.ok(at > 0 && third.house === "c1");
  assert.ok(Math.hypot(player(w).x - station("c1").at.x, player(w).y - station("c1").at.y) - station("c1").r < w.speed * DT * 2, "on arrival");
});

test("the player sees everyone done off at the release desk at once: each paid, starred and counted once", () => {
  const { w } = checkedIn();
  go(w, desk.out[0]);
  until(w, () => line(w).length === 2, 2, "two to join");
  line(w).forEach((b, i) => Object.assign(b, { house: "c0", slot: i, served: L.serve }));
  w.coins = 0;
  const pile = w.piles.stamp ?? 0;
  const freed = [];
  go(w, stamp.at, () => freed.push(w.released));
  const first = freed.findIndex((n) => n > 0);
  assert.ok(first >= 0);
  assert.equal(freed[first], 2, "both on the same step");
  assert.equal(w.piles.stamp - pile, 2 * stamp.pay, "paid once each");
  assert.equal(w.rank, 2, "two stars, one rank");
  assert.equal(w.stars, 0);
  still(w, 120);
  assert.equal(w.released, 2, "nobody twice");
  assert.equal(w.piles.stamp - pile, 2 * stamp.pay);
});

test("a guard keeps its own pace: one into a cell each quarter second, one out at the desk each `every`", () => {
  // the steps a station's clock pays out on, added up the way the sim adds them
  const ticks = (every, n) => {
    const out = [];
    let c = 0, s = 0;
    while (out.length < n) {
      s++;
      c += DT;
      if (c >= every) {
        c -= every;
        out.push(s);
      }
    }
    return out;
  };
  const w = create(LEVELS, 0, 7);
  w.ride.t = 9999;
  player(w).x = HALL.x;
  const c0 = station("c0");
  const guard = hire(w, "escort", c0.at);
  const two = [follower(w, guard, 0), follower(w, guard, 1)];
  const at = new Map();
  for (let s = 1; s <= 60 && at.size < 2; s++) {
    step(w, LEVELS, STILL);
    for (const b of two) if (b.house && !at.has(b.id)) at.set(b.id, s);
  }
  assert.deepEqual([...at.values()], ticks(0.25, 2), "move-in on the quarter-second clock");

  const v = create(LEVELS, 0, 7);
  v.ride.t = 9999;
  const g = hire(v, "escort", stamp.at);
  [follower(v, g, 0, { house: "c0", slot: 0, served: L.serve }), follower(v, g, 1, { house: "c0", slot: 1, served: L.serve })];
  const out = [];
  let was = 0;
  for (let s = 1; s <= 120 && out.length < 2; s++) {
    step(v, LEVELS, STILL);
    if (v.released > was) (was = v.released), out.push(s);
  }
  assert.deepEqual(out, ticks(stamp.every, 2), "release on the desk's own clock");
});

test("on skates the line still catches up: each follower faster than the leader rides, never slower", () => {
  for (let id = 2; id < 60; id++)
    for (const s of [0, 17, 300, 1234, 99999]) {
      const k = catchUp(id, s);
      assert.ok(k >= CATCH_MIN - 1e-12 && k <= CATCH_MAX + 1e-12, `${id} at ${s}: ${k}`);
    }
  assert.ok(CATCH_MIN > 1);
  // three in line, each well behind its place, the leader boosted along the hall below the canteen
  const w = create(LEVELS, 0, 7);
  w.ride.t = 9999;
  w.boost.t = 9999;
  w.mountKind = "skates";
  w.boosted = 10;
  const p = player(w);
  p.x = 100;
  p.y = 540;
  p.trail = Array.from({ length: 40 }, (_, k) => ({ x: p.x - 3 * (k + 1), y: p.y }));
  const three = [0, 1, 2].map((k) => follower(w, p, k, { x: p.x - (k + 1) * FOLLOW_GAP - 20, y: p.y }));
  const gaps = () => three.map((b, i) => Math.abs(p.x - (i + 1) * FOLLOW_GAP - b.x));
  for (let i = 0; i < 60 * 1.7; i++) step(w, LEVELS, { x: 1, y: 0 });
  assert.ok(w.boosted > 0 && p.x > 400, `boosted the whole way, at ${p.x}`);
  assert.ok(gaps().every((g) => g < 2), `each in its place: ${gaps().map((g) => g.toFixed(1))}`);
  assert.ok(three[0].x > three[1].x && three[1].x > three[2].x, "in order");
});

test("through a narrow cell door and back with a line of three: nobody stuck, the order kept, no sway into a wall", () => {
  const w = create(LEVELS, 0, 7);
  w.ride.t = 9999;
  w.boost.t = 9999;
  w.lineMax = 3;
  const p = player(w);
  // served their time and at nobody's door: they only follow
  const three = [0, 1, 2].map((k) => follower(w, p, k, { house: "c1", slot: k % 2, served: L.serve }));
  const ws = walls(L, (r) => !r.locked || w.bought.includes(r.locked), true);
  let worst = Infinity;
  const look = () => {
    for (const b of three) {
      const raw = clearance(b.x, b.y, ws);
      for (const t of [0, 0.37, 1.1, 2.9]) {
        const heading = (b.id + t) * 1.3;
        const off = sway(b.id, w.steps * DT + t, b.x, b.y, heading, ws);
        const drawn = clearance(b.x + off.x, b.y + off.y, ws);
        worst = Math.min(worst, drawn - Math.min(raw, 10));
      }
    }
  };
  const door = station("c0").at;
  for (const to of [{ x: door.x, y: 230 }, door, { x: door.x, y: 80 }, door, { x: door.x, y: 230 }, HALL]) go(w, to, look);
  still(w, 120);
  assert.ok(worst > -1e-9, `the sway never takes anyone nearer a wall than a body's width: ${worst}`);
  const line3 = line(w);
  assert.deepEqual(ids(line3), ids(three), "all three, in order");
  line3.forEach((b, i) => {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    assert.ok(d <= (i + 1) * FOLLOW_GAP + 2, `${i}: ${d.toFixed(1)} behind`);
  });
});
