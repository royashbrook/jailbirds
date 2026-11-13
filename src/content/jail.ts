// the jail, as data for the engine: our own layout. a cell block along the top
// (two beds and a toilet in each cell), the canteen, kitchen and showers across
// the middle, intake with its gate and desk by the road, and a release office.
// every room, station, need, price, pace and level gate lives here; the engine
// never says "jail" and the skins never decide what costs what.
import type { Hint } from "../engine/sim.ts";
import type { AnyStation, LevelDef, PadDef, Rect, RoomDef } from "../engine/types.ts";

const CELLS = 8;
const cellX = (i: number) => 28 + i * 84;
const cellMid = (i: number) => cellX(i) + 39;
const CELL_Y = 28;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
const cellLock = (i: number) => (i >= 2 ? `cell${i + 1}` : undefined);

function jail(n: number, scale: number, next: boolean): LevelDef {
  const cost = (c: number) => Math.round(c * scale);
  const rooms: RoomDef[] = [
    { id: "block", look: "block", rect: { x: 20, y: 20, w: 680, h: 250 }, doors: [{ side: "s", at: 300, width: 80 }], label: "cells" },
    ...Array.from({ length: CELLS }, (_, i): RoomDef => ({
      id: `c${i}`, look: "cell", rect: { x: cellX(i), y: CELL_Y, w: 78, h: 118 }, doors: [{ side: "s", at: 17, width: 44 }], locked: cellLock(i),
    })),
    { id: "canteen", look: "canteen", rect: { x: 20, y: 310, w: 260, h: 210 }, doors: [{ side: "e", at: 70, width: 70 }], label: "canteen" },
    { id: "kitchen", look: "kitchen", rect: { x: 320, y: 310, w: 150, h: 150 }, doors: [{ side: "w", at: 60, width: 60 }], label: "kitchen" },
    { id: "showers", look: "washroom", rect: { x: 500, y: 310, w: 200, h: 330 }, doors: [{ side: "w", at: 120, width: 70 }], label: "showers" },
    {
      id: "intake", look: "intake", rect: { x: 20, y: 560, w: 240, h: 200 },
      doors: [{ side: "n", at: 90, width: 60 }, { side: "s", at: 90, width: 60 }], label: "intake", labelAt: { x: 218, y: 736 },
    },
    {
      id: "release", look: "release", rect: { x: 500, y: 680, w: 200, h: 120 },
      doors: [{ side: "w", at: 30, width: 60 }, { side: "s", at: 70, width: 60 }], label: "release",
    },
  ];
  const table = (i: number): AnyStation => {
    const prop = { x: 60, y: 350 + i * 100, w: 150, h: 34 };
    return {
      id: `table${i + 1}`, kind: "sink", look: "table", prop, zone: grow(prop, 26), at: { x: 226, y: prop.y + 17 },
      item: "tray", every: 0.2, need: "food", use: 1.5, locked: i ? "table2" : undefined,
      seats: [0, 1, 2, 3, 4, 5].map((s) => ({ at: { x: 85 + (s % 3) * 50, y: s < 3 ? prop.y - 14 : prop.y + prop.h + 14 }, look: "stool" })),
    };
  };
  const stations: AnyStation[] = [
    { id: "bus", kind: "spawn", at: { x: 140, y: 806 }, roadY: 840, stopX: 150, load: 3, gap: 4, via: [{ x: 140, y: 745 }] },
    {
      id: "desk", kind: "checkin", look: "desk", prop: { x: 60, y: 600, w: 160, h: 30 }, at: { x: 140, y: 582 }, r: 26,
      queue: [650, 674, 698, 722].map((y) => ({ x: 140, y })), out: [655, 680, 705, 730].map((y) => ({ x: 228, y })),
      tag: "uniform", every: 0.6, pay: 2, pileAt: { x: 50, y: 700 }, gate: { x: 140, y: 745 },
    },
    ...Array.from({ length: CELLS }, (_, i): AnyStation => ({
      id: `c${i}`, kind: "house", room: `c${i}`, at: { x: cellMid(i), y: 184 }, r: 30, requires: "uniform",
      seats: [{ at: { x: cellX(i) + 18, y: CELL_Y + 30 } }, { at: { x: cellX(i) + 18, y: CELL_Y + 82 } }],
      locked: cellLock(i), coinAt: { x: cellMid(i), y: 176 },
    })),
    {
      id: "toilets", kind: "facility", look: "toilet", need: "toilet", use: 1.5, mess: "poop", messChance: 0.35,
      seats: Array.from({ length: CELLS }, (_, i) => ({
        at: { x: cellX(i) + 60, y: CELL_Y + 22 }, messAt: { x: cellX(i) + 52, y: CELL_Y + 80 }, house: `c${i}`, locked: cellLock(i),
      })),
    },
    { id: "stove", kind: "source", look: "stove", prop: { x: 340, y: 325, w: 110, h: 44 }, at: { x: 395, y: 412 }, r: 32, item: "tray", every: 0.3 },
    table(0),
    table(1),
    {
      id: "showers", kind: "facility", look: "shower", need: "wash", use: 2.5, mess: "puddle", messChance: 0.4,
      zone: { x: 500, y: 310, w: 200, h: 330 },
      seats: [0, 1, 2].map((i) => ({ at: { x: 545 + i * 60, y: 600 }, messAt: { x: 545 + i * 60, y: 556 }, locked: i ? `shower${i + 1}` : undefined })),
    },
    {
      id: "stamp", kind: "release", look: "stamp", prop: { x: 540, y: 722, w: 120, h: 24 }, at: { x: 600, y: 704 }, r: 26,
      exit: [{ x: 600, y: 818 }, { x: 790, y: 826 }], every: 0.6, pay: 10, pileAt: { x: 672, y: 774 },
    },
    // the commissary safe outside intake: the collector puts the desks' coins in, the player takes them out
    { id: "safe", kind: "safe", at: { x: 250, y: 785 }, r: 26, pileAt: { x: 220, y: 785 } },
  ];
  const cellPad = (i: number, c: number, rank: number): PadDef => ({
    id: `cell${i + 1}`, cost: cost(c), at: { x: cellMid(i), y: 184 }, rank, after: i > 2 ? `cell${i}` : undefined, unlock: { room: `c${i}` }, label: "cell",
  });
  const chain = (id: string, steps: [number, number, number][], at: { x: number; y: number }, label: string, key: "line" | "speed" | "carry"): PadDef[] =>
    steps.map(([c, rank, value], k) => ({
      id: `${id}${k + 1}`, cost: cost(c), at, rank, after: k ? `${id}${k}` : undefined, unlock: { [key]: value }, label,
    }));
  const pads: PadDef[] = [
    cellPad(2, 8, 1), cellPad(3, 15, 2), cellPad(4, 30, 3), cellPad(5, 40, 3), cellPad(6, 60, 4), cellPad(7, 80, 5),
    ...chain("line", [[15, 1, 3], [35, 3, 4], [60, 4, 5]], { x: 320, y: 590 }, "longer line", "line"),
    ...chain("speed", [[20, 2, 112], [40, 3, 128], [70, 5, 145]], { x: 320, y: 655 }, "faster shoes", "speed"),
    ...chain("trays", [[25, 2, 6]], { x: 320, y: 720 }, "bigger stack", "carry"),
    { id: "table2", cost: cost(30), at: { x: 135, y: 467 }, rank: 3, unlock: {}, label: "table" },
    { id: "shower2", cost: cost(20), at: { x: 605, y: 600 }, rank: 2, unlock: {}, label: "shower" },
    { id: "shower3", cost: cost(40), at: { x: 665, y: 600 }, rank: 4, after: "shower2", unlock: {}, label: "shower" },
    { id: "cook", cost: cost(50), at: { x: 420, y: 560 }, rank: 3, unlock: { helper: "carrier" }, label: "hire a cook" },
    { id: "guard", cost: cost(60), at: { x: 420, y: 625 }, rank: 3, unlock: { helper: "escort" }, label: "hire a guard" },
    // more guards come one at a time on the same spot, so more people can be led at once
    { id: "guard2", cost: cost(90), at: { x: 420, y: 625 }, rank: 5, after: "guard", unlock: { helper: "escort" }, label: "another guard" },
    { id: "guard3", cost: cost(120), at: { x: 420, y: 625 }, rank: 6, after: "guard2", unlock: { helper: "escort" }, label: "another guard" },
    { id: "clerk", cost: cost(70), at: { x: 420, y: 690 }, rank: 4, unlock: { helper: "clerk" }, label: "hire a clerk" },
    { id: "cleaner", cost: cost(70), at: { x: 420, y: 755 }, rank: 4, unlock: { helper: "cleaner" }, label: "hire a cleaner" },
    { id: "collector", cost: cost(100), at: { x: 420, y: 490 }, rank: 5, unlock: { helper: "collector" }, label: "hire a collector" },
  ];
  if (next) pads.push({ id: "next", cost: cost(200), at: { x: 320, y: 785 }, rank: 6, unlock: { level: true }, label: "next jail" });
  return {
    id: `jail${n}`, name: `jail ${n}`, size: { w: 720, h: 900 }, rooms, stations, pads,
    needs: [
      { id: "food", decay: 60, start: 0.5, escort: true },
      { id: "wash", decay: 90, start: 0.9, escort: true },
      { id: "toilet", decay: 50, start: 0.8, escort: false },
    ],
    start: { x: 330, y: 540 }, helperHome: { x: 380, y: 540 }, threshold: 0.35, serve: 75,
    rankStars: [2, 3, 3, 5, 7, 10], rankReward: 10, speed: 95, line: 2, carry: 3, looks: 6,
    coinEvery: 4 / scale, coinsPerHouse: 8,
    // skates most often, a unicorn ride now and then, and a fairy who cleans when there is a mess to clean
    boost: {
      spots: [{ x: 300, y: 290 }, { x: 480, y: 290 }, { x: 290, y: 540 }, { x: 470, y: 520 }, { x: 300, y: 800 }], every: 40,
      kinds: {
        // a minute each, and gentler than before: she found them "bonkers fast"
        skates: { time: 60, mult: 1.4, weight: 50 },
        unicorn: { time: 60, mult: 1.6, weight: 30 },
        fairy: { weight: 20, visit: 0.8 },
      },
    },
    fights: { every: 80, crossEvery: 25, settle: 1.2, reward: 6, minPop: 4 },
  };
}

export const LEVELS: LevelDef[] = [jail(1, 1, true), jail(2, 2, false)];

/** the little words that pop up in the world */
export const WORDS = { full: "max!", noBed: "no beds!" };

const NEEDS: Record<string, (noun: string) => string> = {
  food: (noun) => `hungry ${noun}! walk them to the canteen`,
  wash: (noun) => `smelly ${noun}! walk them to the showers`,
};

/** the line at the bottom of the screen. `noun` is the skin's word for the inmates */
export function hintText(h: Hint, noun: string): string {
  switch (h.key) {
    case "alert": return "uh oh, a squabble! run over and calm it down";
    case "checkin": return "stand behind the intake desk to check them in";
    case "nobed": return "no free beds! unlock another cell";
    case "pickup": return `walk up to the checked-in ${noun} to lead them`;
    case "house": return "lead them to a cell with a free bed";
    case "release": return "lead them to the release desk to set them free";
    case "done": return `some ${noun} served their time: fetch them from their cell`;
    case "errand": return NEEDS[h.need]?.(noun) ?? `walk the ${noun} where they want to go`;
    case "fetch": return "someone is waiting to eat: grab trays in the kitchen";
    case "drop": return "put the trays on the canteen table";
    case "clean": return "messy! walk over the mess to clean it";
    case "coins": return "walk over the coins to pick them up";
    case "pad": return "stand on a price tag to unlock it";
    case "rank": return "set more free to earn stars and level up";
    case "idle": return `keep your ${noun} happy`;
  }
}
