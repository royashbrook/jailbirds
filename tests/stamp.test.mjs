import { test } from "node:test";
import assert from "node:assert/strict";
import {
  create, step, player, restore, stamped, stampAt, stampSpot, AGENT_SPEED, DT, STAMP_AT, STAMP_HOLD,
} from "../src/engine/sim.ts";
import { cues, snap } from "../src/engine/cues.ts";
import { stampPose, stampTime, STAMP_UP } from "../src/view/view.ts";
import { LEVELS } from "../src/content/jail.ts";

// the way out at the release desk: set free, paid and starred at once, as before. then each one
// walks up to the desk, stands while the big stamp comes down on their papers (a thunk), and walks
// out the way everyone goes. the stamp is the way out, never a second payout
const L = LEVELS[0];
const desk = L.stations.find((s) => s.id === "stamp");
const STILL = { x: 0, y: 0 };
const HOLD_STEPS = Math.round(STAMP_HOLD / DT);
const STEP = AGENT_SPEED * DT + 1e-6;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** someone who has served their time, in the warden's line behind him */
function done(w, leader, k) {
  const b = {
    id: w.nextId++, kind: "agent", x: leader.x - 30 - k * 18, y: leader.y, face: 1, moving: false, walk: 0, look: 0, tags: ["uniform"],
    state: "follow", leader: leader.id, house: "c0", slot: k, station: "", seat: -1, needs: Object.fromEntries(L.needs.map((n) => [n.id, 1])),
    served: L.serve, rest: 0, t: k, carry: 0, cash: 0, path: [], trail: [],
  };
  w.agents.push(b);
  return b;
}
/** the warden standing at the release desk with `n` done in his line, nothing else going on */
function atDesk(n) {
  const w = create(LEVELS, 0, 7);
  w.ride.t = 9999;
  w.fightIn = 9999;
  w.boost.t = 9999;
  const p = player(w);
  p.x = desk.at.x;
  p.y = desk.at.y;
  const line = Array.from({ length: n }, (_, k) => done(w, p, k));
  return { w, line };
}
/** a screen listening every `every` steps, as App does each frame */
function ear(w, every = 1) {
  const e = { before: snap(w), n: 0, heard: [] };
  e.step = () => {
    step(w, LEVELS, STILL);
    if (++e.n % every) return;
    for (const c of cues(e.before, w, L)) e.heard.push({ ...c, at: w.steps });
    e.before = snap(w);
  };
  return e;
}
const thunks = (heard) => heard.filter((c) => c.kind === "stamp");
const sum = (list) => list.reduce((n, c) => n + c.n, 0);

/** watch one released person from now until gone: where they were at the end of each step */
function follow(w, b, each = () => {}) {
  const seen = [];
  for (let i = 0; i < 60 * 20 && w.agents.includes(b); i++) {
    each();
    seen.push({ x: b.x, y: b.y, state: b.state, t: b.t, moving: b.moving, gone: !w.agents.includes(b) });
  }
  assert.ok(!w.agents.includes(b), "gone in the end");
  return seen;
}

test("set free once at the desk, then up to the stamp, stood there for the stamp, and out the exit", () => {
  const { w, line } = atDesk(1);
  const [b] = line;
  const pile = w.piles.stamp ?? 0;
  step(w, LEVELS, STILL);
  // the release is at once, the same as ever
  assert.equal(w.released, 1);
  assert.equal(w.piles.stamp - pile, desk.pay, "paid once");
  assert.deepEqual([w.stars, w.rank], [1, 1], "one star");
  assert.equal(b.state, "stamp");
  assert.equal(b.leader, -1);
  assert.equal(b.house, "", "their bed is free now");
  const spot = stampSpot(L, desk, b.seat);
  assert.equal(spot.y, desk.at.y, "in front of the desk, where the warden stands");
  assert.ok(dist(spot, { x: stampAt(desk).x, y: desk.at.y }) < 1, "the first right by the stamp");
  assert.ok(dist(b, spot) > 10, "and they have a little way to walk to it");

  let prev = { x: b.x, y: b.y };
  const seen = follow(w, b, () => {
    step(w, LEVELS, STILL);
    assert.ok(dist(prev, b) <= STEP, `a walk, never a jump: ${dist(prev, b).toFixed(2)} in a step`);
    prev = { x: b.x, y: b.y };
  });
  // they get to the spot on foot, then stand on it for the stamp, then go
  const at = seen.findIndex((s) => dist(s, spot) < 1e-6);
  assert.ok(at > 5, "walked there over several steps");
  assert.ok(seen.slice(0, at).every((s) => s.state === "stamp" && s.moving), "walking up to the desk");
  const there = seen.filter((s) => dist(s, spot) < 1e-6);
  assert.equal(there.length, HOLD_STEPS, `stood there ${STAMP_HOLD}s`);
  assert.ok(there.every((s) => s.state === "stamp" || s === there[there.length - 1]), "in the stamp the whole time");
  assert.equal(there[there.length - 1].state, "leave", "and then off");
  const left = seen.slice(at + there.length);
  assert.ok(left.length > 30 && left.every((s) => s.state === "leave" && s.moving), "out on foot");
  // out the way everyone goes: through to the end of the exit, and only then gone
  const end = desk.exit[desk.exit.length - 1];
  assert.ok(dist(seen[seen.length - 1], end) < 1e-6, "gone from the end of the exit");
  // and nothing more paid, counted or starred for any of it
  assert.equal(w.released, 1);
  assert.equal(w.piles.stamp - pile, desk.pay, "still paid once");
  assert.deepEqual([w.stars, w.rank], [1, 1], "still one star");
});

test("two set free in one step: both paid once, each stamped with its own thunk, both out", () => {
  const { w, line } = atDesk(2);
  const e = ear(w);
  const pile = w.piles.stamp ?? 0;
  e.step();
  assert.equal(w.released, 2, "both on the same step");
  assert.equal(w.piles.stamp - pile, 2 * desk.pay);
  assert.equal(w.rank, 2, "two stars, one rank");
  assert.equal(thunks(e.heard).length, 0, "no stamp yet: they are only on their way to it");
  assert.deepEqual(line.map((b) => b.state), ["stamp", "stamp"]);
  assert.notEqual(line[0].seat, line[1].seat, "side by side, not on top of each other");

  // the step each one's stamp comes down, as the sim has it
  const when = new Map();
  for (let i = 0; i < 60 * 20 && line.some((b) => w.agents.includes(b)); i++) {
    e.step();
    for (const b of line) if (!when.has(b.id) && w.agents.includes(b) && stamped(b)) when.set(b.id, w.steps);
  }
  assert.ok(line.every((b) => !w.agents.includes(b)), "both gone out");
  assert.equal(when.size, 2, "both stamped");
  const heard = thunks(e.heard);
  assert.equal(sum(heard), 2, "a thunk each, none lost, none twice");
  const at = (step) => sum(heard.filter((c) => c.at === step));
  for (const [id, s] of when) assert.ok(at(s) >= 1, `${id}'s thunk the step the stamp came down`);
  assert.equal(w.released, 2);
  assert.equal(w.piles.stamp - pile, 2 * desk.pay, "still paid once each");
});

test("a slow screen looking in every quarter second still hears every stamp, once", () => {
  for (const every of [7, 15]) {
    const { w, line } = atDesk(3);
    const e = ear(w, every);
    for (let i = 0; i < 60 * 20 && line.some((b) => w.agents.includes(b)); i++) e.step();
    for (let i = 0; i < every; i++) e.step();
    assert.equal(w.released, 3);
    assert.equal(sum(thunks(e.heard)), 3, `every ${every} steps`);
  }
});

test("the thunk comes when the stamp comes down, not at the release", () => {
  const { w, line } = atDesk(1);
  const [b] = line;
  const e = ear(w);
  e.step();
  const freed = w.steps;
  assert.equal(w.released, 1);
  let down = -1;
  while (w.agents.includes(b)) {
    e.step();
    if (down < 0 && stamped(b)) down = w.steps;
  }
  const heard = thunks(e.heard);
  assert.deepEqual(heard.map((c) => [c.at, c.n]), [[down, 1]]);
  assert.ok(down - freed > STAMP_AT / DT, "a good moment after the release");
  // the bell for the release is still at the release
  assert.equal(e.heard.find((c) => c.kind === "release")?.at, freed);
});

test("a helper still sets people free on the desk's own clock, and they stamp and go out too", () => {
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
  player(w).x = 330;
  player(w).y = 540;
  const g = { ...structuredClone(player(w)), id: w.nextId++, kind: "escort", state: "idle", x: desk.at.x, y: desk.at.y, trail: [], path: [] };
  w.agents.push(g);
  const two = [done(w, g, 0), done(w, g, 1)];
  const out = [];
  let was = 0;
  for (let s = 1; s <= 120 && out.length < 2; s++) {
    step(w, LEVELS, STILL);
    if (w.released > was) (was = w.released), out.push(s);
  }
  assert.deepEqual(out, ticks(desk.every, 2), "one each `every`, exactly as before");
  assert.deepEqual(two.map((b) => b.state), ["stamp", "stamp"]);
  for (let i = 0; i < 60 * 20 && two.some((b) => w.agents.includes(b)); i++) step(w, LEVELS, STILL);
  assert.ok(two.every((b) => !w.agents.includes(b)), "both out");
  assert.equal(w.released, 2);
});

test("put away mid-stamp and opened again: the stamp picks up where it was, nothing paid again", () => {
  for (const [what, ready] of [
    ["on the way up to the desk", (b) => b.state === "stamp" && b.path.length > 0 && b.walk > 5],
    ["stood at the desk, the stamp still up", (b) => b.state === "stamp" && !b.path.length && b.t > 0.1],
    ["stamped, about to go", (b) => b.state === "stamp" && b.t > STAMP_AT + 0.1],
    ["on the way out", (b) => b.state === "leave" && b.walk > 60],
  ]) {
    const { w, line } = atDesk(1);
    const id = line[0].id;
    step(w, LEVELS, STILL);
    for (let i = 0; i < 600 && !ready(line[0]); i++) step(w, LEVELS, STILL);
    assert.ok(ready(line[0]), what);
    const back = restore(JSON.stringify(w), LEVELS);
    const b = back.agents.find((a) => a.id === id);
    assert.deepEqual({ x: b.x, y: b.y, state: b.state, t: b.t, path: b.path }, { x: line[0].x, y: line[0].y, state: line[0].state, t: line[0].t, path: line[0].path }, what);
    const was = { released: back.released, pile: back.piles.stamp, stars: back.stars, rank: back.rank, coins: back.coins };
    const thunk = stamped(b) ? 0 : 1;
    const e = ear(back);
    for (let i = 0; i < 60 * 20 && back.agents.includes(b); i++) e.step();
    assert.ok(!back.agents.includes(b), `${what}: out in the end`);
    assert.deepEqual({ released: back.released, pile: back.piles.stamp, stars: back.stars, rank: back.rank, coins: back.coins }, was, `${what}: nothing paid again`);
    assert.equal(sum(thunks(e.heard)), thunk, `${what}: stamped once in all`);
  }
});

test("an old save, from before the stamp, opens and plays: the one already leaving just goes", () => {
  const { w, line } = atDesk(1);
  const [b] = line;
  // as the game saved it then: set free straight onto the exit, no stamp
  Object.assign(b, { state: "leave", leader: -1, house: "", slot: -1, path: desk.exit.map((p) => ({ ...p })) });
  w.released = 1;
  const back = restore(JSON.stringify(w), LEVELS);
  assert.ok(back);
  const a = back.agents.find((x) => x.id === b.id);
  const e = ear(back);
  for (let i = 0; i < 60 * 20 && back.agents.includes(a); i++) e.step();
  assert.ok(!back.agents.includes(a), "out");
  assert.equal(back.released, 1);
  assert.equal(sum(thunks(e.heard)), 0, "no stamp for one who left before there was one");
  // and someone done in such a save still gets the stamp when set free
  const { w: v } = atDesk(1);
  const again = restore(JSON.stringify(v), LEVELS);
  step(again, LEVELS, STILL);
  assert.equal(again.released, 1);
  assert.equal(again.agents[1].state, "stamp");
});

test("the stamp drawn: on its pad, up and over, down just as the sim stamps, then back", () => {
  const pose = { over: 0, lift: 0, sheet: false, mark: false };
  assert.deepEqual({ ...stampPose(-1, pose) }, { over: 0, lift: 0, sheet: false, mark: false }, "nobody there: on the pad, no papers");
  assert.equal(stampPose(-1, pose), pose, "into the same object, nothing made");
  const at = (t) => ({ ...stampPose(t, pose) });
  assert.deepEqual(at(0), { over: 0, lift: 0, sheet: true, mark: false }, "their papers come out");
  const top = Math.max(...Array.from({ length: 24 }, (_, k) => at((k * STAMP_AT) / 24).lift));
  assert.ok(top > STAMP_UP * 0.9, "up high before it comes down");
  assert.ok(at(STAMP_AT - 2 * DT).lift > 2, "still up two steps before");
  assert.deepEqual(at(STAMP_AT), { over: 1, lift: 0, sheet: true, mark: true }, "down on the papers the moment the sim stamps, and the mark is there");
  assert.equal(at(STAMP_AT - DT).mark, false, "no mark before the stamp");
  assert.equal(at(STAMP_AT + 0.1).lift, 0, "held down a moment");
  const end = at(STAMP_HOLD);
  assert.ok(end.over === 0 && Math.abs(end.lift) < 1e-9 && end.mark, "back on the pad as they go");

  // whose stamp: one just come down and still pressed, else the next one due to come down, else
  // the last one stamped, else nobody
  const w = { agents: [
    { state: "stamp", station: "stamp", path: [], t: 0.1 },
    { state: "stamp", station: "stamp", path: [], t: 0.3 },
    { state: "stamp", station: "stamp", path: [{ x: 0, y: 0 }], t: 0 },
    { state: "stamp", station: "stamp", path: [], t: 0.7 },
    { state: "stamp", station: "stamp", path: [], t: 0.6 },
    { state: "stamp", station: "stamp", path: [], t: STAMP_AT + 0.05 },
  ] };
  assert.equal(stampTime(w, "stamp"), STAMP_AT + 0.05, "a landing holds the picture for its press");
  assert.equal(stampTime({ agents: w.agents.slice(0, 5) }, "stamp"), 0.3, "then the next one due");
  assert.equal(stampTime({ agents: w.agents.slice(2, 5) }, "stamp"), 0.6, "then the last one stamped");
  assert.equal(stampTime({ agents: w.agents.slice(2, 3) }, "stamp"), -1, "still walking up is nobody there yet");
  assert.equal(stampTime(w, "elsewhere"), -1);
});

test("two who reach the desk close together: every thunk lands with the drawn stamp down on marked papers", () => {
  // the second one stands at the desk before the first one's stamp has come down. whatever the gap,
  // the stamp drawn at each thunk is the one coming down, never the next one still going up
  let overlapped = 0;
  for (const behind of [[722, 740], [722, 730], [710, 760], [740, 722], [722, 790]]) {
    const w = create(LEVELS, 0, 7);
    w.ride.t = w.fightIn = w.boost.t = 9999;
    const p = player(w);
    Object.assign(p, { x: desk.at.x, y: desk.at.y });
    const two = behind.map((y, k) => Object.assign(done(w, p, k), { x: desk.at.x, y }));
    const e = ear(w);
    const arrived = new Map();
    for (let i = 0; i < 60 * 10 && two.some((b) => w.agents.includes(b)); i++) {
      const heard = e.heard.length;
      e.step();
      for (const b of two) if (!arrived.has(b.id) && b.state === "stamp" && !b.path.length) arrived.set(b.id, w.steps);
      const now = thunks(e.heard.slice(heard));
      if (!now.length) continue;
      const pose = { ...stampPose(stampTime(w, desk.id), { over: 0, lift: 0, sheet: false, mark: false }) };
      assert.ok(pose.over === 1 && Math.abs(pose.lift) < 1e-9 && pose.mark, `${behind}: step ${w.steps}, the thunk drawn as ${JSON.stringify(pose)}`);
    }
    assert.equal(sum(thunks(e.heard)), 2, `${behind}: two thunks`);
    const [a, b] = [...arrived.values()];
    if (Math.abs(a - b) > 0 && Math.abs(a - b) < STAMP_AT / DT) overlapped++;
  }
  assert.ok(overlapped >= 2, `the gaps really are shorter than the stamp's way down (${overlapped})`);
});

test("a full line and every guard at the desk at once: each stands in a place of their own and holds there", () => {
  const w = create(LEVELS, 0, 7);
  w.ride.t = w.fightIn = w.boost.t = 9999;
  w.rank = 6;
  w.bought.push("line1", "line2", "line3", "cell3", "guard", "guard2", "guard3");
  w.lineMax = 5;
  const p = player(w);
  Object.assign(p, { x: desk.at.x, y: desk.at.y });
  const freed = [];
  [{ x: 570, y: 704 }, { x: 580, y: 720 }, { x: 590, y: 740 }, { x: 610, y: 760 }, { x: 600, y: 740 }].forEach((at, k) => freed.push(Object.assign(done(w, p, k), at)));
  for (let g = 0; g < 3; g++) {
    const guard = { ...structuredClone(p), id: w.nextId++, kind: "escort", state: "idle", x: desk.at.x - 10 + g * 10, y: desk.at.y, trail: [], path: [] };
    w.agents.push(guard);
    for (let k = 0; k < 2; k++) freed.push(done(w, guard, k));
  }
  const room = L.rooms.find((r) => r.id === "release").rect;
  const held = new Map();
  let most = 0;
  for (let i = 0; i < 60 * 30 && freed.some((b) => w.agents.includes(b)); i++) {
    step(w, LEVELS, STILL);
    const going = w.agents.filter((a) => a.state === "stamp");
    most = Math.max(most, going.length);
    // where each is standing, or headed to stand
    const spots = going.map((a) => (a.path.length ? a.path[a.path.length - 1] : { x: a.x, y: a.y }));
    for (let x = 0; x < spots.length; x++)
      for (let y = x + 1; y < spots.length; y++)
        assert.ok(dist(spots[x], spots[y]) >= 12, `step ${w.steps}: ${going[x].id} and ${going[y].id} both at ${JSON.stringify(spots[x])}`);
    for (const s of spots) {
      assert.ok(s.x > room.x + 10 && s.x < room.x + room.w - 10 && s.y > room.y + 10 && s.y < room.y + room.h - 10, `inside the release room: ${JSON.stringify(s)}`);
      const pr = desk.prop;
      assert.ok(!(s.x > pr.x - 10 && s.x < pr.x + pr.w + 10 && s.y > pr.y - 10 && s.y < pr.y + pr.h + 10), `not in the desk: ${JSON.stringify(s)}`);
    }
    for (const a of going) if (!a.path.length) held.set(a.id, (held.get(a.id) ?? 0) + 1);
  }
  assert.ok(freed.every((b) => !w.agents.includes(b)), "all out in the end");
  assert.equal(w.released, freed.length, "each set free once");
  assert.ok(most >= 6, `a real crowd at the desk at once (${most})`);
  for (const b of freed) assert.equal(held.get(b.id), HOLD_STEPS - 1, `${b.id} held at their own place for the stamp`);
});
