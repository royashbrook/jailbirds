// the idle engine's vocabulary. nothing in here knows what the game is about: a level is
// data (rooms, stations, needs, price pads), a world is the live state, and a
// skin draws both. the theme lives in src/content, drawing lives in src/skins.

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = "n" | "s" | "e" | "w";

/** a gap in a room's wall. `actors: false` keeps the player and helpers out (a door only residents use) */
export interface Door {
  side: Side;
  /** where the gap starts along that side, from the room's left or top edge */
  at: number;
  width: number;
  actors?: false;
}
export interface RoomDef {
  id: string;
  /** what the skin draws for it: free text the skin understands, the engine never reads it */
  look: string;
  rect: Rect;
  doors: Door[];
  /** a pad id: until it is bought the room is drawn locked and its doors are shut */
  locked?: string;
  label?: string;
}

/** a place an agent sits to have a need met, or lives */
export interface Seat {
  at: Pt;
  /** a pad id that opens this seat */
  locked?: string;
  /** where its mess lands, for a station that makes one */
  messAt?: Pt;
  /** what the skin draws there */
  look?: string;
}

export type StationDef =
  /** where new agents arrive, a few at a time, while there is room for them */
  | { id: string; kind: "spawn"; at: Pt; wait: Pt[]; load: number; gap: number; roadY: number; stopX: number }
  /** stand here and the agents following you get a tag, one at a time */
  | { id: string; kind: "tag"; at: Pt; r: number; tag: string; every: number; look: string; prop: Rect }
  /** a home: tagged followers move in while there is room, and drop coins when content */
  | { id: string; kind: "house"; at: Pt; r: number; room: string; seats: Seat[]; locked?: string; coinAt: Pt; requires?: string }
  /** stand here to fill your arms with items */
  | { id: string; kind: "source"; at: Pt; r: number; item: string; every: number; look: string; prop: Rect }
  /** drop carried items here; agents come and use one each to meet a need */
  | {
      id: string; kind: "sink"; zone: Rect; at: Pt; item: string; every: number; seats: Seat[]; need: string; use: number;
      look: string; prop: Rect; locked?: string;
    }
  /** agents come and use a seat to meet a need; each use leaves a mess that blocks the seat until cleaned */
  | { id: string; kind: "facility"; seats: Seat[]; need: string; use: number; mess: string; look: string };

export interface NeedDef {
  id: string;
  /** seconds from full to empty */
  decay: number;
  /** what a fresh arrival has */
  start: number;
}

export type HelperKind = "escort" | "carrier" | "cleaner";
export interface Unlock {
  room?: string;
  carry?: number;
  helper?: HelperKind;
  /** move on to the next level */
  level?: true;
}
export interface PadDef {
  id: string;
  cost: number;
  at: Pt;
  /** the rating needed before it takes coins */
  stars?: number;
  /** a pad that must be bought first before this one shows */
  after?: string;
  /** rating points it adds once bought */
  points: number;
  unlock: Unlock;
  /** a short word or two for the skin to print */
  label?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  size: { w: number; h: number };
  rooms: RoomDef[];
  stations: StationDef[];
  needs: NeedDef[];
  pads: PadDef[];
  start: Pt;
  /** where hired helpers wait when there is nothing to do */
  helperHome: Pt;
  /** a need under this asks for help; at zero the agent is cross */
  threshold: number;
  carry: number;
  /** how many agent looks the skin offers (colours, outfits) */
  looks: number;
  /** seconds between coins for a content agent */
  coinEvery: number;
  coinsPerHouse: number;
}

export type Mood = "ok" | "needy" | "cross";
export type AgentKind = "player" | "agent" | HelperKind;
export interface Agent {
  id: number;
  kind: AgentKind;
  x: number;
  y: number;
  face: 1 | -1;
  moving: boolean;
  /** distance walked, for the skin's walk cycle */
  walk: number;
  look: number;
  tags: string[];
  /** what it is doing: wait, follow, enter, home, go, use, back, or a helper's job */
  state: string;
  leader: number;
  house: string;
  slot: number;
  /** the station and seat it is heading to or using */
  station: string;
  seat: number;
  needs: Record<string, number>;
  t: number;
  carry: number;
  path: Pt[];
  /** for a leader: where it has been, newest first, so followers walk the same way through doors */
  trail: Pt[];
}
export interface Mess { id: number; kind: string; x: number; y: number; station: string; seat: number; clean: number }
export interface Coin { x: number; y: number; house: string }
export interface World {
  v: 2;
  level: number;
  steps: number;
  rng: number;
  nextId: number;
  coins: number;
  agents: Agent[];
  bought: string[];
  paid: Record<string, number>;
  /** items sitting on each sink */
  stock: Record<string, number>;
  messes: Mess[];
  floor: Coin[];
  ride: { state: "away" | "in" | "out"; x: number; t: number };
  /** cadence timers, keyed by actor and station */
  clock: Record<string, number>;
  carryMax: number;
  /** rating points from bought pads */
  points: number;
}
export type Stick = { x: number; y: number };
