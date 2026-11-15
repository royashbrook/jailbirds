import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LEVELS } from "../src/content/jail.ts";
import { capacity, create, DT, isOpen, restore, route, step } from "../src/engine/sim.ts";
import { collide, doorMid, walls } from "../src/engine/geom.ts";

// Captured from live 17d56cf before adding the annex: old content must not move or change price.
const BEFORE = ["25cb1f26aeb0a37fd61d471bb2bd2193dac1abe363b28633888f0ff01aacf255", "677fa5619e2bdaa09b3320e58d303eb9db343f06292a27863e7070227dc26424"];

test("the annex appends to both jails without changing any pre-care content", () => {
  for (const [i, l] of LEVELS.entries()) {
    const old = { ...l, size: { ...l.size, w: 720 }, rooms: l.rooms.filter(r => r.id !== "hospital"), stations: l.stations.filter(s => s.id !== "hospital"), pads: l.pads.filter(p => !["hospital", "carebeds"].includes(p.id)) };
    assert.equal(createHash("sha256").update(JSON.stringify(old)).digest("hex"), BEFORE[i], l.id);
    assert.deepEqual(l.size, { w: 960, h: 900 });
    const room = l.rooms.find(r => r.id === "hospital"), care = l.stations.find(s => s.id === "hospital");
    assert.deepEqual(room.rect, { x: 760, y: 310, w: 180, h: 210 });
    assert.equal(room.locked, "hospital");
    assert.deepEqual(doorMid(room, room.doors[0]).mid, { x: 760, y: 410 });
    assert.deepEqual(care.zone, { x: 770, y: 375, w: 160, h: 70 });
    assert.deepEqual(care.seats.map(s => s.at), [{ x: 805, y: 355 }, { x: 895, y: 355 }, { x: 805, y: 470 }, { x: 895, y: 470 }]);
    assert.deepEqual([care.kind, care.look, care.need, care.use, care.messChance], ["facility", "care", "care", 8, 0]);
    assert.deepEqual(care.seats.map(s => s.locked), ["hospital", "hospital", "carebeds", "carebeds"]);
    assert.ok(!l.needs.some(n => n.id === "care"), "recovery is not a new decaying need");
  }
});

test("care opens two then four treatment places, never home capacity, at each jail's existing cost scale", () => {
  for (const [i, l] of LEVELS.entries()) {
    const w = create(LEVELS, i, 4), care = l.stations.find(s => s.id === "hospital");
    const hospital = l.pads.find(p => p.id === "hospital"), beds = l.pads.find(p => p.id === "carebeds");
    const open = () => care.seats.filter(s => isOpen(w, s.locked)).length;
    assert.deepEqual([hospital.cost, hospital.rank, hospital.after, hospital.at], [80 * (i + 1), 3, "cell4", { x: 850, y: 560 }]);
    assert.deepEqual(hospital.unlock, { room: "hospital" });
    assert.deepEqual([beds.cost, beds.rank, beds.after, beds.at], [100 * (i + 1), 5, "hospital", hospital.at]);
    assert.equal(open(), 0);
    assert.equal(capacity(w, l), 4);
    w.bought.push("hospital"); assert.equal(open(), 2); assert.equal(capacity(w, l), 4);
    w.bought.push("carebeds"); assert.equal(open(), 4); assert.equal(capacity(w, l), 4);
    w.bought.push("cell3", "cell4", "cell5", "cell6", "cell7", "cell8");
    assert.equal(capacity(w, l), 16);
  }
});

test("existing entrances reach the care pads and open treatment seats without crossing a wall", () => {
  for (const [i, l] of LEVELS.entries()) for (const open of [false, true]) {
    const w = create(LEVELS, i, 4);
    if (open) w.bought.push(...l.pads.map(p => p.id));
    const ws = walls(l, r => isOpen(w, r.locked), false);
    const origins = [l.start, l.helperHome, ...l.stations.filter(s => s.kind === "house").map(s => s.at)];
    const care = l.stations.find(s => s.id === "hospital");
    const targets = [{ x: 850, y: 560 }, { x: 850, y: 625 }, ...(open ? care.seats.map(s => s.at) : [])];
    for (const from of origins) for (const to of targets) {
      let prev = from;
      const path = route(w, l, { ...w.agents[0], ...from }, to);
      assert.deepEqual(path.at(-1), to);
      for (const next of path) {
        const n = Math.max(1, Math.ceil(Math.hypot(next.x - prev.x, next.y - prev.y)));
        for (let k = 0; k <= n; k++) {
          const p = { x: prev.x + (next.x - prev.x) * k / n, y: prev.y + (next.y - prev.y) * k / n }, before = { ...p };
          collide(p, 10, ws);
          assert.ok(Math.hypot(p.x - before.x, p.y - before.y) < 1e-6, JSON.stringify({ jail: l.id, open, from, to, before, p }));
        }
        prev = next;
      }
    }
  }
});

test("the wider world adds exactly 80 bus-exit steps, without changing the bus speed or old ride state", () => {
  const duration = (levels) => {
    const w = create(levels, 0, 4); w.ride = { state: "out", x: 150, t: 0 };
    let n = 0;
    while (w.ride.state === "out" && n < 1000) { step(w, levels, { x: 0, y: 0 }); n++; }
    assert.ok(n < 1000);
    return n;
  };
  const old = LEVELS.map(l => ({ ...l, size: { ...l.size, w: 720 } }));
  const saved = create(old, 0, 4);
  saved.ride = { state: "out", x: 701, t: 3.2 };
  const reopened = restore(JSON.stringify(saved), LEVELS);
  assert.ok(reopened);
  assert.deepEqual(reopened.ride, saved.ride);
  assert.equal(duration(LEVELS) - duration(old), 80);
  assert.ok(Math.abs(80 * DT - 240 / 180) < 1e-10);
});
