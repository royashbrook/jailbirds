// jail 1, top-down, in world units (a phone shows the full width and scrolls up
// and down with the warden). cells along the top, the desk and the kitchen in the
// middle, the canteen under them, the road and the bus stop along the bottom.
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const MAP = { width: 360, height: 640 };

export const CELL_COUNT = 6;
export const CELL_ROOM = 2;
export const CELLS_OPEN = 2;
export const cellRect = (i: number): Rect => ({ x: 9 + i * 58, y: 16, w: 54, h: 84 });
/** where the warden stands to send birds in, and where a locked cell's price tag sits */
export const cellDoor = (i: number): Pt => ({ x: 36 + i * 58, y: 124 });
/** where bird k of a cell sits */
export const cellSpot = (i: number, k: number): Pt => ({ x: 36 + i * 58 + (k ? 12 : -12), y: 64 });

export const DESK: Rect = { x: 24, y: 200, w: 96, h: 30 };
export const DESK_SPOT: Pt = { x: 72, y: 252 };
export const KITCHEN: Rect = { x: 236, y: 186, w: 108, h: 44 };
export const KITCHEN_SPOT: Pt = { x: 290, y: 254 };

export const TABLES: Rect[] = [
  { x: 120, y: 330, w: 120, h: 30 },
  { x: 120, y: 430, w: 120, h: 30 },
];
export const TABLES_OPEN = 1;
export const SEATS = 6;
/** three seats along the top edge of a table, three along the bottom */
export const seatSpot = (t: number, s: number): Pt => {
  const r = TABLES[t];
  return { x: r.x + 20 + (s % 3) * 40, y: s < 3 ? r.y - 12 : r.y + r.h + 12 };
};
export const tableCentre = (t: number): Pt => ({ x: TABLES[t].x + TABLES[t].w / 2, y: TABLES[t].y + TABLES[t].h / 2 });

export const ROAD_Y = 590;
export const STOP: Pt = { x: 80, y: 556 };
export const BUS_STOP_X = 120;
/** where the birds off the bus stand and wait */
export const waitSpot = (k: number): Pt => ({ x: STOP.x - 30 + k * 30, y: STOP.y });

export const WARDEN_START: Pt = { x: 200, y: 510 };

export type Unlock = { cell: number } | { table: number };
export type Pad = { id: string; cost: number; at: Pt; unlock: Unlock };
export const PADS: Pad[] = [
  { id: "cell3", cost: 8, at: cellDoor(2), unlock: { cell: 2 } },
  { id: "cell4", cost: 15, at: cellDoor(3), unlock: { cell: 3 } },
  { id: "cell5", cost: 25, at: cellDoor(4), unlock: { cell: 4 } },
  { id: "cell6", cost: 40, at: cellDoor(5), unlock: { cell: 5 } },
  { id: "table2", cost: 20, at: tableCentre(1), unlock: { table: 1 } },
];
