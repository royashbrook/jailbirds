import { test } from "node:test";
import assert from "node:assert/strict";
import { create, step, player, restore, route, padVisible, isOpen, boostMult, hint, ALERT_R, DT, HELPER_SPEED } from "../src/engine/sim.ts";
import { LEVELS, hintText } from "../src/content/jail.ts";
import { collide, inside, walls } from "../src/engine/geom.ts";
import { worldOf } from "../src/lib/map.ts";
import { model } from "../src/skins/pegs.ts";

// the riot guard: one helper, one pad. it walks to a squabble or a riot and stands there, and the one
// hold runs while it or the player is in reach, never faster for both. it leads nobody, carries
// nothing, takes no coins and starts nothing
const STILL = { x: 0, y: 0 };
const PARK = { x: 330, y: 540 };
// the riot guard's own pad: open floor, far from every incident
const FAR = { x: 850, y: 625 };
const lv = (w) => LEVELS[w.level];
const pad = (w, id) => lv(w).pads.find((p) => p.id === id);
const station = (w, id) => lv(w).stations.find((s) => s.id === id);
const calmers = (w) => w.agents.filter((a) => a.kind === "calmer");
const residents = (w) => w.agents.filter((a) => a.kind === "agent");
const helpers = (w) => w.agents.filter((a) => a.kind !== "agent" && a.kind !== "player");
const reward = (w) => w.floor.filter((c) => c.house === "").length;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const goal = (h) => h.path.at(-1) ?? { x: h.x, y: h.y };
const pathLen = (from, path) => path.reduce((n, p, i) => n + dist(i ? path[i - 1] : from, p), 0);
const clone = (w) => JSON.parse(JSON.stringify(w));

// drive the player like a thumb would
function go(w, to, cap = 60 * 40) {
  const p = player(w);
  const path = route(w, lv(w), p, to);
  for (let i = 0; i < cap; i++) {
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      path.shift();
      continue;
    }
    const s = w.speed * boostMult(w, lv(w)) * DT;
    step(w, LEVELS, d < s ? { x: dx / s, y: dy / s } : { x: dx / d, y: dy / d });
  }
  assert.fail(`never reached ${to.x},${to.y}`);
}
const wait = (w, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(w, LEVELS, STILL);
};
const until = (w, done, seconds, what) => {
  for (let i = 0; i < seconds / DT; i++) {
    if (done()) return;
    step(w, LEVELS, STILL);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
};
/** nobody coming, no incidents, no surprises: only what a test sets up happens */
function quiet(w) {
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.fightIn = 1e9;
  w.boost.t = 1e9;
  return w;
}

/** hire the riot guard off its pad as the player would: the care room open, the coins in hand, a walk
 * there and a stand on it. the incident clock is held off meanwhile; rank, clock and wallet are put back */
function hire(w) {
  const was = { rank: w.rank, fightIn: w.fightIn, coins: w.coins };
  if (!w.bought.includes("hospital")) w.bought.push("hospital");
  Object.assign(w, { rank: 5, fightIn: 1e9, coins: pad(w, "riotguard").cost });
  go(w, pad(w, "riotguard").at);
  until(w, () => w.bought.includes("riotguard"), 4, "the riot guard hired");
  Object.assign(player(w), PARK);
  Object.assign(w, was);
  return calmers(w)[0];
}

/** a jail at a rank with residents in cells c0 and c1, needs full so nobody leaves for a service, and
 * the given unrest each; the riot guard hired first unless `guard` is false; the incident clock due */
function jail({ rank = 3, unrest = [0.9, 0.9, 0.9, 0.9], level = 0, guard = true } = {}) {
  const w = quiet(create(LEVELS, level, 7));
  w.rank = rank;
  const homes = [["c0", 0], ["c0", 1], ["c1", 0], ["c1", 1]];
  unrest.forEach((u, i) => {
    const [house, slot] = homes[i];
    const at = station(w, house).seats[slot].at;
    w.agents.push({
      id: w.nextId++, kind: "agent", x: at.x, y: at.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"],
      state: "home", leader: -1, house, slot, station: "", seat: -1,
      needs: {}, unrest: u, served: 0, hurt: 0, rest: 10, t: 0, carry: 0, cash: 0, path: [], trail: [],
    });
  });
  Object.assign(player(w), PARK);
  const g = guard ? hire(w) : undefined;
  // as they were before the walk to the pad
  residents(w).forEach((a, i) => {
    a.unrest = unrest[i];
    a.needs = Object.fromEntries(lv(w).needs.map((n) => [n.id, 1]));
  });
  w.fightIn = 0;
  return { w, g };
}

/** step until `done`, checking the guard every step: never more than a walk at a time, and its centre
 * never inside a wall the player and helpers cannot pass. `each` runs after every step. gives the steps */
function track(w, done, seconds, what, each = () => {}) {
  let g = calmers(w)[0], was = { x: g.x, y: g.y };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (done()) return i;
    step(w, LEVELS, STILL);
    g = calmers(w)[0];
    const ws = walls(lv(w), (r) => isOpen(w, r.locked), false);
    assert.ok(dist(g, was) <= HELPER_SPEED * DT + 1e-6, `the guard jumped at step ${i}`);
    const hit = ws.find((r) => inside(g, r));
    assert.ok(!hit, `the guard at ${g.x.toFixed(1)},${g.y.toFixed(1)} is inside a wall ${JSON.stringify(hit)}`);
    was = { x: g.x, y: g.y };
    each(g);
  }
  assert.fail(`waited ${seconds}s for ${what}`);
}

/** steps of the hold until the incident is over: each step the hold went up, and the last step that
 * ended it. no step may add more than one DT */
function holdSteps(w, seconds) {
  let n = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const before = w.alert.held;
    step(w, LEVELS, STILL);
    if (!w.alert) return n + 1;
    const d = w.alert.held - before;
    assert.ok(d <= DT + 1e-12, `the hold went up ${d} in one step`);
    if (d > 0) n++;
  }
  assert.fail("never calmed");
}

test("in both jails: the riot guard pad, after the care room, rank 5, at the jail's cost scale, buys exactly one guard", () => {
  for (const [n, l] of LEVELS.entries()) {
    const p = l.pads.find((x) => x.id === "riotguard");
    assert.deepEqual(
      { at: p.at, rank: p.rank, after: p.after, cost: p.cost, unlock: p.unlock, label: p.label },
      { at: { x: 850, y: 625 }, rank: 5, after: "hospital", cost: Math.round(150 * (n + 1)), unlock: { helper: "calmer" }, label: "hire a riot guard" },
    );
    assert.ok(l.pads.every((x) => x.after !== "riotguard"), "nothing waits on it");
    const w = quiet(create(LEVELS, n, 7));
    assert.ok(!padVisible(w, p), "hidden until the care room is bought");
    w.bought.push("hospital");
    assert.ok(padVisible(w, p));
    assert.ok(padVisible(w, pad(w, "carebeds")), "the care room's own next pad is still on its own spot");
    w.coins = p.cost + 50;
    w.rank = 4;
    go(w, p.at);
    wait(w, 2);
    assert.equal(w.paid.riotguard ?? 0, 0, "rank 4 pays nothing");
    w.rank = 5;
    until(w, () => w.bought.includes("riotguard"), 4, "bought at rank 5");
    assert.equal(w.coins, 50, "paid its cost and no more");
    assert.equal(calmers(w).length, 1);
    assert.ok(dist(calmers(w)[0], l.helperHome) <= HELPER_SPEED * DT + 1e-6, "it turns up where helpers start");
    wait(w, 3);
    assert.equal(calmers(w).length, 1, "standing on the spot buys no second one");
    assert.ok(!padVisible(w, p));
    assert.equal(w.coins, 50);
  }
});

test("in both jails all eight hired helpers, the riot guard too, walk home clear of walls and stand apart on open floor", () => {
  const hires = ["cook", "guard", "guard2", "guard3", "clerk", "cleaner", "collector", "riotguard"];
  for (const n of [0, 1]) {
    const w = quiet(create(LEVELS, n, 7));
    const l = lv(w);
    w.coins = 5000;
    w.rank = 6;
    w.bought.push("hospital");
    for (const id of hires) {
      go(w, pad(w, id).at);
      until(w, () => w.bought.includes(id), 4, id);
    }
    go(w, PARK);
    const hs = helpers(w);
    assert.deepEqual(hs.map((a) => a.kind).sort(), ["calmer", "carrier", "cleaner", "clerk", "collector", "escort", "escort", "escort"]);
    const far = [{ x: 600, y: 790 }, { x: 250, y: 785 }, { x: 60, y: 420 }, { x: 600, y: 400 }, { x: 140, y: 700 }, { x: 395, y: 412 }, { x: 600, y: 200 }, FAR];
    hs.forEach((a, i) => Object.assign(a, { x: far[i].x, y: far[i].y, path: [] }));
    for (let i = 0; i < 40 / DT; i++) {
      step(w, LEVELS, STILL);
      const ws = walls(l, (r) => isOpen(w, r.locked), false);
      for (const a of hs) assert.ok(!ws.some((r) => inside(a, r)), `jail ${n + 1}: the ${a.kind} walked into a wall`);
    }
    const ws = walls(l, (r) => isOpen(w, r.locked), false);
    // the clerk's place is the desk; everyone else is on their idle spot
    const idle = hs.filter((a) => a.kind !== "clerk");
    for (const a of idle) {
      assert.ok(!a.moving, `jail ${n + 1}: the ${a.kind} got there`);
      assert.ok(dist(a, l.helperHome) <= 40, `jail ${n + 1}: the ${a.kind} is home`);
      const p = { x: a.x, y: a.y };
      collide(p, 10, ws);
      assert.ok(dist(p, a) < 1e-6, `jail ${n + 1}: the ${a.kind}'s spot is open floor, a body clear of every wall`);
      const path = route(w, l, { ...player(w), ...l.start }, a);
      assert.ok(dist(path.at(-1), a) < 1e-6, `jail ${n + 1}: the ${a.kind}'s spot can be walked to`);
    }
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++) assert.ok(dist(hs[i], hs[j]) >= 12, `jail ${n + 1}: ${hs[i].kind} and ${hs[j].kind} apart`);
  }
});

test("a squabble: the guard walks there by the route, calms it on its own, leaves the reward on the floor and goes back", () => {
  for (const level of [0, 1]) {
    const { w, g } = jail({ rank: 2, level });
    const f = lv(w).fights;
    step(w, LEVELS, STILL);
    const al = w.alert;
    assert.equal(al?.kind, "squabble");
    assert.ok(dist(g, al) > ALERT_R, "it starts out of reach");
    const walk = pathLen(g, route(w, lv(w), g, al)) / HELPER_SPEED;
    const coins = w.coins, settled = w.settled;
    const n = track(w, () => w.alert === null, walk + f.settle + 2, "the squabble calmed", (h) => {
      if (w.alert && dist(h, w.alert) > ALERT_R) assert.equal(w.alert.held, 0, "nothing held while nobody is in reach");
    });
    assert.ok(n * DT <= walk + f.settle + 0.2, `calmed in ${n * DT}s, the walk is ${walk}s`);
    assert.equal(w.settled, settled + 1);
    assert.equal(reward(w), f.reward, "the reward is on the floor, under the guard");
    assert.equal(w.coins, coins, "and none of it in the wallet");
    step(w, LEVELS, STILL);
    assert.ok(dist(goal(g), lv(w).helperHome) <= 40, "back to stand with the others");
    wait(w, 10);
    assert.ok(!g.moving && dist(g, lv(w).helperHome) <= 40);
    assert.equal(reward(w), f.reward, "the guard picked none of it up on the way");
    assert.equal(w.settled, settled + 1);
  }
});

test("a riot: the guard gets there in the warning, nothing is held until it is on, then its hold calms it once", () => {
  for (const level of [0, 1]) {
    const { w } = jail({ level });
    const R = lv(w).riot;
    step(w, LEVELS, STILL);
    assert.equal(w.alert?.kind, "riot");
    assert.ok(w.alert.warn > 0);
    let early = false, active = 0;
    const settled = w.settled;
    track(w, () => w.alert === null, R.warn + R.hold + 2, "the riot calmed", (h) => {
      if (!w.alert) return;
      if (w.alert.warn > 0) {
        assert.equal(w.alert.held, 0, "nothing held while they gather, guard there or not");
        if (dist(h, w.alert) <= ALERT_R) early = true;
      } else active++;
    });
    assert.ok(early, "it was in reach before the warning ran out");
    // the step it went on, then the hold, then the step that ended it
    assert.ok(Math.abs(active + 1 - (1 + R.hold / DT)) <= 1, `calmed ${active} steps after it went on`);
    assert.equal(w.settled, settled + 1);
    assert.equal(reward(w), lv(w).fights.reward, "paid once, on the floor");
    assert.equal(w.coins, 0);
  }
});

test("player, guard, or both: one hold, the same number of steps, never halved", () => {
  // a riot: the guard already at the anchor while they gather
  const { w } = jail();
  const R = lv(w).riot;
  step(w, LEVELS, STILL);
  until(w, () => dist(calmers(w)[0], w.alert) <= ALERT_R, R.warn, "the guard at the anchor in the warning");
  const base = clone(w);
  const guard = clone(base);
  const both = clone(base);
  Object.assign(player(both), { x: R.at.x, y: R.at.y + 20 });
  const alone = clone(base);
  alone.agents = alone.agents.filter((a) => a.kind !== "calmer");
  Object.assign(player(alone), { x: R.at.x, y: R.at.y + 20 });
  const riot = [guard, both, alone].map((x) => holdSteps(x, R.warn + R.hold + 1));
  const want = Math.ceil((R.hold - 1e-9) / DT);
  assert.deepEqual(riot, [want, want, want], "riot: guard, both, player");

  // a squabble: from the step the guard walks into reach, the guard, the player as well, or the player alone
  const s = jail({ rank: 2 }).w;
  step(s, LEVELS, STILL);
  const at = { x: s.alert.x, y: s.alert.y + 20 };
  until(s, () => dist(calmers(s)[0], s.alert) <= ALERT_R, 20, "the guard in reach of the squabble");
  assert.ok(s.alert.held <= DT + 1e-12, "the hold has only just begun");
  const sbase = clone(s);
  const sguard = clone(sbase);
  const sboth = clone(sbase);
  Object.assign(player(sboth), at);
  const salone = clone(sbase);
  salone.agents = salone.agents.filter((a) => a.kind !== "calmer");
  Object.assign(player(salone), at);
  const squabble = [sguard, sboth, salone].map((x) => holdSteps(x, 20));
  assert.equal(new Set(squabble).size, 1, `squabble: guard, both, player ${squabble}`);
  // what was held before the branch, plus the steps after it, is the one hold
  const total = squabble[0] + Math.round(s.alert.held / DT);
  assert.ok(Math.abs(total - lv(s).fights.settle / DT) <= 1, `${total} steps for a ${lv(s).fights.settle}s hold`);
});

test("an interrupted hold: a riot starts over when the guard is pulled out, a squabble keeps what it had", () => {
  const { w } = jail();
  const R = lv(w).riot;
  step(w, LEVELS, STILL);
  until(w, () => w.alert.warn === 0 && w.alert.held >= 1, R.warn + 2, "the guard holding an active riot");
  const g = calmers(w)[0];
  Object.assign(g, { x: FAR.x, y: FAR.y, path: [] });
  step(w, LEVELS, STILL);
  assert.equal(w.alert.held, 0, "nobody in reach: the riot hold starts over");
  const settled = w.settled;
  track(w, () => w.alert === null, 20, "the guard back and the riot calmed");
  assert.equal(w.settled, settled + 1);
  assert.equal(reward(w), lv(w).fights.reward, "paid once");

  const s = jail({ rank: 2 }).w;
  step(s, LEVELS, STILL);
  until(s, () => s.alert.held >= 0.5, 20, "the guard holding the squabble");
  const held = s.alert.held, h = calmers(s)[0];
  Object.assign(h, { x: FAR.x, y: FAR.y, path: [] });
  step(s, LEVELS, STILL);
  assert.equal(s.alert.held, held, "a squabble's hold neither runs nor resets with nobody in reach");
  until(s, () => s.alert === null, 20, "the guard back and the squabble calmed");
  assert.equal(reward(s), lv(s).fights.reward);
});

test("with no guard bought the player alone still calms both, and a riot's hold starts over when the player steps away", () => {
  const { w } = jail({ guard: false });
  const R = lv(w).riot;
  assert.ok(!w.bought.includes("riotguard") && !w.bought.includes("hospital"), "nothing paid for");
  step(w, LEVELS, STILL);
  wait(w, R.warn + 0.1);
  const p = player(w);
  Object.assign(p, { x: R.at.x, y: R.at.y + 20 });
  wait(w, 1);
  Object.assign(p, PARK);
  step(w, LEVELS, STILL);
  assert.equal(w.alert.held, 0);
  Object.assign(p, { x: R.at.x, y: R.at.y + 20 });
  until(w, () => w.alert === null, R.hold + 1, "the player calmed the riot");
  assert.equal(w.settled, 1);

  const s = jail({ rank: 2, guard: false }).w;
  step(s, LEVELS, STILL);
  Object.assign(player(s), { x: s.alert.x, y: s.alert.y + 20 });
  until(s, () => s.alert === null, lv(s).fights.settle + 1, "the player calmed the squabble");
  assert.equal(s.settled, 1);
});

test("a riot warning called off: no reward, and the guard goes back to stand with the others and stays", () => {
  const { w, g } = jail();
  const R = lv(w).riot;
  step(w, LEVELS, STILL);
  wait(w, 1);
  assert.ok(dist(goal(g), R.at) < 1, "on its way to the anchor");
  // most of the crowd taken by the player's line: too few left when the warning ends
  for (const id of w.alert.ids.slice(0, -1)) Object.assign(w.agents.find((a) => a.id === id), { state: "follow", leader: 1 });
  const settled = w.settled;
  until(w, () => w.alert === null, R.warn + 0.5, "the warning called off");
  assert.equal(w.settled, settled);
  assert.equal(reward(w), 0);
  step(w, LEVELS, STILL);
  assert.ok(dist(goal(g), lv(w).helperHome) <= 40, "heading back");
  wait(w, 12);
  assert.ok(!g.moving && dist(g, lv(w).helperHome) <= 40, "home");
  wait(w, 10);
  assert.ok(!g.moving, "no job left to go back to");
  assert.equal(reward(w), 0);
});

test("restore or travel mid-walk and after: one guard, the goal worked out again, the reward paid once", () => {
  const { w } = jail();
  const R = lv(w).riot;
  step(w, LEVELS, STILL);
  wait(w, 1);
  assert.ok(dist(calmers(w)[0], R.at) > ALERT_R, "still on its way");
  const raw = JSON.stringify(w);
  for (const back of [restore(raw, LEVELS), worldOf(LEVELS, "jail1", JSON.parse(raw), 1, ["jail1", "jail2"])]) {
    assert.equal(calmers(back).length, 1, "the one guard, no second spawned");
    assert.equal(calmers(back)[0].id, calmers(w)[0].id);
    step(back, LEVELS, STILL);
    assert.ok(dist(goal(calmers(back)[0]), R.at) < 1, "still heading for the anchor");
    const settled = back.settled;
    track(back, () => back.alert === null, R.warn + R.hold + 2, "the riot calmed after the reload");
    assert.equal(back.settled, settled + 1);
    assert.equal(reward(back), lv(back).fights.reward);
    // and again, once it is over
    const again = restore(JSON.stringify(back), LEVELS);
    assert.equal(calmers(again).length, 1);
    assert.equal(again.alert, null);
    step(again, LEVELS, STILL);
    assert.ok(dist(goal(calmers(again)[0]), lv(again).helperHome) <= 40, "home, not back to an old incident");
    wait(again, 10);
    assert.equal(again.settled, settled + 1, "never settled twice");
    assert.equal(reward(again), lv(again).fights.reward, "never paid twice");
  }
  // another jail is its own world: no guard there until its own pad is bought
  const other = worldOf(LEVELS, "jail2", undefined, 1, ["jail1", "jail2"]);
  assert.equal(calmers(other).length, 0);
});

test("the guard leads nobody, takes no pile, cleans nothing, picks up no coin, pays no pad and starts nothing", () => {
  const { w, g } = jail({ rank: 2, unrest: [0.1, 0.1, 0.1, 0.1] });
  w.fightIn = 1e9;
  const desk = station(w, "desk");
  const spot = desk.pileAt;
  w.piles.desk = 9;
  const base = residents(w)[0];
  const newcomer = { ...structuredClone(base), id: w.nextId++, state: "ready", house: "", slot: 0, x: spot.x + 4, y: spot.y, path: [] };
  w.agents.push(newcomer);
  w.messes.push({ id: w.nextId++, kind: "puddle", x: spot.x, y: spot.y + 4, station: "showers", seat: 0, clean: 0 });
  w.floor.push({ x: spot.x - 4, y: spot.y, house: "" });
  const coins = w.coins;
  for (let i = 0; i < 2 / DT; i++) {
    Object.assign(g, { x: spot.x, y: spot.y, path: [] });
    step(w, LEVELS, STILL);
  }
  assert.equal(w.piles.desk, 9, "the pile is still there");
  assert.equal(g.cash, 0);
  assert.equal(g.carry, 0);
  assert.equal(newcomer.state, "ready", "nobody led");
  assert.ok(!w.agents.some((a) => a.leader === g.id), "nobody in its line");
  assert.equal(w.messes.length, 1, "the mess is still there");
  assert.equal(reward(w), 1, "the coin is still on the floor");
  assert.equal(w.coins, coins);
  // on a pad with money in the wallet: the pad takes nothing
  const cell = pad(w, "cell3");
  w.coins = 100;
  for (let i = 0; i < 2 / DT; i++) {
    Object.assign(g, { x: cell.at.x, y: cell.at.y, path: [] });
    step(w, LEVELS, STILL);
  }
  assert.equal(w.paid.cell3 ?? 0, 0);
  assert.equal(w.coins, 100);
  assert.equal(w.alert, null, "no incident from the guard");
});

test("escorts, the collector and the rest work step for step the same with a riot guard about", () => {
  const helper = (w, kind) => ({
    id: w.nextId++, kind, x: lv(w).helperHome.x, y: lv(w).helperHome.y, face: 1, moving: false, walk: 0, look: 0, tags: [], state: "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1, needs: {}, unrest: 0, served: 0, hurt: 0, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
  });
  const busy = (guard) => {
    const w = create(LEVELS, 0, 7);
    Object.assign(w, { rank: 6, fightIn: 1e9 });
    w.boost.t = 1e9;
    w.bought.push("cell3", "cell4", "guard", "guard2", "collector", "cook", "clerk", "cleaner", "hospital", "riotguard");
    for (const kind of ["escort", "escort", "collector", "carrier", "clerk", "cleaner"]) w.agents.push(helper(w, kind));
    // the same ids either way, so a mess made later has the same id in both
    if (guard) w.agents.push(helper(w, "calmer"));
    else w.nextId++;
    Object.assign(player(w), PARK);
    return w;
  };
  const a = busy(true), b = busy(false);
  const others = (w) => JSON.stringify({ ...w, agents: w.agents.filter((x) => x.kind !== "calmer") });
  const saw = { led: false, cash: false };
  for (let i = 0; i < 240 / DT; i++) {
    step(a, LEVELS, STILL);
    step(b, LEVELS, STILL);
    if (a.agents.some((x) => x.state === "follow" && a.agents.find((e) => e.id === x.leader)?.kind === "escort")) saw.led = true;
    if (a.agents.some((x) => x.kind === "collector" && x.cash > 0)) saw.cash = true;
    if (i % 30 === 0) assert.equal(others(a), others(b), `the same at step ${i}`);
  }
  assert.equal(others(a), others(b));
  assert.deepEqual(saw, { led: true, cash: true }, "escorts led and the collector carried, so the run means something");
  assert.ok(a.released > 0);
});

// the look: a helmet, a small shield and a whistle, from the parts every character is made of
const pose = (over) => ({ kind: "calmer", action: "stand", walk: 0, t: 0, look: 0, uniform: false, carry: 0, mood: "ok", ...over });
function parts(p) {
  const out = [];
  model.pose(p, (part, x, y, z, pitch, yaw, roll, sx, sy, sz, colour) => out.push({ part, x, y, z, pitch, yaw, roll, sx, sy, sz, colour }));
  return out;
}
const hex = (s) => parseInt(s.slice(1), 16);

test("the riot guard's look: a helmet, a small shield in one hand, a whistle on its chest, in the parts set aside", () => {
  for (const action of ["stand", "walk", "sit", "eat", "sleep", "clean", "fight", "wash"]) {
    const counts = {};
    for (const { part } of parts(pose({ action, walk: 7, t: 1.3 }))) counts[part] = (counts[part] ?? 0) + 1;
    for (const [part, n] of Object.entries(counts)) assert.ok(n <= model.perCharacter[part], `${action}: ${n} ${part}`);
  }
  for (const walk of [0, 6, 13]) {
    const all = parts(pose({ action: "walk", walk }));
    const head = all.find((q) => q.part === "head"), body = all.find((q) => q.part === "body");
    assert.deepEqual(all.filter((q) => q.part === "dot" && dist3(q, head) < 6), [], "a blank face");
    const helmet = all.filter((q) => q.part === "hat" && q.colour === hex("#f4f6fa"));
    assert.equal(helmet.length, 2, "a crown and a rim");
    for (const h of helmet) assert.ok(h.y > head.y && h.sx >= 5, "over the top of the head, wider than it");
    const shield = all.filter((q) => q.colour === hex("#8fd0f2"));
    assert.equal(shield.length, 1, "one shield");
    assert.ok(shield[0].sz < shield[0].sx / 2, "flat");
    const hands = all.filter((q) => q.part === "dot" && q.sx === q.sy && q.sx === q.sz && q.sx > 1.5);
    assert.equal(hands.length, 2);
    assert.ok(Math.min(...hands.map((h) => dist3(h, shield[0]))) < 3, "held in a hand");
    const whistle = all.filter((q) => q.colour === hex("#ff5a5f"));
    assert.equal(whistle.length, 1, "one whistle");
    assert.ok(whistle[0].y < head.y && whistle[0].y > body.y && whistle[0].z > 0, "on the front of its chest");
  }
  const bodyOf = (kind) => parts(pose({ kind })).find((q) => q.part === "body").colour;
  const others = ["player", "escort", "carrier", "clerk", "cleaner", "collector"].map(bodyOf);
  assert.ok(!others.includes(bodyOf("calmer")), "a colour of its own");
});
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("the hint says the riot guard is on it only while one is really here, for a squabble and all through a riot", () => {
  // no guard: the old words
  const none = jail({ rank: 2, unrest: [0.9, 0.9, 0.9, 0.9], guard: false }).w;
  step(none, LEVELS, STILL);
  assert.equal(none.alert?.kind, "squabble");
  assert.equal(hint(none, lv(none)).key, "alert");
  // the pad bought but no guard standing in the jail (as a hand-made save might have it): the old words too
  const bare = jail({ rank: 2, guard: false }).w;
  bare.bought.push("hospital", "riotguard");
  step(bare, LEVELS, STILL);
  assert.equal(hint(bare, lv(bare)).key, "alert");
  // a guard here: a squabble, then a riot in its warning and once it is on
  const sq = jail({ rank: 2 }).w;
  step(sq, LEVELS, STILL);
  assert.equal(sq.alert?.kind, "squabble");
  assert.equal(hint(sq, lv(sq)).key, "guarded");
  const { w } = jail();
  step(w, LEVELS, STILL);
  assert.equal(w.alert?.kind, "riot");
  assert.ok(w.alert.warn > 0);
  assert.equal(hint(w, lv(w)).key, "guarded");
  track(w, () => w.alert?.warn === 0, 8, "the riot on");
  if (w.alert) assert.equal(hint(w, lv(w)).key, "guarded");
  // nothing going on: not a word about it
  track(w, () => w.alert === null, 20, "calmed");
  assert.notEqual(hint(w, lv(w)).key, "guarded");
  assert.equal(hintText({ key: "guarded" }, "birds"), "your riot guard is on the way to calm it down");
});
