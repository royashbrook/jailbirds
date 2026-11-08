// what a skin is: everything that gets drawn. the engine hands over plain data
// (rooms, props, a pose per character); the skin decides what it looks like.
// swapping skins changes no sim code and no saved game.
import type { AgentKind, Mood, PadDef, Pt, Rect, RoomDef } from "../engine/types.ts";

export interface Palette {
  hall: string;
  hallLine: string;
  /** room floors by the room's look */
  floors: Record<string, string>;
  locked: string;
  wall: string;
  bars: string;
  wood: string;
  metal: string;
  porcelain: string;
  road: string;
  roadLine: string;
  spot: string;
  pad: string;
  padFill: string;
  ink: string;
  inkDim: string;
  label: string;
  stick: string;
  /** agent colours, one per look */
  looks: string[];
}

/** one character, ready to draw: where, which way, how far into its stride */
export interface Pose {
  kind: AgentKind;
  x: number;
  y: number;
  face: 1 | -1;
  moving: boolean;
  /** distance walked: the walk cycle turns on this, so feet never slide */
  walk: number;
  /** seconds, for idle breathing and blinking */
  t: number;
  look: number;
  uniform: boolean;
  carry: number;
  mood: Mood;
  /** the need it is having met right now, if any */
  using: string | null;
}

export interface Skin {
  id: string;
  name: string;
  /** the word for the inmates in the hints */
  noun: string;
  palette(dark: boolean): Palette;
  character(ctx: CanvasRenderingContext2D, p: Pose, pal: Palette): void;
  hall(ctx: CanvasRenderingContext2D, size: { w: number; h: number }, roadY: number, pal: Palette): void;
  room(ctx: CanvasRenderingContext2D, room: RoomDef, open: boolean, pal: Palette): void;
  walls(ctx: CanvasRenderingContext2D, walls: Rect[], pal: Palette): void;
  cellDoor(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, pal: Palette): void;
  roomLabel(ctx: CanvasRenderingContext2D, room: RoomDef, pal: Palette): void;
  prop(ctx: CanvasRenderingContext2D, look: string, r: Rect, pal: Palette, stock: number): void;
  seat(ctx: CanvasRenderingContext2D, look: string, at: Pt, open: boolean, pal: Palette): void;
  spot(ctx: CanvasRenderingContext2D, at: Pt, pal: Palette): void;
  item(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number): void;
  mess(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, left: number, t: number): void;
  coin(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  pad(ctx: CanvasRenderingContext2D, pad: PadDef, paid: number, ready: boolean, pal: Palette): void;
  bus(ctx: CanvasRenderingContext2D, x: number, y: number, full: boolean, pal: Palette): void;
  stop(ctx: CanvasRenderingContext2D, at: Pt, pal: Palette): void;
  bubble(ctx: CanvasRenderingContext2D, need: string, x: number, y: number, pal: Palette): void;
}
