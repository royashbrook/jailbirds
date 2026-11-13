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
import type {
  Agent, AgentKind, AnyStation, BoostKind, Fairy, LevelDef, Mess, Mood, MountKind, PadDef, Pt, Rect, ReleaseDef, Stick, Took, World,
} from "./types.ts";

export const DT = 1 / 60;
export const AGENT_SPEED = 80;
export const HELPER_SPEED = 85;
export const PICKUP_RADIUS = 40;
export const FOLLOW_GAP = 18;
export const HELPER_LINE = 2;
export const HELPER_CARRY = 4;
export const CLEAN_TIME = 0.4;
/** how long the player stands still by someone before they join the line, in seconds.
 * helpers still pick people up the moment they get there */
export const HOLD = 0.6;
/** how much faster than their leader the player's followers catch up: each a little
 * different, by id and a slow swing over time, never down to the leader's own speed */
export const CATCH_MIN = 1.1;
export const CATCH_MAX = 1.3;
const BODY = 10;
const PAD_R = 24;
/** how long to stand still on a pad before it starts taking coins, in seconds. walking
 * never pays, so this only has to be long enough that brushing to a stop on one is not a yes */
export const PAD_WAIT = 0.2;
/** how far apart idle helpers stand */
const IDLE_GAP = 16;
const MESS_R = 20;
const COIN_R = 24;
const PILE_R = 30;
/** the least a desk's pile must hold before a collector walks over for it */
export const COLLECT_MIN = 6;
const BOOST_R = 22;
const ALERT_R = 40;
const TRAIL_STEP = 3;
/** seconds home before a resident asks to be led anywhere */
export const SETTLE = 2;
/** the way out of the release desk: seconds someone set free stands at the desk for their papers,
 * and how far into that the stamp comes down on them */
export const STAMP_HOLD = 0.8;
export const STAMP_AT = 0.4;
/** how far apart people stand side by side at the release desk, and how many places there are */
const STAMP_GAP = 16;
const STAMP_SPOTS = 4;
/** where the stamp comes down on the release desk: three quarters along it */
export const stampAt = (st: ReleaseDef): Pt => ({ x: st.prop.x + st.prop.w * 0.75, y: st.prop.y + st.prop.h / 2 });
/** where someone set free stands for their papers: by the stamp, on the side of the desk the actor stands,
 * the next one along beside them */
export const stampSpot = (st: ReleaseDef, place: number): Pt => ({ x: stampAt(st).x + (place % STAMP_SPOTS) * STAMP_GAP, y: st.at.y });
/** someone at the release desk whose papers have been stamped, or on the way out after */
export const stamped = (a: Agent) => a.state === "leave" || (a.state === "stamp" && a.t >= STAMP_AT - 1e-9);

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
    boostKind: "skates", mountKind: "skates", fairy: idleFairy(), picked: { n: 0, kind: "skates" }, took: noneTaken(), grab: null,
  };
}
const noneTaken = (): Took => ({ n: 0, floor: 0, rank: 0, piles: {} });
const idleFairy = (): Fairy => ({ todo: [], visits: 0, x: 0, y: 0, target: null, t: 0 });
function agent(id: number, kind: AgentKind, at: Pt, look: number, l: LevelDef): Agent {
  return {
    id, kind, x: at.x, y: at.y, face: 1, moving: false, walk: 0, look, tags: [], state: kind === "agent" ? "arrive" : "idle",
    leader: -1, house: "", slot: -1, station: "", seat: -1,
    needs: kind === "agent" ? Object.fromEntries(l.needs.map((n) => [n.id, n.start])) : {},
    served: 0, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
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
    w.took.rank += l.rankReward * w.rank;
  }
}

/** how much faster the player goes right now: what it rides, while the boost lasts */
export const boostMult = (w: World, l: LevelDef) => (w.boosted > 0 ? l.boost.kinds[w.mountKind].mult : 1);

/** the kind for a roll in [0, 1) over weighted kinds, in their order. pure, so the edges can be pinned */
export function pickBoost(roll: number, kinds: [BoostKind, number][]): BoostKind {
  const total = kinds.reduce((n, [, weight]) => n + weight, 0);
  let at = roll * total;
  for (const [kind, weight] of kinds) {
    if (at < weight) return kind;
    at -= weight;
  }
  return kinds[kinds.length - 1][0];
}
/** what may turn up now: the fairy only when there is a mess for her to clean */
export function boostChoices(w: World, l: LevelDef): [BoostKind, number][] {
  const k = l.boost.kinds;
  const out: [BoostKind, number][] = [["skates", k.skates.weight], ["unicorn", k.unicorn.weight]];
  if (w.messes.length > 0) out.push(["fairy", k.fairy.weight]);
  return out;
}

/** a mess is gone: the one way a mess leaves, so its seat opens the same way whoever cleaned it */
function cleanUp(w: World, m: Mess) {
  w.messes = w.messes.filter((x) => x.id !== m.id);
}
const nearestMess = (messes: Mess[], at: Pt) =>
  messes.reduce<Mess | null>((best, m) => (!best || dist(m, at) < dist(best, at) ? m : best), null);

/** the fairy's next mess: the nearest of those on her list still there. one cleaned by someone
 * else drops off the list; with none left, she is done */
function fairyNext(w: World) {
  const f = w.fairy;
  f.todo = f.todo.filter((id) => w.messes.some((m) => m.id === id));
  const next = nearestMess(w.messes.filter((m) => f.todo.includes(m.id)), f);
  f.t = 0;
  if (!next) {
    w.fairy = { ...idleFairy(), x: f.x, y: f.y, visits: f.visits };
    return null;
  }
  f.target = next.id;
  f.todo = f.todo.filter((id) => id !== next.id);
  return next;
}

/** the fairy flies to a mess, cleans it, and on to the next nearest on her list, until the list is done */
function fairy(w: World, l: LevelDef) {
  const f = w.fairy;
  if (f.target === null) return;
  const m = w.messes.find((x) => x.id === f.target) ?? fairyNext(w);
  if (!m) return;
  f.t += DT;
  const rest = l.boost.kinds.fairy.visit - f.t;
  if (rest > 1e-9) {
    // so she lands just as the visit is up, however far it is
    const share = DT / (rest + DT);
    f.x += (m.x - f.x) * share;
    f.y += (m.y - f.y) * share;
    return;
  }
  f.x = m.x;
  f.y = m.y;
  cleanUp(w, m);
  f.visits++;
  fairyNext(w);
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
    const k = len > 1 ? 1 / len : 1, speed = w.speed * boostMult(w, l);
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
  // a hold needs the stick let go and the player not moving at all
  const still = len <= 0.05 && !p.moving;
  for (const a of w.agents.filter(isActor)) act(w, l, a, live, still);
  // a helper who took the one being held this same step ends the hold now, not a step late
  if (w.grab) {
    const b = w.agents.find((x) => x.id === w.grab!.id);
    if (!b || b.state === "follow") w.grab = null;
  }

  // only the player picks up coins, piles and boosts, pays pads and settles squabbles.
  // each pickup is written down here, where it happens, for the screen to read
  const before = w.floor.length;
  w.floor = w.floor.filter((c) => !near(c, p, COIN_R));
  const got = before - w.floor.length;
  if (got) {
    w.coins += got;
    w.took.floor += got;
    w.took.n++;
  }
  for (const st of l.stations)
    if ((st.kind === "checkin" || st.kind === "release" || st.kind === "safe") && (w.piles[st.id] ?? 0) > 0 && near(p, st.pileAt, PILE_R)) {
      w.coins += w.piles[st.id];
      w.took.piles[st.id] = (w.took.piles[st.id] ?? 0) + w.piles[st.id];
      w.took.n++;
      w.piles[st.id] = 0;
    }
  // after the player, so a pile both reach in the same step is the player's
  collect(w, l);
  if (w.boost.here && near(p, w.boost, BOOST_R)) {
    w.boost.here = false;
    w.boost.t = l.boost.every;
    if (w.boostKind === "fairy" && w.messes.length) {
      // she takes on the messes there are now, and only those
      w.fairy = { todo: w.messes.map((m) => m.id), visits: 0, x: p.x, y: p.y, target: null, t: 0 };
      fairyNext(w);
      w.picked = { n: w.picked.n + 1, kind: "fairy" };
    } else {
      // a ride, or a fairy picked up once the floor is clean already: then it is skates
      const ride: MountKind = w.boostKind === "unicorn" ? "unicorn" : "skates";
      w.mountKind = ride;
      w.boosted = l.boost.kinds[ride].time;
      w.picked = { n: w.picked.n + 1, kind: ride };
    }
  } else if (!w.boost.here) {
    w.boost.t -= DT;
    if (w.boost.t <= 0 && l.boost.spots.length) {
      const at = l.boost.spots[Math.floor(rand(w) * l.boost.spots.length)];
      w.boost = { x: at.x, y: at.y, here: true, t: 0 };
      w.boostKind = pickBoost(rand(w), boostChoices(w, l));
    }
  }
  fairy(w, l);
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
    const speed = a.kind === "player" ? w.speed * boostMult(w, l) : HELPER_SPEED;
    followers(w, a).forEach((b, i) => {
      const target = alongTrail(a, (i + 1) * FOLLOW_GAP);
      const k = a.kind === "player" ? catchUp(b.id, w.steps) : 1.15;
      if (!near(b, target, 1.5)) walkTo(b, target, speed * k);
    });
  }

  residents(w, l);
  for (const k of Object.keys(w.clock)) if (!live.has(k)) delete w.clock[k];
}

/** how much faster than the player one of its followers walks to catch up: its own share by id,
 * and a slow swing by step so the line stretches and bunches. always between CATCH_MIN and CATCH_MAX */
export function catchUp(id: number, steps: number) {
  const own = (id * 0.6180339887) % 1;
  const swing = 0.5 + 0.5 * Math.sin(steps * DT * 1.7 + own * 6.283);
  return CATCH_MIN + (CATCH_MAX - CATCH_MIN) * (0.6 * own + 0.4 * swing);
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
function act(w: World, l: LevelDef, a: Agent, live: Set<string>, still: boolean) {
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

  // pick up whoever checked in, or residents waiting at their door to be led somewhere.
  // a helper takes them all at once; the player stands still by them one at a time
  if (leads) {
    const can: Agent[] = [];
    for (const b of w.agents) if (b.state === "ready" && near(b, a, PICKUP_RADIUS)) can.push(b);
    for (const h of all(l, "house"))
      if (isOpen(w, h.locked) && near(a, h.at, h.r))
        for (const b of w.agents) if (b.house === h.id && waiting(l, b)) can.push(b);
    if (a.kind === "player") hold(w, can, still && line.length < cap, join);
    else for (const b of can) join(b);
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
      // newcomers move in while there is a bed; residents with nothing to do go back in.
      // a helper hands them over one every quarter second, the player all that fit at once
      const freeSlot = () => {
        const taken = w.agents.filter((b) => b.house === st.id).map((b) => b.slot);
        return st.seats.findIndex((_, i) => !taken.includes(i));
      };
      const isFresh = (b: Agent) => !b.house && (!st.requires || b.tags.includes(st.requires));
      const moveIn = (b: Agent, slot: number) => {
        b.house = st.id;
        b.slot = slot;
        b.state = "enter";
        b.leader = -1;
        b.served = 0;
        b.path = route(w, l, b, st.seats[slot].at);
      };
      if (a.kind === "player") {
        for (const b of line) {
          const slot = freeSlot();
          if (slot < 0) break;
          if (b.state === "follow" && isFresh(b)) moveIn(b, slot);
        }
      } else {
        const slot = freeSlot();
        const fresh = line.find(isFresh);
        if (fresh && slot >= 0 && tick(w, key, 0.25, live)) moveIn(fresh, slot);
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
      // a helper hands over one each `every` seconds; the player sees off everyone done at once
      if (a.kind === "player") {
        for (const b of line) if (b.state === "follow" && isDone(l, b)) release(w, l, b, st);
      } else {
        const done = line.find((b) => isDone(l, b));
        if (done && tick(w, key, st.every, live)) release(w, l, done, st);
      }
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
      if (m.clean >= CLEAN_TIME) cleanUp(w, m);
    }
  }
}

/** the player's pickup: standing still by someone who may join fills a hold, and when it is full they
 * join. one at a time, the lowest id first, and the same one until they join or the hold breaks:
 * moving, a full line, or them no longer there to take ends it, and none of it goes to the next one */
function hold(w: World, can: Agent[], ok: boolean, join: (b: Agent) => void) {
  let b = w.grab ? can.find((x) => x.id === w.grab!.id) : undefined;
  if (!ok || !b) w.grab = null;
  if (!ok) return;
  if (!b) {
    b = can.reduce<Agent | undefined>((m, x) => (!m || x.id < m.id ? x : m), undefined);
    if (!b) return;
    w.grab = { id: b.id, t: 0 };
  }
  const g = w.grab!;
  g.t += DT;
  // a little slack so 36 steps of 1/60 make the 0.6, whatever the rounding
  if (g.t < HOLD - 1e-9) return;
  w.grab = null;
  join(b);
}

/** set free: paid, counted and starred here, once. what follows is only the way out: up to the
 * desk for the stamp, then out through the exit (see residents) */
function release(w: World, l: LevelDef, b: Agent, st: ReleaseDef) {
  const taken = w.agents.filter((a) => a.state === "stamp" && a.station === st.id).map((a) => a.seat);
  let place = 0;
  while (taken.includes(place)) place++;
  b.state = "stamp";
  b.leader = -1;
  b.house = "";
  b.slot = -1;
  b.station = st.id;
  b.seat = place;
  b.t = 0;
  b.path = route(w, l, b, stampSpot(st, place));
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
  if (u.level && levels[w.level + 1]) {
    // the safe and whatever a collector was carrying to it move on to the new place, once; the rest starts fresh
    const kept = banked(w, l);
    Object.assign(w, create(levels, w.level + 1, w.rng), { steps: w.steps });
    const safe = all(levels[w.level], "safe")[0];
    if (safe && kept) w.piles[safe.id] = kept;
  }
}
/** coins in the safe and in collectors' hands */
const banked = (w: World, l: LevelDef) =>
  all(l, "safe").reduce((n, s) => n + (w.piles[s.id] ?? 0), 0) + w.agents.reduce((n, a) => n + a.cash, 0);

/** a collector's pile: the fuller of the desks' piles, once it holds enough to be worth the walk */
function collectFrom(w: World, l: LevelDef) {
  let best: S<"checkin"> | ReleaseDef | null = null;
  for (const st of l.stations)
    if ((st.kind === "checkin" || st.kind === "release") && (w.piles[st.id] ?? 0) >= COLLECT_MIN && (!best || w.piles[st.id] > w.piles[best.id]))
      best = st;
  return best;
}
/** collectors at work: with empty hands, sweep up the pile they came for; with coins, put them in the safe */
function collect(w: World, l: LevelDef) {
  const safe = all(l, "safe")[0];
  if (!safe) return;
  for (const h of w.agents) {
    if (h.kind !== "collector") continue;
    if (h.cash > 0) {
      if (near(h, safe.at, safe.r)) {
        w.piles[safe.id] = (w.piles[safe.id] ?? 0) + h.cash;
        h.cash = 0;
      }
      continue;
    }
    const st = collectFrom(w, l);
    if (st && near(h, st.pileAt, PILE_R)) {
      h.cash = w.piles[st.id];
      w.piles[st.id] = 0;
    }
  }
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
    } else if (a.state === "stamp") {
      // walk up to the desk, stand while the stamp comes down on the papers, then out the way
      // everyone goes. `t` is seconds stood at the desk, nothing else, in this state
      if (!walkPath(a, AGENT_SPEED)) continue;
      a.t += DT;
      if (a.t < STAMP_HOLD - 1e-9) continue;
      const st = byId(l, a.station);
      a.state = "leave";
      a.station = "";
      a.seat = -1;
      a.path = st?.kind === "release" ? st.exit.flatMap((pt, i) => (i ? [pt] : route(w, l, a, pt))) : [];
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
  // what each guard is already going to fetch this step, so two guards never go for the same one
  const claimed = new Set<string>();
  let k = 0;
  for (const h of w.agents) {
    if (h.kind === "player" || h.kind === "agent") continue;
    // with nothing to do, helpers stand in rows of three around their home spot, not on top of each other
    const home = l.helperHome;
    let goal: Pt = { x: home.x + ((k % 3) - 1) * IDLE_GAP, y: home.y + Math.floor(k / 3) * IDLE_GAP };
    k++;
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
      goal = escortGoal(w, l, h, claimed) ?? goal;
    } else if (h.kind === "collector") {
      // coins in hand go to the safe before any more are fetched; never from the safe, never off the floor
      const safe = all(l, "safe")[0];
      if (h.cash > 0) goal = safe?.at ?? goal;
      else goal = collectFrom(w, l)?.pileAt ?? goal;
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
function escortGoal(w: World, l: LevelDef, h: Agent, claimed: Set<string>): Pt | null {
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
  // with nobody in line: the first checked-in newcomer, or the first door with someone
  // waiting, that no other guard has picked this step
  const ready = w.agents.find((b) => b.state === "ready" && !claimed.has(`a${b.id}`));
  if (ready) {
    claimed.add(`a${ready.id}`);
    return ready;
  }
  for (const b of w.agents) {
    if (!waiting(l, b) || claimed.has(`h${b.house}`)) continue;
    const need = wants(l, b, true);
    if (isDone(l, b) || l.stations.some((st) => need && roomOf(st) && seatFor(w, st, need, b) >= 0)) {
      claimed.add(`h${b.house}`);
      return (byId(l, b.house) as S<"house">).at;
    }
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
    const back: World = { ...create(levels, w.level), ...w, clock: {} };
    // saves from before the surprises, or with a surprise we cannot read, get the quiet default
    const got = w as Partial<Record<"boostKind" | "mountKind" | "fairy" | "picked", unknown>>;
    const kind = (k: unknown): BoostKind => (k === "unicorn" || k === "fairy" ? k : "skates");
    back.boostKind = kind(got.boostKind);
    back.mountKind = got.mountKind === "unicorn" ? "unicorn" : "skates";
    back.fairy = fairyFrom(got.fairy);
    const pk = got.picked as { n?: unknown; kind?: unknown } | null | undefined;
    back.picked = { n: typeof pk?.n === "number" && Number.isFinite(pk.n) && pk.n >= 0 ? pk.n : 0, kind: kind(pk?.kind) };
    back.took = tookFrom((w as Partial<Record<"took", unknown>>).took);
    // a hold half done when the game was put away starts over: nobody joins off a stale timer
    back.grab = null;
    // a collector's coins are put in the safe on the way back in, so a reload never loses or doubles them
    const safe = all(levels[w.level], "safe")[0];
    for (const a of back.agents) {
      const cash = (a as Partial<Record<"cash", unknown>>).cash;
      a.cash = count(cash) ? cash : 0;
      if (safe && a.cash > 0) back.piles = { ...back.piles, [safe.id]: (back.piles[safe.id] ?? 0) + a.cash };
      a.cash = 0;
    }
    return back;
  } catch {
    return null;
  }
}
/** a whole number of coins, none less than none */
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** a saved record of what the player took, or a fresh one when it is missing or cannot be read */
function tookFrom(raw: unknown): Took {
  const t = raw as Partial<Took> | null;
  if (!t || typeof t !== "object" || ![t.n, t.floor, t.rank].every(count) || !t.piles || typeof t.piles !== "object") return noneTaken();
  const piles = Object.fromEntries(Object.entries(t.piles).filter(([, n]) => count(n)));
  return { n: t.n!, floor: t.floor!, rank: t.rank!, piles };
}
/** a saved fairy, whole and sane, or one at rest */
function fairyFrom(raw: unknown): Fairy {
  const f = raw as Partial<Fairy> | null;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!f || typeof f !== "object" || ![f.visits, f.x, f.y, f.t].every(num)) return idleFairy();
  if (f.target !== null && !num(f.target)) return idleFairy();
  const todo = Array.isArray(f.todo) ? f.todo.filter(num) : [];
  return { todo, visits: f.visits!, x: f.x!, y: f.y!, target: f.target ?? null, t: f.t! };
}
