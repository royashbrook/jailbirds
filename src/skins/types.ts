// what a skin is: the look. the engine hands over plain data; the skin says what
// colour everything is and how a character is built and moves. the 3d view draws
// whatever the skin describes, so a new skin changes no sim code and no save.
import type { BufferGeometry } from "three";
import type { AgentKind, Mood } from "../engine/types.ts";

export interface Palette {
  background: string;
  hall: string;
  /** room floors by the room's look */
  floors: Record<string, string>;
  locked: string;
  wall: string;
  wood: string;
  metal: string;
  porcelain: string;
  bed: string;
  pillow: string;
  road: string;
  roadLine: string;
  spot: string;
  pad: string;
  padLocked: string;
  padFill: string;
  label: string;
  coin: string;
  tray: string;
  food: string[];
  poop: string;
  puddle: string;
  bus: string;
  glass: string;
  dark: string;
}

/** what a character is doing, as the view works it out from the world */
export type Action = "stand" | "walk" | "sit" | "eat" | "sleep" | "clean" | "fight" | "wash";

/** one character, ready to draw. it is reused from frame to frame: never keep it */
export interface Pose {
  kind: AgentKind;
  action: Action;
  /** distance walked: the walk cycle turns on this, so feet never slide */
  walk: number;
  /** seconds, for breathing and fidgets */
  t: number;
  look: number;
  /** through intake: in uniform */
  uniform: boolean;
  carry: number;
  mood: Mood;
}

export type Part = "body" | "head" | "limb" | "hat" | "dot";
/** place one part: position in the character's own space (feet at the origin,
 * facing +z), rotation as pitch (x), yaw (y), roll (z), a scale and a colour */
export type Put = (part: Part, x: number, y: number, z: number, pitch: number, yaw: number, roll: number, sx: number, sy: number, sz: number, colour: number) => void;

export interface Model {
  /** each part's shape, built once */
  parts: Record<Part, () => BufferGeometry>;
  /** how many of each part one character can use at most */
  perCharacter: Record<Part, number>;
  /** lay out one character's parts for this pose */
  pose(p: Pose, put: Put): void;
  /** the whole body: how high it lifts and how it tips (lying in a bunk) */
  root(p: Pose): { readonly lift: number; readonly pitch: number };
  /** where a carried stack sits, in front of the chest */
  carryAt: { forward: number; up: number; step: number };
  /** how tall a character stands, for bubbles over heads */
  height: number;
}

export interface Skin {
  id: string;
  name: string;
  /** the word for the inmates in the hints and the about sheet */
  noun: string;
  /** what two of them shout when they squabble */
  squabble: string;
  /** comic shouts that take turns over a squabble; without them it is just `squabble` */
  shouts?: string[];
  palette(dark: boolean): Palette;
  model: Model;
}
