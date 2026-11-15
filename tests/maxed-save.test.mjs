import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restore, step } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';

// Emitted by the 0.1.155 engine after real routed purchases with a controlled setup budget.
// These are reproducible running-world captures, not saves supplied by a player.
const total = w => w.coins + Object.values(w.piles).reduce((a, b) => a + b, 0)
  + w.floor.length + w.agents.reduce((n, a) => n + a.cash, 0);
const progress = w => w.agents.map(a => ({ id: a.id, kind: a.kind, state: a.state,
  house: a.house, slot: a.slot, served: a.served, hurt: a.hurt, station: a.station, seat: a.seat }));

for (const name of ['pine-hill', 'desert-rock']) test(`0.1.155 maxed ${name} keeps money, purchases and occupied jobs on reload`, () => {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/v0.1.155-maxed-${name}.json`, import.meta.url), 'utf8'));
  const safe = raw.piles.safe + raw.agents.reduce((n, a) => n + a.cash, 0);
  assert.ok(raw.agents.some(a => a.kind === 'collector' && a.cash > 0), 'the capture exercises carried cash');
  assert.equal(raw.agents.filter(a => a.kind === 'escort').length, 3);
  assert.ok(raw.agents.filter(a => a.kind === 'agent').length >= 14);
  assert.ok(raw.agents.some(a => a.state === 'use'));
  if (name === 'pine-hill') assert.ok(raw.agents.some(a => a.state === 'stamp'));
  else assert.equal(raw.alert.kind, 'squabble');
  let w = raw;
  for (let i = 0; i < 4; i++) {
    w = restore(JSON.stringify(w), LEVELS);
    assert.equal(total(w), total(raw));
    assert.equal(w.coins, raw.coins);
    assert.equal(w.piles.safe, safe, 'carried cash is deposited once, not minted or lost');
    assert.ok(w.agents.every(a => a.cash === 0));
    assert.deepEqual(w.bought, raw.bought);
    assert.deepEqual(w.paid, raw.paid);
    assert.deepEqual(progress(w), progress(raw));
    assert.deepEqual(w.alert, raw.alert);
  }
  for (let i = 0; i < 60; i++) step(w, LEVELS, { x: 0, y: 0 });
  assert.ok(w.agents.every(a => Number.isFinite(a.x) && Number.isFinite(a.y)));
});
