import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { create, step, player, route, padVisible, restore, boostMult, followers, isDone, DT } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';

// Before P1 tuning: controlled inputs through the shipped engine, not a user-save or phone-speed claim.
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim();
// Keep generated worlds/reports out of the working tree. Pass an explicit output directory.
const out = new URL(process.argv[2].replace(/\/?$/, '/'), 'file://' + process.cwd() + '/');
await mkdir(out, { recursive: true });
const still = { x: 0, y: 0 };
const level = w => LEVELS[w.level];
const people = w => w.agents.filter(a => a.kind === 'agent');
const station = (w, kind) => level(w).stations.find(s => s.kind === kind);
const sum = o => Object.values(o).reduce((n, value) => n + value, 0);
const balances = w => ({ wallet: w.coins, piles: { ...w.piles }, bags: w.agents.reduce((n, a) => n + a.cash, 0),
  floor: w.floor.length, total: w.coins + sum(w.piles) + w.agents.reduce((n, a) => n + a.cash, 0) + w.floor.length });

function go(w, to) {
  const p = player(w), path = route(w, level(w), p, to);
  let stuck = 0;
  for (let i = 0; i < 60 * 60; i++) {
    while (path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 1) path.shift();
    if (!path.length) return;
    const t = path[0], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    const distance = w.speed * boostMult(w, level(w)) * DT;
    const was = { x: p.x, y: p.y };
    step(w, LEVELS, d < distance ? { x: dx / distance, y: dy / distance } : { x: dx / d, y: dy / d });
    stuck = Math.hypot(p.x - was.x, p.y - was.y) < 0.01 ? stuck + 1 : 0;
    assert.ok(stuck <= 30, `blocked route to ${JSON.stringify(to)} at ${p.x},${p.y}`);
  }
  assert.fail(`route did not finish: ${JSON.stringify(to)}`);
}
function until(w, done, seconds, what) {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return;
    step(w, LEVELS, still);
  }
  console.error(JSON.stringify({ failed: what, player: { x: player(w).x, y: player(w).y },
    agents: people(w).map(a => ({ id: a.id, state: a.state, house: a.house, leader: a.leader, x: a.x, y: a.y })) }));
  assert.fail(what);
}
function snapshot(w) {
  const counts = {};
  for (const p of people(w)) counts[p.state] = (counts[p.state] ?? 0) + 1;
  return { seconds: w.steps * DT, rank: w.rank, released: w.released, settled: w.settled,
    residents: people(w).length, counts, hurt: people(w).filter(a => a.hurt > 0).length,
    balances: balances(w), rankMoney: w.took.rank, bought: [...w.bought] };
}

async function maxed(n, seed) {
  const w = create(LEVELS, n, seed), l = level(w);
  // Acquisition-time/rank are controlled fixture setup. Do not count this grant as earned money.
  const grant = l.pads.reduce((n, p) => n + p.cost, 0);
  w.rank = Math.max(...l.pads.map(p => p.rank ?? 1));
  w.coins = grant;
  w.ride.t = w.boost.t = w.fightIn = 1e9;
  const initialSteps = w.steps;
  for (;;) {
    const p = l.pads.find(p => padVisible(w, p));
    if (!p) break;
    go(w, p.at);
    until(w, () => w.bought.includes(p.id), 5, `purchase ${p.id}`);
  }
  assert.equal(w.bought.length, l.pads.length);
  assert.equal(w.coins, 0, 'all and only setup grant was spent on actual pads');
  assert.equal(people(w).length, 0);
  go(w, l.start);
  for (let i = 0; i < 300; i++) step(w, LEVELS, still);
  const raw = JSON.stringify(w);
  await writeFile(new URL(`maxed-${l.id}-${seed}.json`, out), raw);
  const r = restore(raw, LEVELS);
  assert.deepEqual({ bought: r.bought, paid: r.paid, coins: r.coins, rank: r.rank },
    { bought: w.bought, paid: w.paid, coins: w.coins, rank: w.rank });
  return { raw, setup: { grant, rank: w.rank, seconds: (w.steps - initialSteps) * DT,
    purchases: w.bought.length, helpers: w.agents.filter(a => a.kind !== 'agent' && a.kind !== 'player').length,
    provenance: 'controlled budget/rank, actual routed purchases, emitted current-version World, not a user save' } };
}

async function passive(raw, setup, park, seed) {
  const w = restore(raw, LEVELS), l = level(w);
  go(w, park === 'safe' ? station(w, 'safe').pileAt : l.start);
  // Restore normal authored arrivals/incidents/boosts only after acquisition/position setup.
  w.ride = { state: 'away', x: -100, t: 1 };
  w.fightIn = l.fights.every;
  w.boost = { x: 0, y: 0, here: false, t: l.boost.every };
  const start = snapshot(w), series = [];
  const checked = new Set();
  for (let i = 0; i < 600 * 60; i++) {
    step(w, LEVELS, still);
    for (const a of people(w)) if (a.tags.includes('uniform')) checked.add(a.id);
    if ((i + 1) % (60 * 60) === 0) series.push({ elapsed: (i + 1) * DT, ...snapshot(w) });
  }
  const end = snapshot(w);
  assert.deepEqual(end.bought, start.bought, 'measured run buys nothing');
  const record = { source, kind: 'maxed-passive', jail: l.id, seed, park, setup,
    playerPolicy: 'stationary, no manual needs/coins/boosts/incident intervention', elapsed: 600,
    start, end, generated: end.balances.total - start.balances.total,
    automaticRankMoney: end.rankMoney - start.rankMoney, releases: end.released - start.released, series };
  const income = {
    checkin: checked.size * station(w, 'checkin').pay,
    release: record.releases * station(w, 'release').pay,
    rank: record.automaticRankMoney,
    incident: (end.settled - start.settled) * l.fights.reward,
  };
  income.homeFloor = record.generated - Object.values(income).reduce((n, v) => n + v, 0);
  assert.ok(Number.isInteger(income.homeFloor) && income.homeFloor >= 0);
  record.income = income;
  const rawEnd = JSON.stringify(w), restored = restore(rawEnd, LEVELS);
  assert.equal(balances(restored).total, end.balances.total, 'emitted maxed money survives restore');
  assert.equal(restored.coins, w.coins);
  assert.deepEqual(restored.bought, w.bought);
  assert.deepEqual(restored.paid, w.paid);
  // Restore deliberately deposits carried cash into the safe. Preserve value, not bag location.
  assert.equal(restored.agents.reduce((n, a) => n + a.cash, 0), 0);
  assert.equal(restored.piles[station(w, 'safe').id] ?? 0,
    (w.piles[station(w, 'safe').id] ?? 0) + w.agents.reduce((n, a) => n + a.cash, 0));
  const progress = x => x.agents.map(a => ({ id: a.id, kind: a.kind, state: a.state, house: a.house,
    slot: a.slot, served: a.served, station: a.station, seat: a.seat }));
  assert.deepEqual(progress(restored), progress(w), 'emitted resident/helper identity and progress survive');
  if (seed === 37 && (w.level === 0 ? park === 'start' : park === 'safe'))
    await writeFile(new URL(`emitted-running-${l.id}-${seed}-${park}.json`, out), rawEnd);
  await writeFile(new URL(`passive-${l.id}-${seed}-${park}.json`, out), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ kind: record.kind, jail: l.id, seed, park, elapsed: 600,
    generated: record.generated, wallet: end.balances.wallet - start.balances.wallet,
    safe: (end.balances.piles.safe ?? 0) - (start.balances.piles.safe ?? 0),
    automaticRankMoney: record.automaticRankMoney, releases: record.releases, finalRank: end.rank, income, finalCounts: end.counts }));
  return record;
}

async function fresh(n, seed) {
  const w = create(LEVELS, n, seed), l = level(w), start = snapshot(w);
  until(w, () => people(w).filter(a => a.state === 'queue').length >= 3, 30, 'first bus to queue');
  const first = people(w).map(a => a.id).sort((a, b) => a - b).slice(0, 2);
  go(w, station(w, 'checkin').at);
  until(w, () => first.every(id => w.agents.find(a => a.id === id)?.tags.includes('uniform')), 5, 'first two checked in');
  go(w, { x: 228, y: 680 });
  until(w, () => followers(w, player(w)).length === 2, 10, 'two held and following');
  const house = l.stations.find(s => s.kind === 'house');
  go(w, house.at);
  until(w, () => first.every(id => w.agents.find(a => a.id === id)?.house), 10, 'both assigned beds');
  const actualHome = w.agents.find(a => a.id === first[0]).house;
  assert.ok(first.every(id => w.agents.find(a => a.id === id).house === actualHome));
  // Waiting at the door would automatically pick up hungry residents before their time is served.
  go(w, l.start);
  until(w, () => first.every(id => {
    const a = w.agents.find(a => a.id === id);
    return a?.state === 'home' && isDone(l, a);
  }), 160, 'two served their time while player waits away from the door');
  go(w, l.stations.find(s => s.id === actualHome).at);
  until(w, () => followers(w, player(w)).length === 2, 10, 'two done residents picked up');
  go(w, station(w, 'release').at);
  until(w, () => w.released === 2, 5, 'first two released');
  assert.deepEqual(w.bought, [], 'fixed fresh policy buys nothing');
  const end = snapshot(w), record = { source, kind: 'fresh-scripted-unserviced-two-releases', jail: l.id, seed,
    playerPolicy: 'routed check-in, lead two into block, wait away until done, return to actual assigned door, lead to release; no purchases or manual needs',
    start, end, elapsed: end.seconds - start.seconds, generated: end.balances.total - start.balances.total,
    automaticRankMoney: end.rankMoney - start.rankMoney };
  await writeFile(new URL(`fresh-${l.id}-${seed}.json`, out), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ kind: record.kind, jail: l.id, seed, elapsed: record.elapsed,
    generated: record.generated, wallet: end.balances.wallet, rankMoney: record.automaticRankMoney, rank: end.rank }));
  return record;
}

const legacy = JSON.parse(await readFile(new URL('../tests/fixtures/v0.1.21-save.json', import.meta.url), 'utf8'));
console.log(JSON.stringify({ kind: 'existing-legacy-fixture-inventory', rank: legacy.rank, coins: legacy.coins,
  purchases: legacy.bought.length, helpers: legacy.agents.filter(a => a.kind !== 'player' && a.kind !== 'agent').length,
  isMaxed: false }));
const records = [];
for (const n of [0, 1]) for (const seed of [37, 71]) {
  records.push(await fresh(n, seed));
  const capture = await maxed(n, seed);
  for (const park of ['start', 'safe']) records.push(await passive(capture.raw, capture.setup, park, seed));
}
await writeFile(new URL('results.json', out), JSON.stringify({ source, records }, null, 2));
