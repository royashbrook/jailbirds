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

/** the store, as storage.ts gives it: a read that may be null, a write that says if it stuck */
export interface Store {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
}
/** the saved record */
export interface Saved { v: 1; active: string; unlocked: string[]; worlds: Record<string, unknown> }
/** the record live in memory: the open jail's world is played, the others wait as they were saved */
export interface Atlas {
  active: string;
  unlocked: string[];
  /** the jails not open right now, as last saved, by id */
  worlds: Record<string, unknown>;
  world: World;
  /** an unreadable record still to put aside before anything is written over it */
  aside: string | null;
}
export type From = "map" | "old" | "fresh" | "unreadable";

const indexOf = (levels: LevelDef[], id: string) => levels.findIndex((l) => l.id === id);
const plain = (w: World): unknown => JSON.parse(JSON.stringify(w));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** the pad in a level that opens the next one, if it has one */
const opener = (l: LevelDef) => l.pads.find((p) => p.unlock.level);
/** the jail the open one's pad leads to: the next in the content, ludo's order */
const nextOf = (levels: LevelDef[], id: string) => levels[indexOf(levels, id) + 1]?.id;

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
  const pad = opener(levels[i]), next = nextOf(levels, id);
  if (pad && next && unlocked.includes(next)) w.bought.push(pad.id);
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
  return { active: r.active, unlocked: [...r.unlocked], worlds, world, aside: null };
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
  return { active: id, unlocked: OLD_ORDER.slice(0, OLD_ORDER.indexOf(id) + 1), worlds: {}, world, aside: null };
}

/** a map with only jail 1, fresh */
export const newAtlas = (levels: LevelDef[], seed: number): Atlas => ({
  active: levels[0].id, unlocked: [levels[0].id], worlds: {}, world: create(levels, 0, seed), aside: null,
});

/** the record as it is saved, the open jail's world in with the rest */
export const record = (a: Atlas): Saved => ({
  v: 1, active: a.active, unlocked: [...a.unlocked], worlds: { ...a.worlds, [a.active]: plain(a.world) },
});

/** save it all in one write; true when it stuck. an unreadable record is put aside first, and nothing
 * is written over it until that has worked */
export function save(store: Store, a: Atlas): boolean {
  if (a.aside !== null) {
    if (!store.write(ASIDE_KEY, a.aside)) return false;
    a.aside = null;
  }
  return store.write(MAP_KEY, JSON.stringify(record(a)));
}

/** what the game opens with, and whether that is saved. a map record if there is one. if not, the old
 * save moved over, which counts only once it is written. an unreadable record never falls back to
 * the old save: that would bring back a jail she has moved on from. she starts fresh, not saving
 * yet, and the unreadable one is put aside on the first save */
export function load(store: Store, levels: LevelDef[], seed: number): { atlas: Atlas; saved: boolean; from: From } {
  const raw = store.read(MAP_KEY);
  if (raw !== null) {
    const atlas = readMap(raw, levels);
    if (atlas) return { atlas, saved: true, from: "map" };
    return { atlas: { ...newAtlas(levels, seed), aside: raw }, saved: false, from: "unreadable" };
  }
  const old = fromOld(store.read(OLD_KEY), levels);
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
  const next: Atlas = { active: id, unlocked: [...a.unlocked], worlds, world, aside: a.aside };
  if (!save(store, next)) {
    a.aside = next.aside;
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
