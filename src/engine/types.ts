// the idle engine's vocabulary. nothing in here knows what the game is about: a
// level is data (rooms, stations, needs, price pads, pacing), a world is the live
// state, and a skin draws both. the theme lives in src/content, drawing in src/skins.

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
  /** where the skin prints the label; the bottom middle when not given */
  labelAt?: Pt;
}

/** a place an agent sits, sleeps or stands to have a need met */
export interface Seat {
  at: Pt;
  /** a pad id that opens this seat */
  locked?: string;
  /** where its mess lands, for a station that makes one */
  messAt?: Pt;
  /** only residents of this house use it */
  house?: string;
  /** what the skin draws there */
  look?: string;
}

export type StationDef =
  /** a ride drops arrivals at a stop; they walk through `via` to the check-in queue on their own */
  | { id: string; kind: "spawn"; at: Pt; via: Pt[]; load: number; gap: number; roadY: number; stopX: number }
  /** an actor standing at `at` checks in the head of the queue, while there is a free bed:
   * it gets the tag, pays into the pile, and waits at an `out` spot to be led away */
  | {
      id: string; kind: "checkin"; at: Pt; r: number; queue: Pt[]; out: Pt[]; tag: string; every: number;
      pay: number; pileAt: Pt; look: string; prop: Rect; gate?: Pt;
    }
  /** a home: tagged followers move in while there are free beds; content residents drop coins */
  | { id: string; kind: "house"; at: Pt; r: number; room: string; seats: Seat[]; locked?: string; coinAt: Pt; requires?: string }
  /** stand here to fill your arms with items */
  | { id: string; kind: "source"; at: Pt; r: number; item: string; every: number; look: string; prop: Rect }
  /** agents led into the zone sit down and use one item each to meet a need */
  | {
      id: string; kind: "sink"; zone: Rect; at: Pt; item: string; every: number; seats: Seat[]; need: string; use: number;
      look: string; prop: Rect; locked?: string;
    }
  /** agents use a seat to meet a need; a use may leave a mess that blocks the seat until cleaned.
   * with a zone, residents are led there; without one, they walk to it themselves */
  | { id: string; kind: "facility"; seats: Seat[]; need: string; use: number; mess: string; messChance: number; look: string; zone?: Rect };
  /** an actor standing at `at` sends a finished follower out through `exit`: it pays, and earns a star */
export type ReleaseDef = { id: string; kind: "release"; at: Pt; r: number; exit: Pt[]; every: number; pay: number; pileAt: Pt; look: string; prop: Rect };
export type AnyStation = StationDef | ReleaseDef;

export interface NeedDef {
  id: string;
  /** seconds from full to empty */
  decay: number;
  /** what a fresh arrival has */
  start: number;
  /** true: the agent waits at home with a bubble until someone leads it there */
  escort: boolean;
}

/** what turns up on the floor: two rides that make the player faster, and a fairy that flies off and cleans */
export type BoostKind = "skates" | "unicorn" | "fairy";
/** what a boosted player rides */
export type MountKind = "skates" | "unicorn";
/** a ride: seconds it lasts, how much faster, and how often it turns up against the others */
export interface RideBoost { time: number; mult: number; weight: number }
/** the fairy: how often she turns up, and seconds per mess she visits */
export interface FairyBoost { weight: number; visit: number }
export interface BoostKinds { skates: RideBoost; unicorn: RideBoost; fairy: FairyBoost }
/** the fairy in flight. `target` is the id of the mess she is flying to (null: nobody flying), `todo` the
 * ids of the messes that were there when she was picked up and are still to visit, `t` seconds into this
 * visit, `visits` the messes cleaned so far. she never takes on a mess made after she came */
export interface Fairy { todo: number[]; visits: number; x: number; y: number; target: number | null; t: number }

export type HelperKind ="escort" | "carrier" | "cleaner" | "clerk";
export interface Unlock {
  room?: string;
  carry?: number;
  line?: number;
  speed?: number;
  helper?: HelperKind;
  /** move on to the next level */
  level?: true;
}
export interface PadDef {
  id: string;
  cost: number;
  at: Pt;
  /** the rank needed before it takes coins */
  rank?: number;
  /** a pad that must be bought first before this one shows */
  after?: string;
  unlock: Unlock;
  /** a short word or two for the skin to print */
  label?: string;
}

export interface LevelDef {
  id: string;
  name: string;
  size: { w: number; h: number };
  rooms: RoomDef[];
  stations: AnyStation[];
  needs: NeedDef[];
  pads: PadDef[];
  start: Pt;
  /** where hired helpers wait when there is nothing to do */
  helperHome: Pt;
  /** a need under this asks for help; at zero the agent is cross */
  threshold: number;
  /** seconds at home before an agent is done and wants to leave */
  serve: number;
  /** stars needed for each rank: [rank 1 to 2, rank 2 to 3, ...]; past the end, the last one repeats */
  rankStars: number[];
  /** coins for each rank up, times the new rank */
  rankReward: number;
  speed: number;
  line: number;
  carry: number;
  /** how many agent looks the skin offers (colours, outfits) */
  looks: number;
  /** seconds between coins for a content agent */
  coinEvery: number;
  coinsPerHouse: number;
  /** a free surprise that turns up on the floor now and then: one of `kinds`, picked by weight */
  boost: { spots: Pt[]; every: number; kinds: BoostKinds };
  /** two residents squabble now and then (sooner when someone is cross); stand there to settle it */
  fights: { every: number; crossEvery: number; settle: number; reward: number; minPop: number };
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
  /** arrive, queue, ready, follow, enter, home, go, use, back, fight, leave; helpers: idle */
  state: string;
  leader: number;
  house: string;
  slot: number;
  /** the station and seat it is heading to or using */
  station: string;
  seat: number;
  needs: Record<string, number>;
  /** seconds served at home */
  served: number;
  /** seconds since it last got home: it settles in before asking to go anywhere */
  rest: number;
  t: number;
  carry: number;
  path: Pt[];
  /** for a leader: where it has been, newest first, so followers walk the same way through doors */
  trail: Pt[];
}
export interface Mess { id: number; kind: string; x: number; y: number; station: string; seat: number; clean: number }
export interface Coin { x: number; y: number; house: string }
export interface World {
  v: 3;
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
  /** coins stacked by each paying station, waiting to be walked over */
  piles: Record<string, number>;
  messes: Mess[];
  floor: Coin[];
  ride: { state: "away" | "in" | "out"; x: number; t: number };
  /** cadence timers, keyed by actor and station */
  clock: Record<string, number>;
  carryMax: number;
  lineMax: number;
  speed: number;
  rank: number;
  /** stars toward the next rank */
  stars: number;
  /** counters the screen watches for popups */
  released: number;
  settled: number;
  /** a squabble in progress: where, who, how long the player has stood there */
  alert: { x: number; y: number; ids: number[]; held: number } | null;
  fightIn: number;
  boost: { x: number; y: number; here: boolean; t: number };
  /** what the boost on the floor is, picked once when it turns up */
  boostKind: BoostKind;
  /** seconds of boost left on the player */
  boosted: number;
  /** what the boosted player rides */
  mountKind: MountKind;
  fairy: Fairy;
}
export type Stick = { x: number; y: number };
