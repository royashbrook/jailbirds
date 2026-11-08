// the jail on a canvas. shapes only, our own: round birds with a beak and a tuft,
// striped shirts once they have been through the desk, a warden bird in a cap.
// reads the world, never changes it.
import {
  BUS_STOP_X, CELL_COUNT, DESK, DESK_SPOT, KITCHEN, KITCHEN_SPOT, MAP, PADS, ROAD_Y, SEATS, STOP, TABLES,
  cellDoor, cellRect, seatSpot,
} from "./sim/map.ts";
import { HUNGRY, hungry, padVisible, type World } from "./sim/sim.ts";

/** the map's colours come from app.css, so dark mode repaints the floor and walls */
export type Theme = Record<
  | "floor" | "floorLine" | "wall" | "cellFloor" | "locked" | "bars" | "bed" | "desk" | "counter" | "stove"
  | "table" | "road" | "roadLine" | "spot" | "pad" | "padFill" | "ink" | "inkDim" | "label" | "shadow" | "stick",
  string
>;
export function theme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(`--map-${n}`).trim();
  return {
    floor: v("floor"), floorLine: v("floor-line"), wall: v("wall"), cellFloor: v("cell-floor"), locked: v("locked"),
    bars: v("bars"), bed: v("bed"), desk: v("desk"), counter: v("counter"), stove: v("stove"), table: v("table"),
    road: v("road"), roadLine: v("road-line"), spot: v("spot"), pad: v("pad"), padFill: v("pad-fill"), ink: v("ink"),
    inkDim: v("ink-dim"), label: v("label"), shadow: v("shadow"), stick: v("stick"),
  };
}

// the birds keep their colours in both themes, like toys do
export const BIRD_COLOURS = ["#ffd27a", "#9fd3f5", "#f7a8c4", "#a8e6b8", "#c9b8ff", "#ffb38a"];
const WARDEN = "#5b7fcf";
const OUTLINE = "#3a2e2b";
const BEAK = "#ff9f40";
const COIN = "#ffd23f";
const COIN_EDGE = "#c9960f";
const STRIPE = "#3a2e2b";
const SHIRT = "#ffffff";
const BUS = "#f2b84b";
const HUNGER = "#ff6b6b";

export type View = { scale: number; camY: number; width: number; height: number };
/** the camera: the full width of the map, scrolled to keep the warden in the middle */
export function view(w: World, width: number, height: number): View {
  const scale = width / MAP.width;
  const tall = height / scale;
  const camY = tall >= MAP.height ? (MAP.height - tall) / 2 : Math.min(MAP.height - tall, Math.max(0, w.warden.y - tall / 2));
  return { scale, camY, width, height };
}

export type Thumb = { ox: number; oy: number; x: number; y: number; r: number } | null;

export function render(ctx: CanvasRenderingContext2D, w: World, th: Theme, v: View, now: number, thumb: Thumb, dpr: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = th.floor;
  ctx.fillRect(0, 0, v.width, v.height);
  ctx.setTransform(v.scale, 0, 0, v.scale, 0, -v.camY * v.scale);
  const t = now / 1000;

  // floor tiles
  ctx.strokeStyle = th.floorLine;
  ctx.lineWidth = 1;
  for (let y = 0; y < MAP.height; y += 40) line(ctx, 0, y, MAP.width, y);
  for (let x = 0; x < MAP.width; x += 40) line(ctx, x, 0, x, ROAD_Y - 24);

  // the road and the bus stop
  ctx.fillStyle = th.road;
  ctx.fillRect(0, ROAD_Y - 20, MAP.width, MAP.height - ROAD_Y + 20);
  ctx.strokeStyle = th.roadLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 12]);
  line(ctx, 0, ROAD_Y + 16, MAP.width, ROAD_Y + 16);
  ctx.setLineDash([]);
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 3;
  line(ctx, STOP.x - 52, STOP.y + 10, STOP.x - 52, STOP.y - 26);
  circle(ctx, STOP.x - 52, STOP.y - 32, 9, BUS, th.ink, 2);
  label(ctx, th, "bus stop", STOP.x, STOP.y + 26);

  // the cells along the top
  for (let i = 0; i < CELL_COUNT; i++) cell(ctx, th, i, w.cells[i]);

  // the stations, and a soft spot on the floor where the warden stands
  for (let i = 0; i < CELL_COUNT; i++) if (w.cells[i]) spot(ctx, th, cellDoor(i).x, cellDoor(i).y);
  spot(ctx, th, DESK_SPOT.x, DESK_SPOT.y);
  spot(ctx, th, KITCHEN_SPOT.x, KITCHEN_SPOT.y);
  rounded(ctx, DESK.x, DESK.y, DESK.w, DESK.h, 6, th.desk, th.ink);
  for (let k = 0; k < 3; k++) shirt(ctx, DESK.x + 22 + k * 6, DESK.y + 12 - k * 3, 9);
  label(ctx, th, "shirts", DESK.x + DESK.w / 2, DESK.y - 8);
  rounded(ctx, KITCHEN.x, KITCHEN.y, KITCHEN.w, KITCHEN.h, 6, th.counter, th.ink);
  circle(ctx, KITCHEN.x + 22, KITCHEN.y + 22, 10, th.stove, th.ink, 1.5);
  circle(ctx, KITCHEN.x + 48, KITCHEN.y + 22, 10, th.stove, th.ink, 1.5);
  for (let k = 0; k < 4; k++) tray(ctx, KITCHEN.x + 84, KITCHEN.y + 30 - k * 5);
  label(ctx, th, "kitchen", KITCHEN.x + KITCHEN.w / 2, KITCHEN.y - 8);

  // the canteen
  TABLES.forEach((r, i) => {
    if (!w.tables[i].open) {
      ctx.setLineDash([6, 5]);
      rounded(ctx, r.x, r.y, r.w, r.h, 8, "transparent", th.inkDim);
      ctx.setLineDash([]);
      return;
    }
    for (let s = 0; s < SEATS; s++) {
      const p = seatSpot(i, s);
      circle(ctx, p.x, p.y + (s < 3 ? -4 : 4), 7, th.desk, th.ink, 1.5);
    }
    rounded(ctx, r.x, r.y, r.w, r.h, 8, th.table, th.ink);
    for (let k = 0; k < w.tables[i].trays; k++) tray(ctx, r.x + 20 + (k % 3) * 40, r.y + (k < 3 ? 9 : 21));
  });
  label(ctx, th, "canteen", TABLES[0].x + TABLES[0].w / 2, TABLES[0].y - 30);

  // price pads
  for (const p of PADS) if (padVisible(w, p)) pad(ctx, th, p.at.x, p.at.y, p.cost, w.paid[p.id] ?? 0);

  // coins on the floor, bobbing a little
  for (const [k, c] of w.floor.entries()) coin(ctx, c.x, c.y - 2 - Math.abs(Math.sin(t * 3 + k)) * 2, 5);

  // the bus
  if (w.bus.state !== "away") bus(ctx, th, w.bus.x, ROAD_Y + 4, w.bus.state === "in" && w.bus.x < BUS_STOP_X);

  // everyone, back to front
  const people = [
    ...w.birds.map((b) => ({ y: b.y, draw: () => {
      const walking = b.state === "follow" || b.state === "toCell" || b.state === "toTable" || b.state === "home";
      const bob = walking ? Math.abs(Math.sin(t * 12 + b.id)) * 2 : b.state === "eating" ? Math.abs(Math.sin(t * 8)) : 0;
      const face = b.state === "follow" ? w.warden.face : b.id % 2 ? 1 : -1;
      bird(ctx, b.x, b.y - bob, 9, BIRD_COLOURS[b.look], face, b.shirt, false);
      if (hungry(b)) meter(ctx, b.x, b.y - 22, b.food / HUNGRY);
    } })),
    { y: w.warden.y, draw: () => {
      const wd = w.warden;
      const bob = wd.moving ? Math.abs(Math.sin(t * 12)) * 2 : 0;
      bird(ctx, wd.x, wd.y - bob, 13, WARDEN, wd.face, false, true);
      for (let k = 0; k < w.carried; k++) tray(ctx, wd.x, wd.y - 34 - bob - k * 5);
    } },
  ];
  people.sort((a, b) => a.y - b.y).forEach((p) => p.draw());

  // the thumb stick, in screen pixels, where the finger went down
  if (thumb) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    circle(ctx, thumb.ox, thumb.oy, thumb.r, th.stick, th.inkDim, 2);
    circle(ctx, thumb.x, thumb.y, thumb.r * 0.45, th.inkDim, th.ink, 2);
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string, width = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function label(ctx: CanvasRenderingContext2D, th: Theme, text: string, x: number, y: number) {
  ctx.font = "700 10px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = th.label;
  ctx.fillText(text, x, y);
}
function spot(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, 22, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = th.spot;
  ctx.fill();
}

function cell(ctx: CanvasRenderingContext2D, th: Theme, i: number, open: boolean) {
  const r = cellRect(i);
  ctx.fillStyle = open ? th.cellFloor : th.locked;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (open) {
    rounded(ctx, r.x + 6, r.y + 8, 16, 26, 4, th.bed, th.ink);
    rounded(ctx, r.x + 8, r.y + 10, 12, 7, 3, "#ffffff");
  }
  ctx.strokeStyle = th.wall;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + r.h);
  ctx.lineTo(r.x, r.y);
  ctx.lineTo(r.x + r.w, r.y);
  ctx.lineTo(r.x + r.w, r.y + r.h);
  ctx.stroke();
  // bars along the front
  ctx.strokeStyle = th.bars;
  ctx.lineWidth = 2.5;
  for (let x = r.x + 5; x < r.x + r.w; x += 7) line(ctx, x, r.y + r.h - 12, x, r.y + r.h);
  line(ctx, r.x, r.y + r.h, r.x + r.w, r.y + r.h);
  if (!open) {
    // a little padlock
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 6;
    ctx.strokeStyle = th.inkDim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 6, Math.PI, 0);
    ctx.stroke();
    rounded(ctx, cx - 9, cy - 4, 18, 14, 3, th.inkDim);
  }
}

export function bird(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, face: number, shirted: boolean, warden: boolean) {
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.95, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fill();
  // feet
  ctx.strokeStyle = BEAK;
  ctx.lineWidth = r * 0.16;
  line(ctx, x - r * 0.3, y + r * 0.7, x - r * 0.3, y + r * 0.98);
  line(ctx, x + r * 0.3, y + r * 0.7, x + r * 0.3, y + r * 0.98);
  // tuft
  ctx.beginPath();
  ctx.moveTo(x - r * 0.15, y - r * 0.85);
  ctx.quadraticCurveTo(x - r * 0.1, y - r * 1.45, x + r * 0.25, y - r * 1.25);
  ctx.quadraticCurveTo(x + r * 0.1, y - r * 1.05, x + r * 0.2, y - r * 0.85);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = r * 0.12;
  ctx.stroke();
  // body
  circle(ctx, x, y, r, colour);
  if (shirted) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = SHIRT;
    ctx.fillRect(x - r, y + r * 0.05, r * 2, r);
    ctx.fillStyle = STRIPE;
    for (let k = 0; k < 3; k++) ctx.fillRect(x - r, y + r * (0.18 + k * 0.3), r * 2, r * 0.14);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = r * 0.14;
  ctx.stroke();
  // wing on the far side
  ctx.beginPath();
  ctx.ellipse(x - face * r * 0.35, y + r * 0.1, r * 0.38, r * 0.26, face * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fill();
  // beak and eye on the side it faces
  ctx.beginPath();
  ctx.moveTo(x + face * r * 0.75, y - r * 0.2);
  ctx.lineTo(x + face * r * 1.35, y - r * 0.02);
  ctx.lineTo(x + face * r * 0.75, y + r * 0.18);
  ctx.closePath();
  ctx.fillStyle = BEAK;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = r * 0.08;
  ctx.stroke();
  circle(ctx, x + face * r * 0.35, y - r * 0.3, r * 0.26, "#ffffff");
  circle(ctx, x + face * r * 0.42, y - r * 0.3, r * 0.13, OUTLINE);
  if (warden) {
    // a cap with a gold badge
    ctx.beginPath();
    ctx.roundRect(x - r * 0.75, y - r * 1.15, r * 1.5, r * 0.55, [r * 0.4, r * 0.4, 0, 0]);
    ctx.fillStyle = "#2f3f6b";
    ctx.fill();
    ctx.fillRect(x - r * 0.2 + face * r * 0.3, y - r * 0.68, r * 1.0, r * 0.18);
    circle(ctx, x, y - r * 0.88, r * 0.15, COIN);
  }
}

function shirt(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = SHIRT;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.fillStyle = STRIPE;
  for (let k = 0; k < 3; k++) ctx.fillRect(x - s / 2, y - s / 2 + 1 + k * 3, s, 1.4);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
}
function tray(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rounded(ctx, x - 9, y - 3, 18, 6, 2, "#e8eef4", OUTLINE);
  circle(ctx, x - 3, y - 3, 2.6, "#ff9f40");
  circle(ctx, x + 3, y - 3, 2.6, "#7ccf7c");
}
function coin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  circle(ctx, x, y, r, COIN, COIN_EDGE, 1.5);
  circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.25, "rgba(255,255,255,0.7)");
}
function meter(ctx: CanvasRenderingContext2D, x: number, y: number, f: number) {
  rounded(ctx, x - 10, y - 3, 20, 6, 3, "#ffffff", OUTLINE);
  rounded(ctx, x - 9, y - 2, Math.max(1, 18 * Math.min(1, f)), 4, 2, HUNGER);
}
function pad(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, cost: number, paid: number) {
  const w = 44, h = 26;
  rounded(ctx, x - w / 2, y - h / 2, w, h, 7, th.padFill);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 7);
  ctx.clip();
  ctx.fillStyle = th.pad;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(x - w / 2, y - h / 2, (w * paid) / cost, h);
  ctx.restore();
  ctx.setLineDash([5, 4]);
  rounded(ctx, x - w / 2, y - h / 2, w, h, 7, "transparent", th.pad);
  ctx.setLineDash([]);
  coin(ctx, x - 11, y, 5);
  ctx.font = "800 12px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = th.ink;
  ctx.fillText(String(cost - paid), x - 3, y + 1);
}
function bus(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, full: boolean) {
  rounded(ctx, x - 50, y - 18, 100, 34, 8, BUS, th.ink);
  for (let k = 0; k < 4; k++) {
    rounded(ctx, x - 42 + k * 22, y - 12, 16, 12, 3, "#dff3ff", th.ink);
    if (full && k < 3) circle(ctx, x - 34 + k * 22, y - 4, 4, BIRD_COLOURS[k]);
  }
  circle(ctx, x - 30, y + 16, 7, th.ink);
  circle(ctx, x + 30, y + 16, 7, th.ink);
}
