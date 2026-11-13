// many jails on a map, each with its own world, kept in one saved record: which jail is open, which
// are unlocked, and every visited jail's world. the record goes to the store in one write, so a jail
// and the map can never be saved half and half. the old one-jail save is read once, to move it over,
// and never written or removed: it stays as it was, a backup.
import { create, restore } from "../engine/sim.ts";
import type { LevelDef, World } from "../engine/types.ts";

export const MAP_KEY = "jailbirds:map";
export const OLD_KEY = "jailbirds:save";
/** where a map record that could not be read is put aside, before a fresh one goes over it */
export const ASIDE_KEY = "jailbirds:map:unreadable";
/** the old save's `level` was a place in this list, whatever order the content is in now */
const OLD_ORDER = ["jail1", "jail2"];

/** the store, as storage.ts gives it: a read that is null for nothing there and undefined when the
 * store would not answer, a write that says if it stuck */
export interface Store {
  read(key: string): string | null | undefined;
  write(key: string, value: string): boolean;
}
/** the saved record. `gen` counts its writes, so a tab can tell another has saved since it looked */
export interface Saved { v: 1; gen: number; active: string; unlocked: string[]; worlds: Record<string, unknown> }
/** the record live in memory: the open jail's world is played, the others wait as they were saved */
export interface Atlas {
  active: string;
  unlocked: string[];
  /** the jails not open right now, as last saved, by id */
  worlds: Record<string, unknown>;
  world: World;
  /** an unreadable record still to put aside before anything is written over it */
  aside: string | null;
  /** the `gen` of the record this was loaded from or last wrote */
  gen: number;
  /** opened while the store would not answer: it may write only over nothing at all */
  blind: boolean;
  /** another tab has saved since: this one never writes again, and the page loads afresh */
  stale: boolean;
}
export type From = "map" | "old" | "fresh" | "unreadable" | "blind";

const indexOf = (levels: LevelDef[], id: string) => levels.findIndex((l) => l.id === id);
const plain = (w: World): unknown => JSON.parse(JSON.stringify(w));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const atlasOf = (active: string, unlocked: string[], worlds: Record<string, unknown>, world: World, gen = 0): Atlas => ({
  active, unlocked, worlds, world, aside: null, gen, blind: false, stale: false,
});
const genFrom = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
/** the write count of a stored record, 0 when there is none to read */
function genOf(raw: string): number {
  try {
    const r: unknown = JSON.parse(raw);
    return isObject(r) ? genFrom(r.gen) : 0;
  } catch {
    return 0;
  }
}

/** the pad in a level that opens another, if it has one */
const opener = (l: LevelDef) => l.pads.find((p) => p.unlock.level);
/** the jail a jail's pad opens, by the id the pad names, when the content has it */
function nextOf(levels: LevelDef[], id: string) {
  const to = levels[indexOf(levels, id)] && opener(levels[indexOf(levels, id)])?.unlock.level;
  return to && indexOf(levels, to) >= 0 ? to : undefined;
}

/** a jail's world from what was saved for it, or a fresh one the first time. `level` is set from the
 * id, so a save follows its jail wherever the content puts it. null when the save cannot be trusted */
export function worldOf(levels: LevelDef[], id: string, saved: unknown, seed: number, unlocked: string[] = []): World | null {
  const i = indexOf(levels, id);
  if (i < 0) return null;
  if (saved === undefined) return fresh(levels, id, seed, unlocked);
  if (!isObject(saved)) return null;
  return restore(JSON.stringify({ ...saved, level: i }), levels);
}
/** a new world for a jail. a pad that would open a jail already open is gone, so it is never paid twice */
function fresh(levels: LevelDef[], id: string, seed: number, unlocked: string[]): World {
  const i = indexOf(levels, id);
  const w = create(levels, i, seed);
  const pad = opener(levels[i]), to = pad?.unlock.level;
  if (pad && to && unlocked.includes(to)) w.bought.push(pad.id);
  return w;
}

/** a saved map record, whole and sane, or null. every jail's world in it must restore, so one that
 * cannot is found now and not on the way there. worlds of jails the content no longer has are kept */
export function readMap(raw: string, levels: LevelDef[]): Atlas | null {
  let r: Partial<Saved> & Record<string, unknown>;
  try {
    r = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(r) || r.v !== 1 || typeof r.active !== "string" || !Array.isArray(r.unlocked) || !isObject(r.worlds)) return null;
  if (!r.unlocked.every((id) => typeof id === "string") || !r.unlocked.includes(r.active)) return null;
  // the open jail was saved with the record every time, so one missing is a record gone wrong
  if (r.worlds[r.active] === undefined) return null;
  const world = worldOf(levels, r.active, r.worlds[r.active], 1);
  if (!world) return null;
  const worlds: Record<string, unknown> = {};
  for (const [id, w] of Object.entries(r.worlds)) {
    if (id === r.active) continue;
    if (indexOf(levels, id) >= 0 && !worldOf(levels, id, w, 1)) return null;
    worlds[id] = w;
  }
  return atlasOf(r.active, [...r.unlocked], worlds, world, genFrom(r.gen));
}

/** the old one-jail save as a map: jail 1 stays jail 1; a save in jail 2 is jail 2, with jail 1
 * unlocked and visited fresh, since that save never kept it. null when there is nothing to trust */
export function fromOld(raw: string | null, levels: LevelDef[]): Atlas | null {
  if (!raw) return null;
  let old: unknown;
  try {
    old = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(old) || typeof old.level !== "number") return null;
  const id = OLD_ORDER[old.level];
  if (!id) return null;
  const world = worldOf(levels, id, old, 1);
  if (!world) return null;
  return atlasOf(id, OLD_ORDER.slice(0, OLD_ORDER.indexOf(id) + 1), {}, world);
}

/** a map with only jail 1, fresh */
export const newAtlas = (levels: LevelDef[], seed: number): Atlas => atlasOf(levels[0].id, [levels[0].id], {}, create(levels, 0, seed));

/** the record as it is saved, the open jail's world in with the rest */
export const record = (a: Atlas): Saved => ({
  v: 1, gen: a.gen, active: a.active, unlocked: [...a.unlocked], worlds: { ...a.worlds, [a.active]: plain(a.world) },
});

/** save it all in one write; true when it stuck. the record is read first: when another tab has saved
 * since this one looked, or this one opened blind over something it never loaded, it writes nothing,
 * now or later, and is marked stale so the page can load again. an unreadable record is put aside
 * first, and nothing is written over it until that has worked */
export function save(store: Store, a: Atlas): boolean {
  if (a.stale) return false;
  const now = store.read(MAP_KEY);
  if (now === undefined) return false;
  if (a.blind) {
    const under = now ?? store.read(OLD_KEY);
    if (under === undefined) return false;
    if (under !== null) {
      a.stale = true;
      return false;
    }
    a.blind = false;
  }
  const stored = now === null ? 0 : genOf(now);
  if (stored > a.gen) {
    a.stale = true;
    return false;
  }
  if (a.aside !== null) {
    if (!store.write(ASIDE_KEY, a.aside)) return false;
    a.aside = null;
  }
  const gen = Math.max(stored, a.gen) + 1;
  if (!store.write(MAP_KEY, JSON.stringify({ ...record(a), gen }))) return false;
  a.gen = gen;
  return true;
}

/** what the game opens with, and whether that is saved. a map record if there is one. if not, the old
 * save moved over, which counts only once it is written. an unreadable record never falls back to
 * the old save: that would bring back a jail she has moved on from. she starts fresh, not saving
 * yet, and the unreadable one is put aside on the first save. a store that will not answer is not an
 * empty one: she plays fresh, not saving, and nothing is written until it answers */
export function load(store: Store, levels: LevelDef[], seed: number): { atlas: Atlas; saved: boolean; from: From } {
  const blind = () => ({ atlas: { ...newAtlas(levels, seed), blind: true }, saved: false, from: "blind" as const });
  const raw = store.read(MAP_KEY);
  if (raw === undefined) return blind();
  if (raw !== null) {
    const atlas = readMap(raw, levels);
    if (atlas) return { atlas, saved: true, from: "map" };
    // the unreadable record's own count, so writing over it is not taken for another tab being ahead
    return { atlas: { ...newAtlas(levels, seed), aside: raw, gen: genOf(raw) }, saved: false, from: "unreadable" };
  }
  const oldRaw = store.read(OLD_KEY);
  if (oldRaw === undefined) return blind();
  const old = fromOld(oldRaw, levels);
  if (old) return { atlas: old, saved: save(store, old), from: "old" };
  return { atlas: newAtlas(levels, seed), saved: true, from: "fresh" };
}

/** the jail the open one's pad has just opened, added to the unlocked ones, or null. reads only what
 * the world has bought, so asking again, or after a reload, never opens it twice */
export function unlockNext(a: Atlas, levels: LevelDef[]): string | null {
  const l = levels[a.world.level], pad = l && opener(l), next = nextOf(levels, a.active);
  if (!pad || !next || !a.world.bought.includes(pad.id) || a.unlocked.includes(next)) return null;
  a.unlocked.push(next);
  return next;
}

/** go to another unlocked jail: the one she leaves and the move are saved together, in one write.
 * null, and nothing changed, when it cannot go or the save did not stick: an unsaved jail is never
 * left behind */
export function travel(store: Store, a: Atlas, levels: LevelDef[], id: string, seed: number): Atlas | null {
  if (id === a.active || !a.unlocked.includes(id)) return null;
  const world = worldOf(levels, id, a.worlds[id], seed, a.unlocked);
  if (!world) return null;
  const worlds = { ...a.worlds, [a.active]: plain(a.world) };
  delete worlds[id];
  const next: Atlas = { ...a, active: id, unlocked: [...a.unlocked], worlds, world };
  if (!save(store, next)) {
    // what the try learned about the store holds for the jail she stays in too
    Object.assign(a, { aside: next.aside, blind: next.blind, stale: next.stale });
    return null;
  }
  return next;
}

/** start the open jail over. the map, what is unlocked and the other jails stay */
export function startOver(a: Atlas, levels: LevelDef[], seed: number) {
  a.world = fresh(levels, a.active, seed, a.unlocked);
}

export type Row = { id: string; name: string; state: "here" | "open" | "locked" | "later" };
/** the map as the screen lists it */
export function rows(a: Atlas, places: { id: string; name: string; later?: true }[]): Row[] {
  return places.map((p) => ({
    id: p.id, name: p.name,
    state: p.later ? "later" : p.id === a.active ? "here" : a.unlocked.includes(p.id) ? "open" : "locked",
  }));
}
