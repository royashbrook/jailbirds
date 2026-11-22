import { test } from "node:test";
import assert from "node:assert/strict";
import {
  create, step, player, restore, hint, isOpen, route, AGENT_SPEED, CATCH_MAX, CARE_RATE, DT, HELPER_SPEED, HOLD, UPSET,
} from "../src/engine/sim.ts";
import { LEVELS, hintText } from "../src/content/jail.ts";
import { inside, walls } from "../src/engine/geom.ts";
import { actionOf } from "../src/view/view.ts";

// care: a resident resting off a bump at home may be led to a free care seat, held for them from the
// moment they leave home. there the bump comes off at 2.5 a second instead of 1, then they walk back to
// the bed they kept. no free seat, no room, or a seat lost on a reload: they rest at home as before
const STILL = { x: 0, y: 0 };
const BUMP = LEVELS[0].riot.bump;
const steps = (w, n) => {
  for (let i = 0; i < n; i++) step(w, LEVELS, STILL);
};
const wait = (w, seconds) => steps(w, Math.round(seconds / DT));
const until = (w, done, seconds, what, each = () => {}) => {
  for (let i = 0; i < seconds / DT; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
    each();
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
const byId = (w, id) => w.agents.find((a) => a.id === id);
const lv = (w) => LEVELS[w.level];
const station = (w, id) => lv(w).stations.find((s) => s.id === id);
const reward = (w) => w.floor.filter((c) => c.house === "").length;
const residents = (w) => w.agents.filter((a) => a.kind === "agent");
const HOMES = [["c0", 0], ["c0", 1], ["c1", 0], ["c1", 1], ["c2", 0], ["c2", 1]];

/** a jail with residents in their beds, needs full, calm, settled in. `hurt` is each one's bump, 0 well;
 * the ones in `done` have served their time. no bus, no incidents, no surprises on the floor */
function careJail({ level = 0, bought = ["hospital"], hurt = [BUMP], done = [], rank = 5, unrest = [] } = {}) {
  const w = create(LEVELS, level, 7);
  const l = LEVELS[level];
  w.rank = rank;
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  w.bought.push(...bought);
  if (hurt.length > 4) w.bought.push("cell3");
  hurt.forEach((h, i) => {
    const [house, slot] = HOMES[i];
    const at = station(w, house).seats[slot].at;
    w.agents.push({
      id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"],
      state: "home", leader: -1, house, slot, station: "", seat: -1,
      needs: Object.fromEntries(l.needs.map((n) => [n.id, 1])), unrest: unrest[i] ?? 0, served: done.includes(i) ? l.serve : 0,
      hurt: h, rest: 10, t: 0, carry: 0, cash: 0, path: [], trail: [],
    });
  });
  Object.assign(player(w), { x: 330, y: 540 });
  return w;
}
/** a hired guard, standing where it is put */
function guard(w, at = lv(w).helperHome) {
  const g = {
    id: w.nextId++, kind: "escort", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0,
    path: [], trail: [],
  };
  w.agents.push(g);
  return g;
}
/** who holds which care seat right now: led to it, on the way, or in it */
const holders = (w) => residents(w).filter((a) => a.station === "hospital" && ["follow", "go", "use"].includes(a.state));
/** no care seat is ever held by two, and none that is not open */
function oneEach(w) {
  const keys = holders(w).map((a) => a.seat);
  assert.equal(new Set(keys).size, keys.length, `a care seat held twice: ${keys}`);
  const care = station(w, "hospital");
  for (const s of keys) assert.ok(care.seats[s] && isOpen(w, care.seats[s].locked), `seat ${s} is not open`);
}
/** a resident in its own bed, from `x` */
const inBed = (w, a) => a.state === "home" && a.x === station(w, a.house).seats[a.slot].at.x && a.y === station(w, a.house).seats[a.slot].at.y;

/** every step: no resident jumps, and none is ever inside a wall it cannot pass */
function clearOf(w, ids) {
  const was = new Map(ids.map((id) => [id, { x: byId(w, id).x, y: byId(w, id).y }]));
  const most = Math.max(w.speed * CATCH_MAX, HELPER_SPEED * 1.15, AGENT_SPEED) * DT + 1e-6;
  return () => {
    const ws = walls(lv(w), (r) => isOpen(w, r.locked), true);
    for (const id of ids) {
      const a = byId(w, id), b = was.get(id);
      if (!a) continue;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= most, `resident ${id} jumped`);
      const hit = ws.find((r) => inside(a, r));
      assert.ok(!hit, `resident ${id} at ${a.x.toFixed(1)},${a.y.toFixed(1)} inside a wall ${JSON.stringify(hit)}`);
      was.set(id, { x: a.x, y: a.y });
    }
  };
}
/** the player walks itself to `to` by the stick along its route, as a thumb would, checking `each` every step */
function drive(w, to, each = () => {}, seconds = 40) {
  const p = player(w);
  const path = route(w, lv(w), p, to);
  for (let i = 0; i < seconds / DT; i++) {
    while (path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 1.5) path.shift();
    if (!path.length) return;
    const dx = path[0].x - p.x, dy = path[0].y - p.y, d = Math.hypot(dx, dy);
    step(w, LEVELS, { x: dx / d, y: dy / d });
    each();
  }
  assert.fail(`the player never got to ${JSON.stringify(to)}`);
}
/** the player stands still at a home's door until `done` */
function standAt(w, house, done, what) {
  const door = station(w, house).at;
  Object.assign(player(w), { x: door.x, y: door.y });
  until(w, done, HOLD + 1, what);
}
const careMid = (w) => {
  const z = station(w, "hospital").zone;
  return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
};

test("care is a service the bump asks for, not a need: it never shows in anyone's needs", () => {
  const w = careJail();
  const a = residents(w)[0];
  guard(w);
  until(w, () => a.state === "use", 40, "in a care seat");
  until(w, () => a.state === "home", 30, "home again");
  for (const r of residents(w)) assert.ok(!("care" in r.needs));
});

for (const level of [0, 1]) {
  test(`jail ${level + 1}: the room opens two care seats and more beds four, and never more are held at once`, () => {
    for (const [bought, open] of [[["hospital"], 2], [["hospital", "carebeds"], 4]]) {
      // four bumped in two cells, two guards who each take two at once
      const w = careJail({ level, bought, hurt: [BUMP, BUMP, BUMP, BUMP] });
      guard(w);
      guard(w, { x: lv(w).helperHome.x + 16, y: lv(w).helperHome.y });
      let most = 0;
      until(w, () => residents(w).every((a) => a.hurt === 0), 90, "everyone well", () => {
        oneEach(w);
        most = Math.max(most, residents(w).filter((a) => a.state === "use").length);
      });
      assert.equal(most, open, `${bought}: ${open} treated at once`);
    }
  });

  test(`jail ${level + 1}: a guard takes a bumped one from bed to a care seat and back on routes, bed kept, faster than home`, () => {
    const w = careJail({ level });
    const a = residents(w)[0];
    const bed = { house: a.house, slot: a.slot };
    guard(w);
    const each = clearOf(w, [a.id]);
    until(w, () => a.state === "follow", 20, "led off", each);
    assert.equal(a.station, "hospital", "the seat is held as they leave home");
    assert.deepEqual({ house: a.house, slot: a.slot }, bed, "the bed stays theirs while away");
    until(w, () => a.state === "use", 40, "in a care seat", each);
    const seat = station(w, "hospital").seats[a.seat].at;
    assert.deepEqual({ x: a.x, y: a.y }, seat, "in the bed it holds");
    const hurt = a.hurt, served = a.served, needs = { ...a.needs };
    wait(w, 2);
    assert.ok(Math.abs(a.hurt - (hurt - 2 * CARE_RATE)) < 0.05, `2.5 a second: ${hurt} to ${a.hurt}`);
    assert.ok(a.served > served + 1.9, "time served goes on");
    assert.deepEqual(a.needs, needs, "needs wait");
    until(w, () => a.hurt === 0, hurt / CARE_RATE, "well in the care seat, inside the full case's 8 seconds");
    until(w, () => a.state === "home", 30, "home again", each);
    assert.deepEqual({ house: a.house, slot: a.slot }, bed);
    assert.ok(inBed(w, a), "back in the bed it kept");
    assert.equal(a.station, "");
  });

  test(`jail ${level + 1}: partial treatment survives a save and a reload, and finishes from where it was`, () => {
    const w = careJail({ level });
    const a = residents(w)[0];
    guard(w);
    until(w, () => a.state === "use", 40, "in a care seat");
    wait(w, 3);
    const left = a.hurt, served = a.served;
    assert.ok(left > 0 && left < BUMP - 7, `partly treated, ${left}`);
    const back = restore(JSON.stringify(w), LEVELS);
    const b = byId(back, a.id);
    assert.equal(b.state, "use");
    assert.deepEqual([b.station, b.seat, b.hurt, b.served], [a.station, a.seat, left, served], "kept as it was");
    // and once more, as a trip to the other jail and back is
    const again = restore(JSON.stringify(back), LEVELS);
    const c = byId(again, a.id);
    assert.equal(c.hurt, left);
    until(again, () => c.hurt === 0, left / CARE_RATE + 0.1, "treated off what was left, not the 8 second timer");
    until(again, () => c.state === "home", 30, "home");
    assert.ok(inBed(again, c));
  });

  test(`jail ${level + 1}: with the care room still locked, or no care room at all, a bump rests off at home, one a second`, () => {
    const noRoom = LEVELS.map((l) => ({ ...l, stations: l.stations.filter((s) => s.id !== "hospital") }));
    for (const [levels, bought] of [[LEVELS, []], [noRoom, []], [noRoom, ["hospital"]]]) {
      const w = careJail({ level, bought });
      const a = residents(w)[0];
      guard(w);
      Object.assign(player(w), { x: station(w, "c0").at.x, y: station(w, "c0").at.y });
      for (let i = 0; i < 5 / DT; i++) {
        step(w, levels, STILL);
        assert.equal(a.state, "home", "nobody takes them anywhere");
        assert.notEqual(hint(w, levels[level]).key, "care", "and nobody is told to");
      }
      assert.ok(Math.abs(a.hurt - (BUMP - 5)) < 0.05, `one a second, ${a.hurt}`);
    }
  });
}

test("a full care room: the next one rests at home, nobody is led off to stand in a line, and it is taken once a seat is free", () => {
  // both seats in use by two nearly well, a third bumped in its bed in c1 with the player at its door
  const w = careJail({ hurt: [2, 2, BUMP] });
  const care = station(w, "hospital");
  const [a, b, c] = residents(w);
  a.station = b.station = "hospital";
  [a, b].forEach((r, i) => Object.assign(r, { state: "use", seat: i, x: care.seats[i].at.x, y: care.seats[i].at.y }));
  const door = station(w, "c1").at;
  Object.assign(player(w), { x: door.x, y: door.y });
  const hurt = c.hurt;
  until(w, () => a.state !== "use" && b.state !== "use", 1, "both seats come free", () => {
    oneEach(w);
    assert.equal(c.state, "home", "not taken while it is full");
    if (a.state !== "use" || b.state !== "use") return;
    assert.notEqual(hint(w, lv(w)).key, "care");
  });
  assert.ok(Math.abs(c.hurt - (hurt - 2 / CARE_RATE)) < 0.05, `rested at home at one a second while it was full, ${c.hurt}`);
  until(w, () => c.state === "follow", HOLD + 0.2, "taken once a seat is free");
  assert.equal(c.station, "hospital");
  oneEach(w);
});

test("two guards at two doors in the same step, one seat left: only one is led off", () => {
  const w = careJail({ hurt: [BUMP, 0, BUMP] });
  const care = station(w, "hospital");
  // the other seat already taken by someone in it
  const [x, , y] = residents(w);
  const taken = residents(w)[1];
  Object.assign(taken, { hurt: BUMP, state: "use", station: "hospital", seat: 0, x: care.seats[0].at.x, y: care.seats[0].at.y });
  guard(w, station(w, "c0").at);
  guard(w, station(w, "c1").at);
  steps(w, 1);
  oneEach(w);
  const led = [x, y].filter((r) => r.state === "follow");
  assert.equal(led.length, 1, "one of them");
  assert.equal(led[0].seat, 1);
  const left = [x, y].find((r) => r !== led[0]);
  assert.equal(left.state, "home");
  assert.equal(left.station, "");
});

test("one guard at a door with two bumped behind it and one seat: it takes one, the other stays in bed", () => {
  // done or not: one done would otherwise stay in line with no seat, never let out and never treated
  for (const done of [[], [0, 1]]) {
    const w = careJail({ hurt: [BUMP, BUMP, BUMP], done });
    const care = station(w, "hospital");
    const third = residents(w)[2];
    Object.assign(third, { state: "use", station: "hospital", seat: 1, x: care.seats[1].at.x, y: care.seats[1].at.y });
    guard(w, station(w, "c0").at);
    steps(w, 1);
    oneEach(w);
    const [a, b] = residents(w);
    assert.deepEqual([a.state, b.state].sort(), ["follow", "home"], `done ${done}`);
    wait(w, 1);
    assert.equal(residents(w).filter((r) => r.state === "follow" && !r.station).length, 0, "nobody led with no seat");
  }
});

test("at the release desk, the player or a guard lets out the well one who is done and keeps the bumped one", () => {
  for (const kind of ["player", "guard"]) {
    const w = careJail({ hurt: [BUMP, 0], done: [0, 1] });
    const desk = station(w, "stamp");
    const lead = kind === "player" ? player(w) : guard(w, desk.at);
    Object.assign(lead, { x: desk.at.x, y: desk.at.y });
    const [hurt, well] = residents(w);
    // the bumped one first in line
    Object.assign(hurt, { state: "follow", leader: lead.id, t: 0, station: "hospital", seat: 0 });
    Object.assign(well, { state: "follow", leader: lead.id, t: 1 });
    // a guard would head off to care with the bumped one first: kept at the desk here, the worst case,
    // for the beat it takes to hand one over
    for (let i = 0; i < (desk.every + 0.1) / DT && w.released === 0; i++) {
      Object.assign(lead, { x: desk.at.x, y: desk.at.y });
      steps(w, 1);
    }
    assert.equal(w.released, 1, `${kind}: one let out`);
    assert.equal(well.state, "stamp");
    assert.equal(hurt.state, "follow", `${kind}: the bumped one stays in line`);
    assert.equal(hurt.house, "c0", "its bed kept");
  }
});

test("the player and a guard race for the last seat: whoever takes it first has it, the other stays home", () => {
  for (const first of ["player", "guard"]) {
    const w = careJail({ hurt: [BUMP, 0, BUMP, BUMP] });
    const care = station(w, "hospital");
    const [x, , y, z] = residents(w);
    // z is in one seat already
    Object.assign(z, { state: "use", station: "hospital", seat: 0, x: care.seats[0].at.x, y: care.seats[0].at.y });
    if (first === "player") {
      standAt(w, "c0", () => x.state === "follow", "the player's pick");
      guard(w, station(w, "c1").at);
      wait(w, 1);
      assert.equal(y.state, "home", "the guard finds no seat");
    } else {
      // the player starts the hold, the guard takes the other at once and the seat with it
      const door = station(w, "c0").at;
      Object.assign(player(w), { x: door.x, y: door.y });
      steps(w, 5);
      guard(w, station(w, "c1").at);
      wait(w, 1);
      assert.equal(y.state, "follow");
      assert.equal(x.state, "home", "the player's hold comes to nothing");
      assert.equal(w.grab, null);
    }
    oneEach(w);
    assert.equal(holders(w).length, 2);
  }
});

test("the player picks a bumped one up at the cell door and it is not sent back in: it walks behind to its care seat", () => {
  for (const level of [0, 1]) {
    const w = careJail({ level });
    const a = residents(w)[0];
    const door = station(w, "c0").at;
    Object.assign(player(w), { x: door.x, y: door.y });
    let n = 0;
    while (a.state !== "follow") {
      step(w, LEVELS, STILL);
      assert.ok(++n < (HOLD + 0.5) / DT, "picked up");
    }
    // the same step it joined, and every step after at its own door: still in line
    assert.equal(a.station, "hospital");
    steps(w, 30);
    assert.equal(a.state, "follow", "not bounced home by its own door");
    assert.equal(hint(w, lv(w)).key, "care");
    const each = clearOf(w, [a.id]);
    drive(w, careMid(w), () => {
      each();
      oneEach(w);
    });
    until(w, () => a.state === "use", 15, "in its care seat", each);
    assert.deepEqual({ x: a.x, y: a.y }, station(w, "hospital").seats[a.seat].at);
    assert.equal(actionOf(w, lv(w), a), "sleep", "lying in the care bed");
    until(w, () => a.state === "home", 30, "home after", each);
    assert.ok(inBed(w, a));
  }
});

test("done and bumped: never let out while resting, treated, then let out exactly once", () => {
  const w = careJail({ done: [0] });
  const a = residents(w)[0];
  const desk = station(w, "stamp");
  assert.notEqual(hint(w, lv(w)).key, "done", "nobody is told to let a resting one out");
  assert.equal(hint(w, lv(w)).key, "care");
  standAt(w, "c0", () => a.state === "follow", "picked up");
  assert.equal(a.station, "hospital");
  drive(w, desk.at);
  wait(w, 2);
  assert.equal(w.released, 0, "not at the desk while resting");
  assert.equal(a.state, "follow");
  // out of the release office by its west door, then over to care
  drive(w, { x: 470, y: 740 });
  drive(w, careMid(w));
  until(w, () => a.state === "use", 15, "in care");
  until(w, () => a.state === "home", 30, "home well");
  assert.equal(a.hurt, 0);
  assert.equal(w.released, 0);
  assert.equal(hint(w, lv(w)).key, "done");
  drive(w, station(w, "c0").at);
  until(w, () => a.state === "follow", HOLD + 1, "fetched for release");
  drive(w, desk.at);
  until(w, () => w.released === 1, 2, "let out");
  wait(w, 10);
  assert.equal(w.released, 1, "once");
});

test("a guard with one done and bumped takes it to care first, and lets it out only once it is well, once", () => {
  const w = careJail({ done: [0] });
  const a = residents(w)[0], id = a.id;
  guard(w);
  let cured = false;
  until(w, () => w.released === 1, 80, "let out", () => {
    if (a.state === "use") cured = true;
    if (a.state === "stamp") assert.equal(a.hurt, 0, "let out only well");
  });
  assert.ok(cured, "it went through care");
  wait(w, 10);
  assert.equal(w.released, 1);
  assert.ok(!byId(w, id) || byId(w, id).state === "leave");
});

test("bumped and waiting for care, or in it: in no incident, not counted for one", () => {
  for (const where of ["home", "use"]) {
    const w = careJail({ hurt: [BUMP, 0, 0, 0, 0], unrest: [0.9, 0.9, 0.9, 0.9, 0.9], rank: 5 });
    const a = residents(w)[0];
    w.fightIn = 1e9;
    assert.equal(hint(w, lv(w)).key, "care", "a care trip is there to make");
    if (where === "use") {
      guard(w);
      until(w, () => a.state === "use", 40, "in care");
      w.agents = w.agents.filter((g) => g.kind !== "escort");
    }
    for (const r of residents(w)) r.unrest = 0.9;
    w.riotCalm = 0;
    w.fightIn = 0;
    steps(w, 1);
    assert.equal(w.alert?.kind, "riot");
    assert.ok(!w.alert.ids.includes(a.id), `${where}: not in the riot`);
    assert.ok(a.unrest >= UPSET && a.id < Math.min(...w.alert.ids), "it was upset and lowest: only being bumped kept it out");
  }
  // and a squabble below riot rank: the bumped one's cellmate has nobody to squabble with
  const w = careJail({ hurt: [BUMP, 0, 0, 0, 0], rank: 2 });
  w.fightIn = 0;
  steps(w, 1);
  assert.ok(!w.alert || !w.alert.ids.includes(residents(w)[0].id));
});

test("bumped with no free care seat: standing at its door takes nobody, and the release desk lets nobody out", () => {
  const w = careJail({ bought: [], done: [0] });
  const a = residents(w)[0];
  const door = station(w, "c0").at;
  Object.assign(player(w), { x: door.x, y: door.y });
  wait(w, 3);
  assert.equal(a.state, "home");
  assert.equal(w.released, 0);
});

test("a care seat lost on a reload sends its holder home to rest, nothing paid, nobody lost", () => {
  const w = careJail({ hurt: [BUMP, BUMP, BUMP, BUMP] });
  const [a, b, c, d] = residents(w);
  const care = station(w, "hospital");
  Object.assign(a, { state: "follow", leader: 1, station: "hospital", seat: 0 });
  Object.assign(b, { state: "use", station: "hospital", seat: 1, x: care.seats[1].at.x, y: care.seats[1].at.y });
  Object.assign(c, { state: "go", station: "hospital", seat: 0, path: [] });
  Object.assign(d, { state: "follow", leader: 1, station: "hospital", seat: 9 });
  const raw = JSON.parse(JSON.stringify(w));
  let back = restore(JSON.stringify(raw), LEVELS);
  const got = (x, id) => x.agents.find((r) => r.id === id);
  assert.equal(got(back, a.id).state, "follow", "the first to hold seat 0 keeps it");
  assert.equal(got(back, b.id).state, "use", "seat 1 kept");
  assert.equal(got(back, c.id).state, "back", "a second holder of seat 0 goes home");
  assert.equal(got(back, d.id).state, "back", "a seat that is not there");
  oneEach(back);
  // the room no longer bought: every holder goes home
  raw.bought = raw.bought.filter((p) => p !== "hospital");
  back = restore(JSON.stringify(raw), LEVELS);
  for (const r of residents(back)) {
    assert.equal(r.state, "back", `${r.id} goes home`);
    assert.equal(r.station, "");
    assert.equal(r.hurt, BUMP, "the bump still to rest off");
  }
  until(back, () => residents(back).every((r) => r.state === "home"), 30, "all home");
  const was = residents(back).map((r) => r.hurt);
  assert.ok(was.every((h) => h > 3), "still resting");
  wait(back, 3);
  residents(back).forEach((r, i) => assert.ok(Math.abs(r.hurt - (was[i] - 3)) < 0.05, `resting at home at one a second, ${was[i]} to ${r.hurt}`));
  assert.equal(reward(back) + back.coins, 0);
  // a holder whose bed is not here goes to the desk to be given one, as anyone with no bed does
  const lost = JSON.parse(JSON.stringify(w));
  lost.agents.find((r) => r.id === a.id).house = "missing";
  back = restore(JSON.stringify(lost), LEVELS);
  assert.equal(got(back, a.id).state, "ready");
  assert.equal(got(back, a.id).station, "");
  // one saved in a care seat already well goes home
  const well = JSON.parse(JSON.stringify(w));
  well.agents.find((r) => r.id === b.id).hurt = 0;
  back = restore(JSON.stringify(well), LEVELS);
  assert.equal(got(back, b.id).state, "back");
});

test("old saves: residents with no bump field load well, holding nothing, and the jail runs on", () => {
  const w = careJail({ bought: [], hurt: [0, 0, 0] });
  wait(w, 3);
  const raw = JSON.parse(JSON.stringify(w));
  delete raw.riotCalm;
  for (const a of raw.agents) delete a.hurt;
  const back = restore(JSON.stringify(raw), LEVELS);
  assert.ok(back);
  for (const a of residents(back)) {
    const was = residents(w).find((r) => r.id === a.id);
    assert.equal(a.hurt, 0);
    assert.deepEqual({ ...a, hurt: undefined }, { ...was, hurt: undefined }, "everything else as it was");
  }
  assert.notEqual(hint(back, lv(back)).key, "care");
  wait(back, 5);
  assert.ok(residents(back).every((a) => a.house));
});

test("the hint for care has words, and the view lies someone down in a care bed", () => {
  assert.match(hintText({ key: "care" }, "birds"), /nurse/);
  const w = careJail();
  const a = residents(w)[0];
  guard(w);
  until(w, () => a.state === "go", 40, "on the way");
  until(w, () => a.moving, 5, "walking");
  assert.equal(actionOf(w, lv(w), a), "walk");
  until(w, () => a.state === "use", 20, "in care");
  assert.equal(actionOf(w, lv(w), a), "sleep");
});
