// what just happened, read off two looks at the world. the sim keeps no list of
// events: a screen takes a `snap` once it has caught up, and on the next frame
// asks `cues` what changed since. nothing here touches the world, so the game
// plays the same with or without anyone listening.
import { near } from "./geom.ts";
import { followers, player } from "./sim.ts";
import type { Coin, LevelDef, Mess, World } from "./types.ts";

export type CueKind =
  | "coin" | "pile" | "pay" | "buy" | "checkin" | "follow" | "bed" | "seat" | "carry" | "drop"
  | "clean" | "release" | "rank" | "level" | "fight" | "calm" | "boost" | "ride";
/** `n` is how many, or how far along: coins picked up, the line's length, the new rank.
 * `fill` is how full a price tag is now, from 0 to 1 */
export interface Cue { kind: CueKind; n: number; fill?: number }

/** the little of a world that `cues` compares. the floor and the messes are kept
 * as the same objects the world holds, so one picked up is told from one just dropped */
export interface Snap {
  level: number; steps: number; coins: number; floor: Coin[]; piles: Record<string, number>; paid: Record<string, number>;
  bought: number; queue: number[]; led: number[]; carry: number; messes: Mess[];
  released: number; rank: number; settled: number; alert: boolean; boosted: number; ride: string;
}

/** how far past a desk's own reach the player still counts as the one who did it:
 * a helper working on its own, somewhere else, makes no sound */
const SLACK = 14;
/** the same for a mess, from its middle */
const CLEAN_R = 34;

export function snap(w: World): Snap {
  const me = player(w);
  return {
    level: w.level, steps: w.steps, coins: w.coins, floor: w.floor.slice(), piles: { ...w.piles }, paid: { ...w.paid },
    bought: w.bought.length,
    queue: w.agents.filter((a) => a.state === "queue").map((a) => a.id),
    led: followers(w, me).map((a) => a.id),
    carry: me.carry, messes: w.messes.slice(),
    released: w.released, rank: w.rank, settled: w.settled, alert: !!w.alert, boosted: w.boosted, ride: w.ride.state,
  };
}

/** what there is to show for it: coins that came in, stars earned, and what was just bought */
export interface Gain { coins: number; stars: number; bought: string[] }

/** what came in between the snap and now. like `cues`, a new level or a world
 * that went back in time has nothing to show */
export function gains(before: Snap, w: World): Gain {
  if (w.level !== before.level || w.steps <= before.steps) return { coins: 0, stars: 0, bought: [] };
  return { coins: Math.max(0, w.coins - before.coins), stars: Math.max(0, w.released - before.released), bought: w.bought.slice(before.bought) };
}

/** what happened between the snap and now. a new level says only that; a world
 * that went back in time (a fresh start) says nothing */
export function cues(before: Snap, w: World, l: LevelDef): Cue[] {
  if (w.level !== before.level) return [{ kind: "level", n: w.level + 1 }];
  if (w.steps <= before.steps) return [];
  const out: Cue[] = [];
  const add = (kind: CueKind, n: number, fill?: number) => {
    if (n > 0) out.push(fill === undefined ? { kind, n } : { kind, n, fill });
  };
  const me = player(w);

  // money: coins off the floor, a pile by a desk, coins into a price tag
  if (before.floor.length) {
    const here = new Set(w.floor);
    add("coin", before.floor.filter((c) => !here.has(c)).length);
  }
  let pile = 0;
  for (const id in before.piles) if (before.piles[id] > (w.piles[id] ?? 0)) pile += before.piles[id];
  add("pile", pile);
  if (w.bought.length > before.bought) add("buy", w.bought.length - before.bought);
  else
    for (const p of l.pads) {
      const paid = (w.paid[p.id] ?? 0) - (before.paid[p.id] ?? 0);
      if (paid > 0) add("pay", paid, Math.min(1, (w.paid[p.id] ?? 0) / p.cost));
    }

  // people: checked in at the desk, joining the line, leaving it for a bed or a seat
  if (before.queue.length && l.stations.some((s) => s.kind === "checkin" && near(me, s.at, s.r + SLACK))) {
    const waiting = new Set(w.agents.filter((a) => a.state === "queue").map((a) => a.id));
    add("checkin", before.queue.filter((id) => !waiting.has(id)).length);
  }
  const line = followers(w, me);
  if (line.some((a) => !before.led.includes(a.id))) add("follow", line.length);
  let bed = 0, seat = 0;
  for (const id of before.led) {
    if (line.some((a) => a.id === id)) continue;
    const state = w.agents.find((a) => a.id === id)?.state;
    // a newcomer given a bed, or one with nothing left to want sent back to theirs
    if (state === "enter" || state === "back") bed++;
    else if (state === "go" || state === "use") seat++;
  }
  add("bed", bed);
  add("seat", seat);

  // chores: a load picked up and put down, a mess wiped
  if (me.carry > before.carry) add("carry", me.carry);
  else add("drop", before.carry - me.carry);
  if (before.messes.length) {
    const left = new Set(w.messes);
    add("clean", before.messes.filter((m) => !left.has(m) && near(m, me, CLEAN_R)).length);
  }

  // the big moments. a rank up speaks for the release that earned it
  if (w.rank > before.rank) add("rank", w.rank);
  else add("release", w.released - before.released);
  if (w.alert && !before.alert) add("fight", 1);
  add("calm", w.settled - before.settled);
  if (w.boosted > before.boosted) add("boost", 1);
  if (before.ride === "away" && w.ride.state !== "away") add("ride", 1);
  return out;
}
