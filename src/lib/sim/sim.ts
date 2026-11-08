// the jail, as plain data and one fixed step. no DOM, no clock, no Math.random:
// the same seed and the same stick give the same jail, so tests can play it.
import { roll } from "../rng.ts";
import {
  BUS_STOP_X, CELL_COUNT, CELL_ROOM, CELLS_OPEN, DESK_SPOT, KITCHEN_SPOT, MAP, PADS, SEATS, TABLES, TABLES_OPEN,
  WARDEN_START, cellDoor, cellSpot, seatSpot, waitSpot, type Pad, type Pt,
} from "./map.ts";

export const DT = 1 / 60;
export const WARDEN_SPEED = 120;
export const BIRD_SPEED = 90;
export const FOLLOW_RADIUS = 40;
export const FOLLOW_GAP = 16;
export const MAX_LINE = 8;
export const MAX_CARRY = 5;
export const BUS_LOAD = 3;
export const BUS_GAP = 3;
export const BUS_SPEED = 160;
/** a full bird gets hungry again after this many seconds */
export const FOOD_TIME = 45;
export const HUNGRY = 0.35;
export const EAT_TIME = 1.5;
export const COIN_TIME = 5;
export const COINS_PER_CELL = 8;
const STATION = 34;
const DOOR = 26;
const PAD = 22;
const PICKUP = 24;
const SHIRT_EVERY = 0.3;
const CELL_EVERY = 0.25;
const TRAY_EVERY = 0.3;
const DROP_EVERY = 0.2;

export type BirdState = "wait" | "follow" | "toCell" | "cell" | "toTable" | "eating" | "home";
export interface Bird {
  id: number;
  x: number;
  y: number;
  /** which of the bird colours */
  look: number;
  shirt: boolean;
  state: BirdState;
  cell: number;
  slot: number;
  table: number;
  seat: number;
  /** 1 is full, under HUNGRY is hungry, 0 is empty (no penalty, just no coins) */
  food: number;
  /** coin timer while in a cell, eating timer at a table */
  t: number;
}
export interface Coin { x: number; y: number; cell: number }
export interface World {
  v: 1;
  steps: number;
  rng: number;
  nextId: number;
  coins: number;
  carried: number;
  warden: { x: number; y: number; face: number; moving: boolean };
  birds: Bird[];
  /** the conga line, front first */
  line: number[];
  cells: boolean[];
  tables: { open: boolean; trays: number }[];
  /** coins paid into each price pad so far */
  paid: Record<string, number>;
  floor: Coin[];
  bus: { state: "away" | "in" | "out"; x: number; t: number };
  /** cadence timers for the stations, and the pad's coin flow */
  clock: { desk: number; cell: number; kitchen: number; table: number; pad: number };
}
export type Stick = { x: number; y: number };

export const BIRD_LOOKS = 6;

export function create(seed: number): World {
  return {
    v: 1,
    steps: 0,
    rng: seed >>> 0,
    nextId: 1,
    coins: 0,
    carried: 0,
    warden: { ...WARDEN_START, face: 1, moving: false },
    birds: [],
    line: [],
    cells: Array.from({ length: CELL_COUNT }, (_, i) => i < CELLS_OPEN),
    tables: TABLES.map((_, i) => ({ open: i < TABLES_OPEN, trays: 0 })),
    paid: {},
    floor: [],
    bus: { state: "away", x: -80, t: 1 },
    clock: { desk: 0, cell: 0, kitchen: 0, table: 0, pad: 0 },
  };
}

function rand(w: World) {
  const [v, next] = roll(w.rng);
  w.rng = next;
  return v;
}
const near = (a: Pt, b: Pt, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;
/** step a thing toward a point; true once it is there */
function walk(p: Pt, to: Pt, speed: number) {
  const dx = to.x - p.x, dy = to.y - p.y, d = Math.hypot(dx, dy), s = speed * DT;
  if (d <= s) {
    p.x = to.x;
    p.y = to.y;
    return true;
  }
  p.x += (dx / d) * s;
  p.y += (dy / d) * s;
  return false;
}
/** a station hands out one thing every `every` seconds while the warden stays */
function tick(w: World, key: keyof World["clock"], every: number) {
  w.clock[key] += DT;
  if (w.clock[key] < every) return false;
  w.clock[key] -= every;
  return true;
}

export const capacity = (w: World) => w.cells.filter(Boolean).length * CELL_ROOM;
const housed = (b: Bird) => b.state !== "wait" && b.state !== "follow";
const inCell = (w: World, c: number) => w.birds.filter((b) => housed(b) && b.cell === c);
const byId = (w: World, id: number) => w.birds.find((b) => b.id === id)!;

/** a pad shows once the thing before it is open; a cell pad waits for the cell to its left */
export function padVisible(w: World, p: Pad) {
  if ("cell" in p.unlock) return !w.cells[p.unlock.cell] && w.cells[p.unlock.cell - 1];
  return !w.tables[p.unlock.table].open;
}

export function step(w: World, stick: Stick) {
  w.steps++;
  const wd = w.warden;
  // the warden: the stick is a direction, at most full speed
  const len = Math.hypot(stick.x, stick.y);
  const k = len > 1 ? 1 / len : 1;
  wd.moving = len > 0.05;
  if (wd.moving) {
    wd.x = Math.min(MAP.width - 12, Math.max(12, wd.x + stick.x * k * WARDEN_SPEED * DT));
    wd.y = Math.min(MAP.height - 70, Math.max(110, wd.y + stick.y * k * WARDEN_SPEED * DT));
    if (Math.abs(stick.x) > 0.1) wd.face = Math.sign(stick.x);
  }

  // the bus: comes when the stop is empty and there is room, drops a few, drives off
  const bus = w.bus;
  if (bus.state === "away") {
    bus.t -= DT;
    const room = capacity(w) - w.birds.length;
    if (bus.t <= 0 && room > 0 && !w.birds.some((b) => b.state === "wait")) {
      bus.state = "in";
      bus.x = -80;
    }
  } else if (bus.state === "in") {
    bus.x = Math.min(BUS_STOP_X, bus.x + BUS_SPEED * DT);
    if (bus.x === BUS_STOP_X) {
      const n = Math.min(BUS_LOAD, capacity(w) - w.birds.length);
      for (let i = 0; i < n; i++) {
        const at = waitSpot(i);
        w.birds.push({
          id: w.nextId++, x: at.x, y: at.y, look: Math.floor(rand(w) * BIRD_LOOKS), shirt: false,
          state: "wait", cell: -1, slot: -1, table: -1, seat: -1, food: 0.3, t: 0,
        });
      }
      bus.state = "out";
    }
  } else {
    bus.x += BUS_SPEED * DT;
    if (bus.x > MAP.width + 80) {
      bus.state = "away";
      bus.t = BUS_GAP;
    }
  }

  // walk past a waiting bird and it joins the line
  for (const b of w.birds)
    if (b.state === "wait" && w.line.length < MAX_LINE && near(b, wd, FOLLOW_RADIUS)) {
      b.state = "follow";
      w.line.push(b.id);
    }

  // the desk: a striped shirt for each bird in the line, one at a time
  const bare = w.line.map((id) => byId(w, id)).find((b) => !b.shirt);
  if (bare && near(wd, DESK_SPOT, STATION)) {
    if (tick(w, "desk", SHIRT_EVERY)) bare.shirt = true;
  } else w.clock.desk = 0;

  // a cell door: shirted birds in the line go in while there is room
  const door = w.cells.findIndex((open, i) => open && near(wd, cellDoor(i), DOOR));
  const dressed = w.line.map((id) => byId(w, id)).find((b) => b.shirt);
  const taken = door >= 0 ? inCell(w, door) : [];
  if (door >= 0 && dressed && taken.length < CELL_ROOM) {
    if (tick(w, "cell", CELL_EVERY)) {
      w.line = w.line.filter((id) => id !== dressed.id);
      dressed.state = "toCell";
      dressed.cell = door;
      dressed.slot = [0, 1].find((s) => !taken.some((b) => b.slot === s))!;
    }
  } else w.clock.cell = 0;

  // the kitchen fills the warden's arms, a canteen table takes the trays
  if (near(wd, KITCHEN_SPOT, STATION) && w.carried < MAX_CARRY) {
    if (tick(w, "kitchen", TRAY_EVERY)) w.carried++;
  } else w.clock.kitchen = 0;
  const table = w.tables.findIndex((t, i) => t.open && atTable(wd, i));
  if (table >= 0 && w.carried > 0 && w.tables[table].trays < SEATS) {
    if (tick(w, "table", DROP_EVERY)) {
      w.carried--;
      w.tables[table].trays++;
    }
  } else w.clock.table = 0;

  // coins on the floor jump into the warden's pocket
  const before = w.floor.length;
  w.floor = w.floor.filter((c) => !near(c, wd, PICKUP));
  w.coins += before - w.floor.length;

  // a price pad drinks coins over about a second while the warden stands on it
  const pad = PADS.find((p) => padVisible(w, p) && near(wd, p.at, PAD));
  if (pad && w.coins > 0) {
    w.clock.pad += DT * pad.cost;
    while (w.clock.pad >= 1 && w.coins > 0 && (w.paid[pad.id] ?? 0) < pad.cost) {
      w.clock.pad--;
      w.coins--;
      w.paid[pad.id] = (w.paid[pad.id] ?? 0) + 1;
    }
    if (w.paid[pad.id] >= pad.cost) {
      if ("cell" in pad.unlock) w.cells[pad.unlock.cell] = true;
      else w.tables[pad.unlock.table].open = true;
      w.clock.pad = 0;
    }
  } else w.clock.pad = 0;

  // the birds
  let leader: Pt = wd;
  for (const id of w.line) {
    const b = byId(w, id);
    if (!near(b, leader, FOLLOW_GAP)) {
      const dx = b.x - leader.x, dy = b.y - leader.y, d = Math.hypot(dx, dy);
      walk(b, { x: leader.x + (dx / d) * FOLLOW_GAP, y: leader.y + (dy / d) * FOLLOW_GAP }, WARDEN_SPEED * 1.1);
    }
    leader = b;
  }
  for (const b of w.birds) {
    if (b.state === "toCell" || b.state === "home") {
      if (walk(b, cellSpot(b.cell, b.slot), BIRD_SPEED)) b.state = "cell";
    } else if (b.state === "cell") {
      b.food = Math.max(0, b.food - DT / FOOD_TIME);
      if (b.food >= HUNGRY) {
        b.t += DT;
        if (b.t >= COIN_TIME) {
          b.t = 0;
          if (w.floor.filter((c) => c.cell === b.cell).length < COINS_PER_CELL) {
            const at = cellDoor(b.cell);
            w.floor.push({ x: at.x + (rand(w) - 0.5) * 36, y: at.y + (rand(w) - 0.5) * 14, cell: b.cell });
          }
        }
      } else {
        const seat = freeSeat(w);
        if (seat) {
          b.state = "toTable";
          b.table = seat.table;
          b.seat = seat.seat;
        }
      }
    } else if (b.state === "toTable") {
      if (walk(b, seatSpot(b.table, b.seat), BIRD_SPEED)) {
        b.state = "eating";
        b.t = 0;
      }
    } else if (b.state === "eating") {
      b.t += DT;
      if (b.t >= EAT_TIME) {
        w.tables[b.table].trays--;
        b.food = 1;
        b.t = 0;
        b.state = "home";
        b.table = b.seat = -1;
      }
    }
  }
}

export function atTable(p: Pt, t: number) {
  const r = TABLES[t];
  return p.x > r.x - 24 && p.x < r.x + r.w + 24 && p.y > r.y - 28 && p.y < r.y + r.h + 28;
}

/** a tray nobody has claimed and a seat to eat it on */
function freeSeat(w: World) {
  for (let t = 0; t < w.tables.length; t++) {
    if (!w.tables[t].open) continue;
    const diners = w.birds.filter((b) => (b.state === "toTable" || b.state === "eating") && b.table === t);
    if (w.tables[t].trays - diners.length <= 0) continue;
    for (let s = 0; s < SEATS; s++) if (!diners.some((b) => b.seat === s)) return { table: t, seat: s };
  }
  return null;
}

export const hungry = (b: Bird) => b.state === "cell" && b.food < HUNGRY;

/** one short line for the bottom of the screen: what to do next */
export function hint(w: World): string {
  const line = w.line.map((id) => byId(w, id));
  if (line.some((b) => !b.shirt)) return "take them to the desk for striped shirts";
  if (line.length) return w.birds.length <= capacity(w) ? "walk them to a cell with room" : "unlock a cell for them";
  if (w.birds.some((b) => b.state === "wait")) return "walk to the birds at the bus stop";
  const starving = w.birds.filter(hungry).length;
  const trays = w.tables.reduce((n, t) => n + t.trays, 0);
  if (starving > trays) return w.carried ? "drop the trays on the canteen table" : "hungry birds! grab trays in the kitchen";
  if (w.floor.length) return "pick up the coins by the cells";
  if (PADS.some((p) => padVisible(w, p) && w.coins >= p.cost - (w.paid[p.id] ?? 0)))
    return "stand on a price tag to unlock it";
  return "keep your birds fed and the coins coming";
}

/** a saved jail, or null when the slot holds nothing we can trust */
export function restore(raw: string | null): World | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as World;
    const fresh = create(0);
    if (
      w?.v !== 1 ||
      !Array.isArray(w.birds) ||
      !Array.isArray(w.line) ||
      !Array.isArray(w.floor) ||
      w.cells?.length !== fresh.cells.length ||
      w.tables?.length !== fresh.tables.length ||
      typeof w.coins !== "number" ||
      typeof w.warden?.x !== "number"
    )
      return null;
    return { ...fresh, ...w, clock: fresh.clock };
  } catch {
    return null;
  }
}
