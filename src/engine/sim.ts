// the idle engine: one fixed step over a level. no DOM, no clock, no real dice,
// so the same seed and the same stick play the same game and tests can drive it.
import { roll } from "./rng.ts";
import { collide, dist, inside, nav, near, route as navRoute, walls, type Nav } from "./geom.ts";
import type { Agent, AgentKind, LevelDef, Mood, PadDef, Pt, Rect, StationDef, Stick, World } from "./types.ts";

export const DT = 1 / 60;
export const PLAYER_SPEED = 130;
export const AGENT_SPEED = 80;
export const HELPER_SPEED = 85;
export const PICKUP_RADIUS = 40;
export const FOLLOW_GAP = 18;
export const LINE_CAP = { player: 8, escort: 3 } as const;
export const HELPER_CARRY = 4;
export const CLEAN_TIME = 0.4;
export const MAX_STARS = 5;
const BODY = 10;
const PAD_R = 24;
const MESS_R = 20;
const COIN_R = 24;
const TRAIL_STEP = 3;

type Station<K extends StationDef["kind"]> = Extract<StationDef, { kind: K }>;
const stationsOf = <K extends StationDef["kind"]>(l: LevelDef, kind: K) => l.stations.filter((s) => s.kind === kind) as Station<K>[];

export function create(levels: LevelDef[], level = 0, seed = 1): World {
  const l = levels[level];
  return {
    v: 2,
    level,
    steps: 0,
    rng: seed >>> 0,
    nextId: 2,
    coins: 0,
    agents: [agent(1, "player", l.start, 0, l)],
    bought: [],
    paid: {},
    stock: {},
    messes: [],
    floor: [],
    ride: { state: "away", x: -100, t: 1 },
    clock: {},
    carryMax: l.carry,
    points: 0,
  };
}
function agent(id: number, kind: AgentKind, at: Pt, look: number, l: LevelDef): Agent {
  return {
    id, kind, x: at.x, y: at.y, face: 1, moving: false, walk: 0, look, tags: [], state: kind === "agent" ? "wait" : "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1,
    needs: kind === "agent" ? Object.fromEntries(l.needs.map((n) => [n.id, n.start])) : {},
    t: 0, carry: 0, path: [], trail: [],
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
const housed = (a: Agent) => a.kind === "agent" && a.state !== "wait" && a.state !== "follow";
export const followers = (w: World, leader: Agent) =>
  w.agents.filter((a) => a.leader === leader.id && a.state === "follow").sort((a, b) => a.t - b.t);

export function capacity(w: World, l: LevelDef) {
  return stationsOf(l, "house").filter((h) => isOpen(w, h.locked)).reduce((n, h) => n + h.seats.length, 0);
}
export const population = (w: World) => w.agents.filter((a) => a.kind === "agent").length;

export function mood(l: LevelDef, a: Agent): Mood {
  const v = Object.values(a.needs);
  if (v.some((n) => n <= 0)) return "cross";
  if (v.some((n) => n < l.threshold)) return "needy";
  return "ok";
}
/** what an agent wants most right now, if anything */
export function wants(l: LevelDef, a: Agent): string | null {
  let best: string | null = null;
  for (const n of l.needs) if (a.needs[n.id] < l.threshold && (!best || a.needs[n.id] < a.needs[best])) best = n.id;
  return best;
}

/** whole stars: points from what has been bought, plus up to one for how content everyone is */
export function stars(w: World, l: LevelDef) {
  const home = w.agents.filter(housed);
  const happy = home.length ? home.filter((a) => mood(l, a) === "ok").length / home.length : 0;
  return Math.min(MAX_STARS, Math.floor(w.points + happy + 1e-9));
}

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
function setGoal(w: World, l: LevelDef, a: Agent, to: Pt) {
  const end = a.path[a.path.length - 1];
  if (end && dist(end, to) < 1) return;
  if (!end && dist(a, to) < 1) return;
  a.path = route(w, l, a, to);
}

// walls and the walking grid change only when something is bought, so keep them
const cache = new Map<string, { walls: Rect[]; nav: Nav }>();
function world(w: World, l: LevelDef, agents: boolean) {
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
const wallsFor = (w: World, l: LevelDef) => world(w, l, false).walls;
/** the way from here to there, round the walls: agents may use residents-only doors, actors may not */
export function route(w: World, l: LevelDef, a: Agent, to: Pt) {
  return navRoute(world(w, l, a.kind === "agent").nav, a, to);
}

function seatFree(w: World, st: string, s: number) {
  return !w.agents.some((a) => a.station === st && a.seat === s && (a.state === "go" || a.state === "use"));
}

export function step(w: World, levels: LevelDef[], stick: Stick) {
  const l = levels[w.level];
  w.steps++;
  for (const a of w.agents) a.moving = false;
  const live = new Set<string>();

  // the player: the stick is a direction, at most full speed, stopped by walls
  const p = player(w);
  const len = Math.hypot(stick.x, stick.y);
  if (len > 0.05) {
    const k = len > 1 ? 1 / len : 1;
    const before = { x: p.x, y: p.y };
    p.x += stick.x * k * PLAYER_SPEED * DT;
    p.y += stick.y * k * PLAYER_SPEED * DT;
    const spawn = stationsOf(l, "spawn")[0];
    p.x = Math.min(l.size.w - BODY, Math.max(BODY, p.x));
    p.y = Math.min((spawn?.roadY ?? l.size.h) - 30, Math.max(BODY, p.y));
    collide(p, BODY, wallsFor(w, l));
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
      if (a.trail.length > 90) a.trail.length = 90;
    }

  spawn(w, l);

  for (const a of w.agents.filter(isActor)) {
    const line = followers(w, a);
    // walk past a waiting agent and it joins the line
    if (a.kind === "player" || a.kind === "escort") {
      const cap = LINE_CAP[a.kind];
      for (const b of w.agents)
        if (b.state === "wait" && line.length < cap && near(b, a, PICKUP_RADIUS)) {
          b.state = "follow";
          b.leader = a.id;
          b.t = w.steps + line.length * 0.01;
          line.push(b);
        }
    }
    // a tag station: one follower at a time
    for (const st of stationsOf(l, "tag")) {
      const bare = line.find((b) => !b.tags.includes(st.tag));
      if (bare && near(a, st.at, st.r) && tick(w, `${a.id}:${st.id}`, st.every, live)) bare.tags.push(st.tag);
    }
    // a house door: followers ready to live there go in while there is room
    for (const st of stationsOf(l, "house")) {
      if (!isOpen(w, st.locked) || !near(a, st.at, st.r)) continue;
      const ready = line.find((b) => !st.requires || b.tags.includes(st.requires));
      const taken = w.agents.filter((b) => housed(b) && b.house === st.id).map((b) => b.slot);
      const slot = st.seats.findIndex((_, i) => !taken.includes(i));
      if (ready && slot >= 0 && tick(w, `${a.id}:${st.id}`, 0.25, live)) {
        ready.state = "enter";
        ready.leader = -1;
        ready.house = st.id;
        ready.slot = slot;
        ready.path = route(w, l, ready, st.seats[slot].at);
      }
    }
    // carriers: fill up at a source, put down at a sink
    if (a.kind === "player" || a.kind === "carrier") {
      const cap = a.kind === "player" ? w.carryMax : HELPER_CARRY;
      for (const st of stationsOf(l, "source"))
        if (near(a, st.at, st.r) && a.carry < cap && tick(w, `${a.id}:${st.id}`, st.every, live)) a.carry++;
      for (const st of stationsOf(l, "sink")) {
        const room = st.seats.filter((s) => isOpen(w, s.locked)).length;
        if (isOpen(w, st.locked) && inside(a, st.zone) && a.carry > 0 && (w.stock[st.id] ?? 0) < room && tick(w, `${a.id}:${st.id}`, st.every, live)) {
          a.carry--;
          w.stock[st.id] = (w.stock[st.id] ?? 0) + 1;
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

  // only the player picks up coins and pays pads
  const before = w.floor.length;
  w.floor = w.floor.filter((c) => !near(c, p, COIN_R));
  w.coins += before - w.floor.length;
  const pad = l.pads.find((x) => padVisible(w, x) && near(p, x.at, PAD_R));
  if (pad && w.coins > 0 && stars(w, l) >= (pad.stars ?? 0)) {
    w.clock.pad = (w.clock.pad ?? 0) + DT * Math.max(4, pad.cost);
    live.add("pad");
    while (w.clock.pad >= 1 && w.coins > 0 && (w.paid[pad.id] ?? 0) < pad.cost) {
      w.clock.pad--;
      w.coins--;
      w.paid[pad.id] = (w.paid[pad.id] ?? 0) + 1;
    }
    if (w.paid[pad.id] >= pad.cost) buy(w, levels, pad);
  }

  // followers walk the leader's trail, so they come through the same doors
  for (const a of w.agents.filter(isActor)) {
    followers(w, a).forEach((b, i) => {
      const target = alongTrail(a, (i + 1) * FOLLOW_GAP);
      if (!near(b, target, 1.5)) walkTo(b, target, (a.kind === "player" ? PLAYER_SPEED : HELPER_SPEED) * 1.15);
    });
  }

  agents(w, l);
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

function buy(w: World, levels: LevelDef[], pad: PadDef) {
  const l = levels[w.level];
  w.bought.push(pad.id);
  w.points += pad.points;
  delete w.clock.pad;
  const u = pad.unlock;
  if (u.carry) w.carryMax = u.carry;
  if (u.helper) {
    const h = agent(w.nextId++, u.helper, l.helperHome, 0, l);
    w.agents.push(h);
  }
  if (u.level && levels[w.level + 1]) Object.assign(w, create(levels, w.level + 1, w.rng), { steps: w.steps });
}

function spawn(w: World, l: LevelDef) {
  const st = stationsOf(l, "spawn")[0];
  if (!st) return;
  const ride = w.ride, room = capacity(w, l) - population(w);
  const speed = 180;
  if (ride.state === "away") {
    ride.t -= DT;
    if (ride.t <= 0 && room > 0 && !w.agents.some((a) => a.state === "wait")) {
      ride.state = "in";
      ride.x = -100;
    }
  } else if (ride.state === "in") {
    ride.x = Math.min(st.stopX, ride.x + speed * DT);
    if (ride.x === st.stopX) {
      const n = Math.min(st.load, room, st.wait.length);
      for (let i = 0; i < n; i++) w.agents.push(agent(w.nextId++, "agent", st.wait[i], Math.floor(rand(w) * l.looks), l));
      ride.state = "out";
    }
  } else {
    ride.x += speed * DT;
    if (ride.x > l.size.w + 100) {
      ride.state = "away";
      ride.t = st.gap;
    }
  }
}

/** a seat somewhere that meets this need right now */
function findSeat(w: World, l: LevelDef, need: string) {
  for (const st of l.stations) {
    if ((st.kind !== "sink" && st.kind !== "facility") || st.need !== need) continue;
    if (st.kind === "sink") {
      if (!isOpen(w, st.locked)) continue;
      const going = w.agents.filter((a) => a.station === st.id && (a.state === "go" || a.state === "use")).length;
      if ((w.stock[st.id] ?? 0) - going <= 0) continue;
    }
    for (let s = 0; s < st.seats.length; s++) {
      if (!isOpen(w, st.seats[s].locked) || !seatFree(w, st.id, s)) continue;
      if (st.kind === "facility" && w.messes.some((m) => m.station === st.id && m.seat === s)) continue;
      return { st, s };
    }
  }
  return null;
}

function agents(w: World, l: LevelDef) {
  for (const a of w.agents) {
    if (a.kind !== "agent") continue;
    const home = () => l.stations.find((s) => s.id === a.house) as Station<"house">;
    if (a.state === "enter" || a.state === "back") {
      if (walkPath(a, AGENT_SPEED)) a.state = "home";
    } else if (a.state === "home") {
      for (const n of l.needs) a.needs[n.id] = Math.max(0, a.needs[n.id] - DT / n.decay);
      if (mood(l, a) === "ok") {
        a.t += DT;
        if (a.t >= l.coinEvery) {
          a.t = 0;
          const h = home();
          if (w.floor.filter((c) => c.house === h.id).length < l.coinsPerHouse)
            w.floor.push({ x: h.coinAt.x + (rand(w) - 0.5) * 36, y: h.coinAt.y + (rand(w) - 0.5) * 14, house: h.id });
        }
      } else {
        // off to whatever it wants most that is ready for it
        const order = l.needs.filter((n) => a.needs[n.id] < l.threshold).sort((x, y) => a.needs[x.id] - a.needs[y.id]);
        for (const n of order) {
          const got = findSeat(w, l, n.id);
          if (!got) continue;
          a.state = "go";
          a.station = got.st.id;
          a.seat = got.s;
          a.path = route(w, l, a, (got.st as Station<"sink">).seats[got.s].at);
          break;
        }
      }
    } else if (a.state === "go") {
      if (walkPath(a, AGENT_SPEED)) {
        a.state = "use";
        a.t = 0;
      }
    } else if (a.state === "use") {
      const st = l.stations.find((s) => s.id === a.station) as Station<"sink"> | Station<"facility">;
      a.t += DT;
      if (a.t >= st.use) {
        a.needs[st.need] = 1;
        if (st.kind === "sink") w.stock[st.id] = Math.max(0, (w.stock[st.id] ?? 0) - 1);
        else {
          const at = st.seats[a.seat].messAt ?? st.seats[a.seat].at;
          w.messes.push({ id: w.nextId++, kind: st.mess, x: at.x, y: at.y, station: st.id, seat: a.seat, clean: 0 });
        }
        a.t = 0;
        a.state = "back";
        a.station = "";
        a.seat = -1;
        a.path = route(w, l, a, home().seats[a.slot].at);
      }
    }
  }
}

/** hired help: each picks a place to be from what needs doing, and walks there through the doors */
function helpers(w: World, l: LevelDef) {
  for (const h of w.agents) {
    let goal: Pt = l.helperHome;
    if (h.kind === "carrier") {
      const source = stationsOf(l, "source")[0];
      const sinks = stationsOf(l, "sink").filter((s) => isOpen(w, s.locked));
      const room = sinks.find((s) => (w.stock[s.id] ?? 0) < s.seats.filter((x) => isOpen(w, x.locked)).length);
      const filling = source && near(h, source.at, source.r) && h.carry < HELPER_CARRY;
      if (room && (h.carry === 0 || filling)) goal = source.at;
      else if (room && h.carry > 0) goal = room.at;
    } else if (h.kind === "cleaner") {
      const m = [...w.messes].sort((a, b) => a.id - b.id)[0];
      if (m) goal = m;
    } else if (h.kind === "escort") {
      const line = followers(w, h);
      const waiting = w.agents.find((a) => a.state === "wait");
      const tag = stationsOf(l, "tag")[0];
      if (!line.length) {
        if (waiting) goal = waiting;
      } else if (tag && line.some((b) => !b.tags.includes(tag.tag))) goal = tag.at;
      else {
        const house = stationsOf(l, "house").find((s) => {
          if (!isOpen(w, s.locked)) return false;
          return w.agents.filter((b) => housed(b) && b.house === s.id).length < s.seats.length;
        });
        if (house) goal = house.at;
      }
    } else continue;
    setGoal(w, l, h, goal);
    walkPath(h, HELPER_SPEED);
  }
}

/** what to do next, as a key the content turns into words */
export type Hint =
  | { key: "pickup" | "tag" | "house" | "full" | "clean" | "coins" | "pad" | "stars" | "idle" }
  | { key: "fetch" | "drop"; need: string };
export function hint(w: World, l: LevelDef): Hint {
  const line = followers(w, player(w));
  const tag = stationsOf(l, "tag")[0];
  if (tag && line.some((b) => !b.tags.includes(tag.tag))) return { key: "tag" };
  if (line.length) return population(w) <= capacity(w, l) ? { key: "house" } : { key: "full" };
  for (const sink of stationsOf(l, "sink")) {
    const asking = w.agents.filter((a) => a.state === "home" && wants(l, a) === sink.need).length;
    const stock = stationsOf(l, "sink").reduce((n, s) => n + (w.stock[s.id] ?? 0), 0);
    if (asking > stock) return { key: player(w).carry ? "drop" : "fetch", need: sink.need };
  }
  if (w.messes.length) return { key: "clean" };
  if (w.agents.some((a) => a.state === "wait")) return { key: "pickup" };
  if (w.floor.length) return { key: "coins" };
  const s = stars(w, l);
  const open = l.pads.filter((x) => padVisible(w, x) && w.coins >= x.cost - (w.paid[x.id] ?? 0));
  if (open.some((x) => s >= (x.stars ?? 0))) return { key: "pad" };
  if (open.length) return { key: "stars" };
  return { key: "idle" };
}

/** a saved game, or null when the slot holds nothing we can trust */
export function restore(raw: string | null, levels: LevelDef[]): World | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as World;
    if (
      w?.v !== 2 ||
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
