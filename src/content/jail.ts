// the jail, as data for the engine: our own layout. a cell block along the top,
// the canteen, kitchen and washroom across the middle, intake by the road with
// the bus stop. every room, station, need and price pad lives here; the engine
// never says "jail" and the skins never decide what costs what.
import type { Hint } from "../engine/sim.ts";
import type { LevelDef, PadDef, Rect, RoomDef, StationDef } from "../engine/types.ts";

const CELLS = 8;
const cellX = (i: number) => 28 + i * 84;
const cellMid = (i: number) => cellX(i) + 39;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

function jail(n: number, scale: number, next: boolean): LevelDef {
  const cost = (c: number) => Math.round(c * scale);
  const rooms: RoomDef[] = [
    { id: "block", look: "block", rect: { x: 20, y: 20, w: 680, h: 250 }, doors: [{ side: "s", at: 300, width: 80 }], label: "cells" },
    ...Array.from({ length: CELLS }, (_, i): RoomDef => ({
      id: `c${i}`, look: "cell", rect: { x: cellX(i), y: 28, w: 78, h: 118 },
      doors: [{ side: "s", at: 19, width: 40, actors: false }], locked: i >= 2 ? `cell${i + 1}` : undefined,
    })),
    { id: "canteen", look: "canteen", rect: { x: 20, y: 310, w: 260, h: 210 }, doors: [{ side: "e", at: 70, width: 70 }], label: "canteen" },
    { id: "kitchen", look: "kitchen", rect: { x: 320, y: 310, w: 150, h: 150 }, doors: [{ side: "w", at: 60, width: 60 }], label: "kitchen" },
    { id: "washroom", look: "washroom", rect: { x: 500, y: 310, w: 200, h: 350 }, doors: [{ side: "w", at: 130, width: 70 }], label: "washroom" },
    {
      id: "intake", look: "intake", rect: { x: 20, y: 560, w: 240, h: 200 },
      doors: [{ side: "n", at: 90, width: 60 }, { side: "s", at: 90, width: 60 }], label: "intake",
    },
  ];
  const table = (i: number): StationDef => {
    const prop = { x: 60, y: 350 + i * 100, w: 150, h: 34 };
    return {
      id: `table${i + 1}`, kind: "sink", look: "table", prop, zone: grow(prop, 26), at: { x: 226, y: prop.y + 17 },
      item: "tray", every: 0.2, need: "food", use: 1.5, locked: i ? "table2" : undefined,
      seats: [0, 1, 2, 3, 4, 5].map((s) => ({ at: { x: 85 + (s % 3) * 50, y: s < 3 ? prop.y - 14 : prop.y + prop.h + 14 }, look: "stool" })),
    };
  };
  const stations: StationDef[] = [
    {
      id: "bus", kind: "spawn", at: { x: 140, y: 800 }, roadY: 840, stopX: 150, load: 3, gap: 3,
      wait: [{ x: 105, y: 796 }, { x: 135, y: 796 }, { x: 165, y: 796 }],
    },
    { id: "desk", kind: "tag", look: "desk", prop: { x: 50, y: 600, w: 180, h: 34 }, at: { x: 140, y: 668 }, r: 34, tag: "uniform", every: 0.3 },
    ...Array.from({ length: CELLS }, (_, i): StationDef => ({
      id: `c${i}`, kind: "house", room: `c${i}`, at: { x: cellMid(i), y: 182 }, r: 30, requires: "uniform",
      seats: [{ at: { x: cellMid(i) - 17, y: 92 } }, { at: { x: cellMid(i) + 17, y: 92 } }],
      locked: i >= 2 ? `cell${i + 1}` : undefined, coinAt: { x: cellMid(i), y: 176 },
    })),
    { id: "stove", kind: "source", look: "stove", prop: { x: 340, y: 325, w: 110, h: 44 }, at: { x: 395, y: 412 }, r: 32, item: "tray", every: 0.3 },
    table(0),
    table(1),
    {
      id: "toilets", kind: "facility", look: "toilet", need: "toilet", use: 2, mess: "poop",
      seats: [0, 1, 2].map((i) => ({ at: { x: 672, y: 345 + i * 62 }, messAt: { x: 632, y: 345 + i * 62 }, locked: i ? `toilet${i + 1}` : undefined })),
    },
    {
      id: "showers", kind: "facility", look: "shower", need: "wash", use: 2.5, mess: "puddle",
      seats: [0, 1, 2].map((i) => ({ at: { x: 540 + i * 60, y: 632 }, messAt: { x: 540 + i * 60, y: 590 }, locked: i ? `shower${i + 1}` : undefined })),
    },
  ];
  const cellPad = (i: number, c: number, stars = 0): PadDef => ({
    id: `cell${i + 1}`, cost: cost(c), at: { x: cellMid(i), y: 182 }, stars, points: 0.5,
    after: i > 2 ? `cell${i}` : undefined, unlock: { room: `c${i}` }, label: "cell",
  });
  const pads: PadDef[] = [
    cellPad(2, 8),
    { id: "toilet2", cost: cost(12), at: { x: 632, y: 407 }, points: 0.5, unlock: {}, label: "toilet" },
    cellPad(3, 15),
    { id: "shower2", cost: cost(15), at: { x: 600, y: 590 }, points: 0.5, unlock: {}, label: "shower" },
    { id: "carry", cost: cost(20), at: { x: 395, y: 500 }, stars: 1, points: 0.5, unlock: { carry: 7 }, label: "big stack" },
    { id: "table2", cost: cost(25), at: { x: 135, y: 467 }, stars: 2, points: 1, unlock: {}, label: "table" },
    cellPad(4, 30, 2),
    cellPad(5, 40, 2),
    { id: "toilet3", cost: cost(30), at: { x: 632, y: 469 }, stars: 2, after: "toilet2", points: 0.5, unlock: {}, label: "toilet" },
    { id: "shower3", cost: cost(30), at: { x: 660, y: 590 }, stars: 2, after: "shower2", points: 0.5, unlock: {}, label: "shower" },
    { id: "cook", cost: cost(40), at: { x: 330, y: 600 }, stars: 2, points: 0.5, unlock: { helper: "carrier" }, label: "hire a cook" },
    { id: "cleaner", cost: cost(50), at: { x: 400, y: 600 }, stars: 3, points: 0.5, unlock: { helper: "cleaner" }, label: "hire a cleaner" },
    { id: "guard", cost: cost(60), at: { x: 470, y: 600 }, stars: 3, points: 0.5, unlock: { helper: "escort" }, label: "hire a guard" },
    cellPad(6, 60, 3),
    cellPad(7, 80, 4),
  ];
  if (next) pads.push({ id: "next", cost: cost(150), at: { x: 560, y: 740 }, stars: 5, points: 0, unlock: { level: true }, label: "next jail" });
  return {
    id: `jail${n}`, name: `jail ${n}`, size: { w: 720, h: 900 }, rooms, stations, pads,
    needs: [
      { id: "food", decay: 55, start: 0.3 },
      { id: "toilet", decay: 75, start: 0.9 },
      { id: "wash", decay: 95, start: 0.7 },
    ],
    start: { x: 380, y: 700 }, helperHome: { x: 400, y: 690 }, threshold: 0.35, carry: 4, looks: 6, coinEvery: 4 / scale, coinsPerHouse: 8,
  };
}

export const LEVELS: LevelDef[] = [jail(1, 1, true), jail(2, 2, false)];

/** the line at the bottom of the screen. `noun` is the skin's word for the inmates */
export function hintText(h: Hint, noun: string): string {
  switch (h.key) {
    case "pickup": return `walk to the ${noun} at the bus stop`;
    case "tag": return "take them to the intake desk for striped shirts";
    case "house": return "walk them to a cell with room";
    case "full": return "unlock another cell for them";
    case "fetch": return `hungry ${noun}! grab trays in the kitchen`;
    case "drop": return "put the trays on a canteen table";
    case "clean": return "messy washroom! walk over the mess to clean it";
    case "coins": return "pick up the coins by the cells";
    case "pad": return "stand on a price tag to unlock it";
    case "stars": return `keep your ${noun} happy to earn more stars`;
    case "idle": return `keep your ${noun} fed, clean and happy`;
  }
}
