import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create, step, player, restore, DT, padVisible, route, isOpen } from '../src/engine/sim.ts';
import { walls, dist } from '../src/engine/geom.ts';
import { LEVELS } from '../src/content/jail.ts';

const still = { x: 0, y: 0 };
const ids = ['staff2', 'staff3', 'cookcarry2', 'cookcarry3'];
const kinds = ['escort', 'carrier', 'cleaner', 'clerk', 'collector', 'calmer'];
const old = JSON.parse(readFileSync(new URL('./fixtures/v0.1.155-maxed-pine-hill.json', import.meta.url)));
const sample = old.agents.find(a => a.kind === 'agent');
const wait = (w, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) step(w, LEVELS, still); };
function quiet(level, bought = []) {
  const w = create(LEVELS, level, 37);
  w.ride.t = w.fightIn = w.boost.t = 1e9;
  w.rank = 10;
  w.bought = [...LEVELS[level].pads.filter(p => !ids.includes(p.id)).map(p => p.id), ...bought];
  return w;
}
function helper(w, kind, at = { x: 800, y: 700 }) {
  const h = { ...structuredClone(player(w)), ...at, id: w.nextId++, kind, state: 'idle', carry: 0, cash: 0, path: [], trail: [] };
  w.agents.push(h);
  return h;
}
function resident(w, changes = {}) {
  const a = { ...structuredClone(sample), id: w.nextId++, kind: 'agent', house: 'c0', slot: 0, served: 0, hurt: 0,
    rest: 0, t: 0, needs: { food: 1, wash: 1, toilet: 1 }, unrest: 0, path: [], trail: [], ...changes };
  w.agents.push(a);
  return a;
}
const walking = [[[], 85], [['staff2'], 100], [['staff2', 'staff3'], 115]];
const carrying = [[[], 4], [['cookcarry2'], 5], [['cookcarry2', 'cookcarry3'], 6]];

for (let level = 0; level < 2; level++) {
  const l = LEVELS[level];
  test(`jail${level + 1}: four staff purchases have the ratified gates, effects and prices`, () => {
    const pads = ids.map(id => l.pads.find(p => p.id === id));
    assert.ok(pads.every(Boolean), 'all four training purchases exist');
    assert.deepEqual(pads.map(p => p.cost), [120, 220, 120, 220].map(n => n * (level + 1)));
    assert.deepEqual(pads.map(p => p.rank), [5, 8, 5, 8]);
    assert.deepEqual(pads.map(p => p.after), ['guard', 'staff2', 'cook', 'cookcarry2']);
    assert.deepEqual(pads.map(p => p.unlock), [{ helperSpeed: 100 }, { helperSpeed: 115 }, { helperCarry: 5 }, { helperCarry: 6 }]);
    assert.deepEqual(pads.map(p => p.at), [{ x: 850, y: 700 }, { x: 850, y: 700 }, { x: 850, y: 765 }, { x: 850, y: 765 }]);
    assert.ok(pads.every(p => p.label.length <= l.pads.find(p => p.id === 'riotguard').label.length));
    const w = quiet(level); w.bought = [];
    assert.equal(padVisible(w, pads[0]), false);
    assert.equal(padVisible(w, pads[2]), false);
    w.bought = ['guard', 'cook'];
    assert.equal(padVisible(w, pads[0]), true);
    assert.equal(padVisible(w, pads[1]), false);
    assert.equal(padVisible(w, pads[2]), true);
  });

  for (const [bought, speed] of walking) {
    for (const kind of kinds) test(`jail${level + 1}: ${kind} really walks at ${speed}`, () => {
      const w = quiet(level, bought), h = helper(w, kind), from = { x: h.x, y: h.y };
      step(w, LEVELS, still);
      assert.ok(Math.abs(dist(from, h) / DT - speed) < 1e-7, 'measure actual fixed-step travel, not a selected value');
    });
    test(`jail${level + 1}: an escort follower catches up with its ${speed} leader`, () => {
      const w = quiet(level, bought), h = helper(w, 'escort');
      h.trail = [{ x: 800, y: 650 }];
      const a = resident(w, { x: 800, y: 760, state: 'follow', leader: h.id }), from = { x: a.x, y: a.y };
      step(w, LEVELS, still);
      assert.equal(a.state, 'follow');
      assert.ok(Math.abs(dist(from, a) / DT - speed * 1.15) < 1e-7);
    });
    test(`jail${level + 1}: staff ${speed} leaves player and unescorted resident speeds alone`, () => {
      const w = quiet(level, bought), p = player(w);
      Object.assign(p, { x: 800, y: 700 });
      const a = resident(w, { x: 800, y: 760, state: 'back', leader: -1, path: [{ x: 800, y: 600 }] });
      const from = { x: a.x, y: a.y };
      step(w, LEVELS, { x: 1, y: 0 });
      assert.ok(Math.abs((p.x - 800) / DT - l.speed) < 1e-7);
      assert.ok(Math.abs(dist(from, a) / DT - 80) < 1e-7);
    });
  }

  for (const [bought, capacity] of carrying) test(`jail${level + 1}: cook fills to ${capacity}, then actually leaves the stove`, () => {
    const w = quiet(level, bought), stove = l.stations.find(s => s.id === 'stove');
    const h = helper(w, 'carrier', stove.at);
    let left = false;
    for (let i = 0; i < 360; i++) {
      step(w, LEVELS, still);
      if (dist(h, stove.at) > 0.001) {
        assert.equal(h.carry, capacity, 'departure and fill limit must use the same purchased capacity');
        left = true; break;
      }
    }
    assert.equal(left, true, 'the cook must not stay forever trying to fill beyond its real limit');
  });

  test(`jail${level + 1}: cook carry training does not enlarge the player stack or a collector's cash`, () => {
    const w = quiet(level, ['cookcarry2', 'cookcarry3']), stove = l.stations.find(s => s.id === 'stove');
    Object.assign(player(w), stove.at); wait(w, 2);
    assert.equal(player(w).carry, l.carry);
    assert.equal(w.carryMax, l.carry);
    const c = helper(w, 'collector', l.stations.find(s => s.kind === 'checkin').pileAt);
    w.piles[l.stations.find(s => s.kind === 'checkin').id] = 50;
    step(w, LEVELS, still);
    assert.equal(c.cash, 50);
    assert.equal(c.carry, 0);
  });

  test(`jail${level + 1}: staff purchases take real money once, survive reload and keep the player unchanged`, () => {
    for (const id of ids) {
      const p = l.pads.find(p => p.id === id);
      assert.ok(p, id);
      const w = quiet(level); w.coins = 1; w.paid[id] = p.cost - 1;
      if (!w.bought.includes(p.after)) w.bought.push(p.after);
      const before = [w.speed, w.carryMax, w.lineMax];
      const back = restore(JSON.stringify(w), LEVELS);
      Object.assign(player(back), p.at); wait(back, 1);
      assert.equal(back.coins, 0); assert.equal(back.paid[id], p.cost);
      assert.ok(back.bought.includes(id));
      assert.deepEqual([back.speed, back.carryMax, back.lineMax], before);
      const loaded = restore(JSON.stringify(back), LEVELS);
      assert.ok(loaded.bought.includes(id));
      assert.equal(Object.hasOwn(loaded, 'helperSpeed'), false);
      assert.equal(Object.hasOwn(loaded, 'helperCarry'), false);
      const next = l.pads.find(p => p.after === id);
      if (next) assert.equal(loaded.bought.includes(next.id), false);
      if (p.unlock.helperSpeed) {
        const h = helper(loaded, 'escort'), from = { x: h.x, y: h.y };
        step(loaded, LEVELS, still);
        assert.ok(Math.abs(dist(from, h) / DT - p.unlock.helperSpeed) < 1e-7, 'paid and restored speed really moves a helper');
      } else {
        const stove = l.stations.find(s => s.id === 'stove'), h = helper(loaded, 'carrier', stove.at);
        let left = false;
        for (let i = 0; i < 360; i++) {
          step(loaded, LEVELS, still);
          if (dist(h, stove.at) > .001) { assert.equal(h.carry, p.unlock.helperCarry); left = true; break; }
        }
        assert.equal(left, true, 'paid and restored cook capacity really fills and departs');
      }
    }
  });

  test(`jail${level + 1}: each training centre is reached through real actor walls`, () => {
    for (const onlyPrerequisites of [false, true]) for (const id of ['staff2', 'cookcarry2']) {
      const target = l.pads.find(p => p.id === id); assert.ok(target, id);
      const w = quiet(level);
      if (onlyPrerequisites) w.bought = ['guard', 'cook'];
      const p = player(w), path = route(w, l, p, target.at);
      const solid = walls(l, room => isOpen(w, room.locked));
      for (let i = 0; i < 3600 && path.length; i++) {
        while (path.length && dist(p, path[0]) < .1) path.shift();
        if (!path.length) break;
        const t = path[0], d = Math.max(dist(p, t), w.speed * DT);
        step(w, LEVELS, { x: (t.x - p.x) / d, y: (t.y - p.y) / d });
        for (const r of solid) assert.ok(Math.hypot(p.x - Math.max(r.x, Math.min(p.x, r.x + r.w)), p.y - Math.max(r.y, Math.min(p.y, r.y + r.h))) >= 10 - 1e-6);
      }
      assert.ok(dist(p, target.at) < .1, id);
    }
  });
}

test('the captured pre-training save keeps its money, purchases and capabilities', () => {
  const back = restore(JSON.stringify(old), LEVELS);
  assert.equal(back.coins, old.coins);
  assert.deepEqual(back.bought, old.bought);
  assert.deepEqual(back.paid, old.paid);
  assert.deepEqual([back.speed, back.carryMax, back.lineMax], [old.speed, old.carryMax, old.lineMax]);
});
