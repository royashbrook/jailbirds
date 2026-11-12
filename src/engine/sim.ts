// the idle engine: one fixed step over a level. no DOM, no clock, no real dice,
// so the same seed and the same stick play the same game and tests can drive it.
//
// the loop it runs: a ride drops arrivals, they walk through to a check-in queue,
// an actor at the desk checks them in while there is a free bed, an actor leads
// them to a home. at home their needs run down: some they see to themselves, for
// the rest they wait with a bubble to be led to the right room. content residents
// drop coins. after their time is served they wait to be led to the release desk,
// which pays and earns a star; stars raise the rank, and the rank opens price pads.
import { roll } from "./rng.ts";
import { collide, dist, inside, nav, near, route as navRoute, walls, type Nav } from "./geom.ts";
import type { Agent, AgentKind, AnyStation, LevelDef, Mood, PadDef, Pt, Rect, ReleaseDef, Stick, World } from "./types.ts";

export const DT = 1 / 60;
export const AGENT_SPEED = 80;
export const HELPER_SPEED = 85;
export const PICKUP_RADIUS = 40;
export const FOLLOW_GAP = 18;
export const HELPER_LINE = 2;
export const HELPER_CARRY = 4;
export const CLEAN_TIME = 0.4;
const BODY = 10;
const PAD_R = 24;
/** how long to stand still on a pad before it starts taking coins, in seconds. walking
 * never pays, so this only has to be long enough that brushing to a stop on one is not a yes */
export const PAD_WAIT = 0.2;
const MESS_R = 20;
const COIN_R = 24;
const PILE_R = 30;
const BOOST_R = 22;
const ALERT_R = 40;
const TRAIL_STEP = 3;
/** seconds home before a resident asks to be led anywhere */
export const SETTLE = 2;

type Kind = AnyStation["kind"];
type S<K extends Kind> = Extract<AnyStation, { kind: K }>;
const all = <K extends Kind>(l: LevelDef, kind: K) => l.stations.filter((s) => s.kind === kind) as S<K>[];
const byId = (l: LevelDef, id: string) => l.stations.find((s) => s.id === id);

export function create(levels: LevelDef[], level = 0, seed = 1): World {
  const l = levels[level];
  return {
    v: 3, level, steps: 0, rng: seed >>> 0, nextId: 2, coins: 0,
    agents: [agent(1, "player", l.start, 0, l)],
    bought: [], paid: {}, stock: {}, piles: {}, messes: [], floor: [],
    ride: { state: "away", x: -100, t: 1 }, clock: {},
    carryMax: l.carry, lineMax: l.line, speed: l.speed, rank: 1, stars: 0, released: 0, settled: 0,
    alert: null, fightIn: l.fights.every, boost: { x: 0, y: 0, here: false, t: l.boost.every }, boosted: 0,
  };
}
function agent(id: number, kind: AgentKind, at: Pt, look: number, l: LevelDef): Agent {
  return {
    id, kind, x: at.x, y: at.y, face: 1, moving: false, walk: 0, look, tags: [], state: kind === "agent" ? "arrive" : "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1,
    needs: kind === "agent" ? Object.fromEntries(l.needs.map((n) => [n.id, n.start])) : {},
    served: 0, rest: 0, t: 0, carry: 0, path: [], trail: [],
  };
}

function rand(w: World) {
  const [v, next] = roll(w.rng);
  w.rng = next;
  return v;
}
export const player = (w: World) => w.agents[0];
export const isOpen = (w: World, id?: string) => !id || w.bought.includes(id);
const isActor = (a: Agent) => a.kind !== "agent";
export const followers = (w: World, leader: Agent) =>
  w.agents.filter((a) => a.leader === leader.id && a.state === "follow").sort((a, b) => a.t - b.t);
export const population = (w: World) => w.agents.filter((a) => a.kind === "agent").length;
export function capacity(w: World, l: LevelDef) {
  return all(l, "house").filter((h) => isOpen(w, h.locked)).reduce((n, h) => n + h.seats.length, 0);
}
/** beds not slept in and not promised to someone checked in and on the way */
export function freeBeds(w: World, l: LevelDef) {
  const promised = w.agents.filter((a) => a.kind === "agent" && (a.house || a.state === "ready" || (a.state === "follow" && !a.house))).length;
  return capacity(w, l) - promised;
}
const queued = (w: World) => w.agents.filter((a) => a.state === "queue").sort((a, b) => a.t - b.t);
/** the check-in queue is waiting and every bed is spoken for */
export const noBed = (w: World, l: LevelDef) => queued(w).length > 0 && freeBeds(w, l) <= 0;
export const rankNeed = (w: World, l: LevelDef) => l.rankStars[Math.min(w.rank - 1, l.rankStars.length - 1)];

export function mood(l: LevelDef, a: Agent): Mood {
  const v = Object.values(a.needs);
  if (v.some((n) => n <= 0)) return "cross";
  if (v.some((n) => n < l.threshold)) return "needy";
  return "ok";
}
/** what an agent wants most right now, if anything */
export function wants(l: LevelDef, a: Agent, escortOnly = false): string | null {
  let best: string | null = null;
  for (const n of l.needs)
    if ((!escortOnly || n.escort) && a.needs[n.id] < l.threshold && (!best || a.needs[n.id] < a.needs[best])) best = n.id;
  return best;
}
export const isDone = (l: LevelDef, a: Agent) => a.kind === "agent" && !!a.house && a.served >= l.serve;
/** a resident at home who is waiting to be led somewhere */
const waiting = (l: LevelDef, a: Agent) => a.state === "home" && a.rest >= SETTLE && (isDone(l, a) || !!wants(l, a, true));

export function padVisible(w: World, p: PadDef) {
  return !w.bought.includes(p.id) && isOpen(w, p.after);
}

/** a station hands out one thing every `every` seconds while someone stays */
function tick(w: World, key: string, every: number, live: Set<string>) {
  live.add(key);
  w.clock[key] = (w.clock[key] ?? 0) + DT;
  if (w.clock[key] < every) return false;
  w.clock[key] -= every;
  return true;
}

/** step toward a point, keeping the walk cycle and facing honest; true once there */
function walkTo(a: Agent, to: Pt, speed: number) {
  const dx = to.x - a.x, dy = to.y - a.y, d = Math.hypot(dx, dy), s = speed * DT;
  if (d < 0.01) return true;
  if (Math.abs(dx) > 0.5) a.face = dx > 0 ? 1 : -1;
  a.moving = true;
  if (d <= s) {
    a.x = to.x;
    a.y = to.y;
    a.walk += d;
    return true;
  }
  a.x += (dx / d) * s;
  a.y += (dy / d) * s;
  a.walk += s;
  return false;
}
/** follow the waypoints; true at the end */
function walkPath(a: Agent, speed: number) {
  while (a.path.length) {
    if (!walkTo(a, a.path[0], speed)) return false;
    a.path.shift();
    if (a.path.length && a.moving) return false;
  }
  return true;
}

// walls and the walking grid change only when something is bought, so keep them
const cache = new Map<string, { walls: Rect[]; nav: Nav }>();
function grid(w: World, l: LevelDef, agents: boolean) {
  const key = `${l.id}:${agents}:${[...w.bought].sort().join()}`;
  let got = cache.get(key);
  if (!got) {
    if (cache.size > 40) cache.clear();
    const ws = walls(l, (r) => isOpen(w, r.locked), agents);
    got = { walls: ws, nav: nav(l, ws) };
    cache.set(key, got);
  }
  return got;
}
/** the way from here to there, round the walls: agents may use residents-only doors, actors may not */
export function route(w: World, l: LevelDef, a: Agent, to: Pt) {
  return navRoute(grid(w, l, a.kind === "agent").nav, a, to);
}
function goTo(w: World, l: LevelDef, a: Agent, to: Pt) {
  const end = a.path[a.path.length - 1];
  if (end ? dist(end, to) < 1 : dist(a, to) < 1) return;
  a.path = route(w, l, a, to);
}

const freeSeat = (w: World, st: string, s: number) =>
  !w.agents.some((a) => a.station === st && a.seat === s && (a.state === "go" || a.state === "use"));
/** an open, free, clean seat at a station that meets this need, for this resident */
function seatFor(w: World, st: AnyStation, need: string, a: Agent) {
  if ((st.kind !== "sink" && st.kind !== "facility") || st.need !== need) return -1;
  if (st.kind === "sink" && !isOpen(w, st.locked)) return -1;
  return st.seats.findIndex(
    (seat, i) =>
      isOpen(w, seat.locked) && (!seat.house || seat.house === a.house) && freeSeat(w, st.id, i) &&
      !w.messes.some((m) => m.station === st.id && m.seat === i),
  );
}
function sendTo(w: World, l: LevelDef, a: Agent, st: S<"sink"> | S<"facility">, seat: number) {
  a.state = "go";
  a.leader = -1;
  a.station = st.id;
  a.seat = seat;
  a.t = 0;
  a.path = route(w, l, a, st.seats[seat].at);
}
function goHome(w: World, l: LevelDef, a: Agent) {
  const h = byId(l, a.house) as S<"house">;
  a.state = "back";
  a.leader = -1;
  a.station = "";
  a.seat = -1;
  a.path = route(w, l, a, h.seats[a.slot].at);
}

function addStar(w: World, l: LevelDef) {
  w.stars++;
  if (w.stars >= rankNeed(w, l)) {
    w.stars = 0;
    w.rank++;
    w.coins += l.rankReward * w.rank;
  }
}

export function step(w: World, levels: LevelDef[], stick: Stick) {
  const l = levels[w.level];
  w.steps++;
  for (const a of w.agents) a.moving = false;
  const live = new Set<string>();

  // the player: the stick is a direction, at most full speed, stopped by walls
  const p = player(w);
  if (w.boosted > 0) w.boosted = Math.max(0, w.boosted - DT);
  const len = Math.hypot(stick.x, stick.y);
  if (len > 0.05) {
    const k = len > 1 ? 1 / len : 1, speed = w.speed * (w.boosted > 0 ? l.boost.mult : 1);
    const before = { x: p.x, y: p.y };
    p.x += stick.x * k * speed * DT;
    p.y += stick.y * k * speed * DT;
    const spawn = all(l, "spawn")[0];
    p.x = Math.min(l.size.w - BODY, Math.max(BODY, p.x));
    p.y = Math.min((spawn?.roadY ?? l.size.h) - 30, Math.max(BODY, p.y));
    collide(p, BODY, grid(w, l, false).walls);
    const moved = dist(before, p);
    if (moved > 0.01) {
      p.moving = true;
      p.walk += moved;
      if (Math.abs(stick.x) > 0.1) p.face = stick.x > 0 ? 1 : -1;
    }
  }

  helpers(w, l);
  for (const a of w.agents)
    if (isActor(a) && (!a.trail.length || dist(a.trail[0], a) >= TRAIL_STEP)) {
      a.trail.unshift({ x: a.x, y: a.y });
      if (a.trail.length > 120) a.trail.length = 120;
    }

  arrivals(w, l);
  for (const a of w.agents.filter(isActor)) act(w, l, a, live);

  // only the player picks up coins, piles and boosts, pays pads and settles squabbles
  const before = w.floor.length;
  w.floor = w.floor.filter((c) => !near(c, p, COIN_R));
  w.coins += before - w.floor.length;
  for (const st of l.stations)
    if ((st.kind === "checkin" || st.kind === "release") && (w.piles[st.id] ?? 0) > 0 && near(p, st.pileAt, PILE_R)) {
      w.coins += w.piles[st.id];
      w.piles[st.id] = 0;
    }
  if (w.boost.here && near(p, w.boost, BOOST_R)) {
    w.boost.here = false;
    w.boost.t = l.boost.every;
    w.boosted = l.boost.time;
  } else if (!w.boost.here) {
    w.boost.t -= DT;
    if (w.boost.t <= 0 && l.boost.spots.length) {
      const at = l.boost.spots[Math.floor(rand(w) * l.boost.spots.length)];
      w.boost = { x: at.x, y: at.y, here: true, t: 0 };
    }
  }
  // a pad takes nothing from someone walking over it, only from someone who stops on it a moment
  const pad = l.pads.find((x) => padVisible(w, x) && near(p, x.at, PAD_R));
  // the sweep at the end of the step would clear it too late: the payment below reads it first
  if (pad && !p.moving) {
    w.clock.still = (w.clock.still ?? 0) + DT;
    live.add("still");
  } else delete w.clock.still;
  if (pad && (w.clock.still ?? 0) >= PAD_WAIT && w.coins > 0 && w.rank >= (pad.rank ?? 0)) {
    w.clock.pad = (w.clock.pad ?? 0) + DT * Math.max(4, pad.cost);
    live.add("pad");
    while (w.clock.pad >= 1 && w.coins > 0 && (w.paid[pad.id] ?? 0) < pad.cost) {
      w.clock.pad--;
      w.coins--;
      w.paid[pad.id] = (w.paid[pad.id] ?? 0) + 1;
    }
    if (w.paid[pad.id] >= pad.cost) buy(w, levels, pad);
  }
  if (levels[w.level] !== l) return;

  fights(w, l);

  // followers walk the leader's trail, so they come through the same doors
  for (const a of w.agents.filter(isActor)) {
    const speed = a.kind === "player" ? w.speed * (w.boosted > 0 ? l.boost.mult : 1) : HELPER_SPEED;
    followers(w, a).forEach((b, i) => {
      const target = alongTrail(a, (i + 1) * FOLLOW_GAP);
      if (!near(b, target, 1.5)) walkTo(b, target, speed * 1.15);
    });
  }

  residents(w, l);
  for (const k of Object.keys(w.clock)) if (!live.has(k)) delete w.clock[k];
}

function alongTrail(a: Agent, d: number): Pt {
  let left = d, prev: Pt = a;
  for (const p of a.trail) {
    const s = dist(prev, p);
    if (s >= left) return { x: prev.x + ((p.x - prev.x) * left) / s, y: prev.y + ((p.y - prev.y) * left) / s };
    left -= s;
    prev = p;
  }
  return prev;
}

/** what an actor (the player or a helper) does by standing where it stands */
function act(w: World, l: LevelDef, a: Agent, live: Set<string>) {
  const line = followers(w, a);
  const leads = a.kind === "player" || a.kind === "escort";
  const cap = a.kind === "player" ? w.lineMax : HELPER_LINE;
  const join = (b: Agent) => {
    if (line.length >= cap) return;
    if (b.state === "ready") b.slot = -1;
    b.state = "follow";
    b.leader = a.id;
    b.t = w.steps + line.length * 0.01;
    line.push(b);
  };

  // pick up whoever checked in, or residents waiting at their door to be led somewhere
  if (leads) {
    for (const b of w.agents) if (b.state === "ready" && near(b, a, PICKUP_RADIUS)) join(b);
    for (const h of all(l, "house"))
      if (isOpen(w, h.locked) && near(a, h.at, h.r))
        for (const b of w.agents) if (b.house === h.id && waiting(l, b)) join(b);
  }

  for (const st of l.stations) {
    const key = `${a.id}:${st.id}`;
    if (st.kind === "checkin" && (a.kind === "player" || a.kind === "clerk") && near(a, st.at, st.r)) {
      const head = queued(w)[0];
      const outs = w.agents.filter((b) => b.state === "ready").map((b) => b.slot);
      const out = st.out.findIndex((_, i) => !outs.includes(i));
      if (head && near(head, st.queue[0], 2) && freeBeds(w, l) > 0 && out >= 0 && tick(w, key, st.every, live)) {
        head.tags.push(st.tag);
        head.state = "ready";
        head.slot = out;
        head.path = route(w, l, head, st.out[out]);
        w.piles[st.id] = (w.piles[st.id] ?? 0) + st.pay;
      }
    } else if (st.kind === "house" && leads && isOpen(w, st.locked) && near(a, st.at, st.r)) {
      // newcomers move in while there is a bed; residents with nothing to do go back in
      const taken = w.agents.filter((b) => b.house === st.id).map((b) => b.slot);
      const slot = st.seats.findIndex((_, i) => !taken.includes(i));
      const fresh = line.find((b) => !b.house && (!st.requires || b.tags.includes(st.requires)));
      if (fresh && slot >= 0 && tick(w, key, 0.25, live)) {
        fresh.house = st.id;
        fresh.slot = slot;
        fresh.state = "enter";
        fresh.leader = -1;
        fresh.served = 0;
        fresh.path = route(w, l, fresh, st.seats[slot].at);
      }
      for (const b of line) if (b.house === st.id && !isDone(l, b) && !wants(l, b, true)) goHome(w, l, b);
    } else if ((st.kind === "sink" || (st.kind === "facility" && st.zone)) && leads && inside(a, st.kind === "sink" ? st.zone : st.zone!)) {
      // led into the room: whoever wants what it offers takes a seat. anyone who has
      // served their time is on the way out and only stops at the release desk
      for (const b of line) {
        if (isDone(l, b) || wants(l, b, true) !== st.need) continue;
        const seat = seatFor(w, st, st.need, b);
        if (seat >= 0) sendTo(w, l, b, st, seat);
      }
    } else if (st.kind === "release" && leads && near(a, st.at, st.r)) {
      const done = line.find((b) => isDone(l, b));
      if (done && tick(w, key, st.every, live)) release(w, l, done, st);
    }
    // carriers: fill up at a source, put down at a sink
    if (a.kind === "player" || a.kind === "carrier") {
      const most = a.kind === "player" ? w.carryMax : HELPER_CARRY;
      if (st.kind === "source" && near(a, st.at, st.r) && a.carry < most && tick(w, key + ":fill", st.every, live)) a.carry++;
      if (st.kind === "sink" && isOpen(w, st.locked) && inside(a, st.zone) && a.carry > 0) {
        const room = st.seats.filter((s) => isOpen(w, s.locked)).length;
        if ((w.stock[st.id] ?? 0) < room && tick(w, key + ":drop", st.every, live)) {
          a.carry--;
          w.stock[st.id] = (w.stock[st.id] ?? 0) + 1;
        }
      }
    }
  }
  // cleaners: stand on a mess for a moment and it is gone
  if (a.kind === "player" || a.kind === "cleaner") {
    const m = w.messes.find((m) => near(m, a, MESS_R));
    if (m) {
      m.clean += DT;
      if (m.clean >= CLEAN_TIME) w.messes = w.messes.filter((x) => x !== m);
    }
  }
}

function release(w: World, l: LevelDef, b: Agent, st: ReleaseDef) {
  b.state = "leave";
  b.leader = -1;
  b.house = "";
  b.slot = -1;
  b.path = st.exit.flatMap((pt, i) => (i ? [pt] : route(w, l, b, pt)));
  w.piles[st.id] = (w.piles[st.id] ?? 0) + st.pay;
  w.released++;
  addStar(w, l);
}

function buy(w: World, levels: LevelDef[], pad: PadDef) {
  const l = levels[w.level];
  w.bought.push(pad.id);
  delete w.clock.pad;
  const u = pad.unlock;
  if (u.carry) w.carryMax = u.carry;
  if (u.line) w.lineMax = u.line;
  if (u.speed) w.speed = u.speed;
  if (u.helper) w.agents.push(agent(w.nextId++, u.helper, l.helperHome, 0, l));
  if (u.level && levels[w.level + 1]) Object.assign(w, create(levels, w.level + 1, w.rng), { steps: w.steps });
}

function arrivals(w: World, l: LevelDef) {
  const st = all(l, "spawn")[0];
  const desk = all(l, "checkin")[0];
  if (!st || !desk) return;
  const ride = w.ride, speed = 180;
  const coming = w.agents.filter((a) => a.state === "arrive" || a.state === "queue").length;
  if (ride.state === "away") {
    ride.t -= DT;
    if (ride.t <= 0 && coming + st.load <= desk.queue.length) {
      ride.state = "in";
      ride.x = -100;
    }
  } else if (ride.state === "in") {
    ride.x = Math.min(st.stopX, ride.x + speed * DT);
    if (ride.x === st.stopX) {
      for (let i = 0; i < st.load; i++) {
        const a = agent(w.nextId++, "agent", { x: st.at.x + (i - (st.load - 1) / 2) * 22, y: st.at.y }, Math.floor(rand(w) * l.looks), l);
        a.t = w.steps + i * 0.01;
        a.path = st.via.flatMap((pt, k) => (k ? [pt] : route(w, l, a, pt)));
        w.agents.push(a);
      }
      ride.state = "out";
    }
  } else {
    ride.x += speed * DT;
    if (ride.x > l.size.w + 100) {
      ride.state = "away";
      ride.t = st.gap;
    }
  }
  // the queue shuffles up one place at a time
  for (const a of w.agents) if (a.state === "arrive" && walkPath(a, AGENT_SPEED)) a.state = "queue";
  queued(w).forEach((a, i) => walkTo(a, desk.queue[Math.min(i, desk.queue.length - 1)], AGENT_SPEED));
  for (const a of w.agents) if (a.state === "ready") walkPath(a, AGENT_SPEED);
}

function fights(w: World, l: LevelDef) {
  const f = l.fights;
  if (w.alert) {
    const al = w.alert;
    if (near(player(w), al, ALERT_R)) al.held += DT;
    if (al.held >= f.settle) {
      for (const id of al.ids) {
        const b = w.agents.find((a) => a.id === id);
        if (b?.state === "fight") b.state = "home";
      }
      for (let k = 0; k < f.reward; k++)
        w.floor.push({ x: al.x + (rand(w) - 0.5) * 40, y: al.y + (rand(w) - 0.5) * 20, house: "" });
      w.alert = null;
      w.settled++;
      w.fightIn = f.every * (0.7 + 0.6 * rand(w));
    }
    return;
  }
  const home = w.agents.filter((a) => a.state === "home" && !isDone(l, a));
  if (home.length < f.minPop) return;
  // a cross resident makes a squabble come sooner
  w.fightIn -= DT * (home.some((a) => mood(l, a) === "cross") ? f.every / f.crossEvery : 1);
  if (w.fightIn > 0) return;
  const houses = all(l, "house").filter((h) => home.filter((a) => a.house === h.id).length >= 2);
  if (!houses.length) {
    w.fightIn = 5;
    return;
  }
  const h = houses[Math.floor(rand(w) * houses.length)];
  const pair = home.filter((a) => a.house === h.id).slice(0, 2);
  for (const a of pair) a.state = "fight";
  w.alert = { x: h.at.x, y: h.at.y, ids: pair.map((a) => a.id), held: 0 };
}

function residents(w: World, l: LevelDef) {
  for (const a of [...w.agents]) {
    if (a.kind !== "agent") continue;
    if (a.state === "enter" || a.state === "back") {
      if (walkPath(a, AGENT_SPEED)) {
        a.state = "home";
        a.rest = 0;
      }
    } else if (a.state === "leave") {
      if (walkPath(a, AGENT_SPEED)) w.agents = w.agents.filter((x) => x !== a);
    } else if (a.state === "home") {
      for (const n of l.needs) a.needs[n.id] = Math.max(0, a.needs[n.id] - DT / n.decay);
      a.served += DT;
      a.rest += DT;
      const h = byId(l, a.house) as S<"house">;
      if (mood(l, a) === "ok") {
        a.t += DT;
        if (a.t >= l.coinEvery) {
          a.t = 0;
          if (w.floor.filter((c) => c.house === h.id).length < l.coinsPerHouse)
            w.floor.push({ x: h.coinAt.x + (rand(w) - 0.5) * 36, y: h.coinAt.y + (rand(w) - 0.5) * 14, house: h.id });
        }
      }
      // what it can see to itself (a seat in its own home), it does
      for (const n of l.needs) {
        if (n.escort || a.needs[n.id] >= l.threshold || a.state !== "home") continue;
        for (const st of l.stations) {
          if (st.kind !== "facility" || st.zone) continue;
          const seat = seatFor(w, st, n.id, a);
          if (seat >= 0) {
            sendTo(w, l, a, st, seat);
            break;
          }
        }
      }
    } else if (a.state === "go") {
      if (walkPath(a, AGENT_SPEED)) {
        a.state = "use";
        a.t = 0;
        a.carry = 0;
      }
    } else if (a.state === "use") {
      const st = byId(l, a.station) as S<"sink"> | S<"facility">;
      // at a sink, wait for an item, then use it
      if (st.kind === "sink" && !a.carry) {
        if ((w.stock[st.id] ?? 0) > 0) {
          w.stock[st.id]--;
          a.carry = 1;
        }
        continue;
      }
      a.t += DT;
      if (a.t >= st.use) {
        a.needs[st.need] = 1;
        a.carry = 0;
        if (st.kind === "facility" && rand(w) < st.messChance) {
          const at = st.seats[a.seat].messAt ?? st.seats[a.seat].at;
          w.messes.push({ id: w.nextId++, kind: st.mess, x: at.x, y: at.y, station: st.id, seat: a.seat, clean: 0 });
        }
        goHome(w, l, a);
      }
    }
  }
}

/** hired help: each picks a place to be from what needs doing, and walks there through the doors.
 * the goal is worked out fresh every step, so a helper never chases someone already taken */
function helpers(w: World, l: LevelDef) {
  for (const h of w.agents) {
    let goal: Pt = l.helperHome;
    if (h.kind === "carrier") {
      const source = all(l, "source")[0];
      const sinks = all(l, "sink").filter((s) => isOpen(w, s.locked));
      const room = sinks.find((s) => (w.stock[s.id] ?? 0) < s.seats.filter((x) => isOpen(w, x.locked)).length);
      const filling = source && near(h, source.at, source.r) && h.carry < HELPER_CARRY;
      if (room && (h.carry === 0 || filling)) goal = source.at;
      else if (room && h.carry > 0) goal = room.at;
    } else if (h.kind === "cleaner") {
      const m = [...w.messes].sort((a, b) => a.id - b.id)[0];
      if (m) goal = m;
    } else if (h.kind === "clerk") {
      const desk = all(l, "checkin")[0];
      if (desk) goal = desk.at;
    } else if (h.kind === "escort") {
      goal = escortGoal(w, l, h) ?? goal;
    } else continue;
    goTo(w, l, h, goal);
    walkPath(h, HELPER_SPEED);
  }
}
const roomOf = (st: AnyStation): Pt | null => {
  if (st.kind === "sink") return st.at;
  if (st.kind === "facility" && st.zone) return { x: st.zone.x + st.zone.w / 2, y: st.zone.y + st.zone.h / 2 };
  return null;
};
function escortGoal(w: World, l: LevelDef, h: Agent): Pt | null {
  const first = followers(w, h)[0];
  if (first) {
    if (!first.house) {
      const house = all(l, "house").find((s) => isOpen(w, s.locked) && s.seats.some((_, i) => !w.agents.some((b) => b.house === s.id && b.slot === i)));
      return house?.at ?? null;
    }
    if (isDone(l, first)) return all(l, "release")[0]?.at ?? null;
    const need = wants(l, first, true);
    for (const st of l.stations) if (need && roomOf(st) && seatFor(w, st, need, first) >= 0) return roomOf(st);
    return (byId(l, first.house) as S<"house">).at;
  }
  const ready = w.agents.find((b) => b.state === "ready");
  if (ready) return ready;
  for (const b of w.agents) {
    if (!waiting(l, b)) continue;
    const need = wants(l, b, true);
    if (isDone(l, b) || l.stations.some((st) => need && roomOf(st) && seatFor(w, st, need, b) >= 0)) return (byId(l, b.house) as S<"house">).at;
  }
  return null;
}

/** what to do next, as a key the content turns into words */
export type Hint =
  | { key: "alert" | "checkin" | "nobed" | "pickup" | "house" | "release" | "done" | "clean" | "coins" | "pad" | "rank" | "idle" }
  | { key: "errand" | "fetch" | "drop"; need: string };
export function hint(w: World, l: LevelDef): Hint {
  if (w.alert) return { key: "alert" };
  const me = player(w);
  const line = followers(w, me);
  if (line.some((b) => !b.house)) return { key: "house" };
  if (line.some((b) => isDone(l, b))) return { key: "release" };
  const want = line.map((b) => wants(l, b, true)).find(Boolean);
  if (want) return { key: "errand", need: want };
  // items first when someone sits at a sink with nothing to use
  const emptyHanded = w.agents.find((a) => a.state === "use" && !a.carry && byId(l, a.station)?.kind === "sink");
  if (emptyHanded) return { key: me.carry ? "drop" : "fetch", need: (byId(l, emptyHanded.station) as S<"sink">).need };
  if (queued(w).length) return noBed(w, l) ? { key: "nobed" } : { key: "checkin" };
  if (w.agents.some((a) => a.state === "ready")) return { key: "pickup" };
  if (w.agents.some((a) => a.state === "home" && isDone(l, a))) return { key: "done" };
  const errand = w.agents.map((a) => (a.state === "home" ? wants(l, a, true) : null)).find(Boolean);
  if (errand) return { key: "errand", need: errand };
  if (w.messes.length) return { key: "clean" };
  if (w.floor.length || Object.values(w.piles).some((n) => n > 0)) return { key: "coins" };
  const open = l.pads.filter((x) => padVisible(w, x) && w.coins >= x.cost - (w.paid[x.id] ?? 0));
  if (open.some((x) => w.rank >= (x.rank ?? 0))) return { key: "pad" };
  if (open.length) return { key: "rank" };
  return { key: "idle" };
}

/** a saved game, or null when the slot holds nothing we can trust */
export function restore(raw: string | null, levels: LevelDef[]): World | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as World;
    if (
      w?.v !== 3 ||
      !levels[w.level] ||
      !Array.isArray(w.agents) ||
      w.agents[0]?.kind !== "player" ||
      !Array.isArray(w.bought) ||
      !Array.isArray(w.messes) ||
      !Array.isArray(w.floor) ||
      typeof w.coins !== "number"
    )
      return null;
    return { ...create(levels, w.level), ...w, clock: {} };
  } catch {
    return null;
  }
}
