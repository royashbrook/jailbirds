// the jail in 3d. reads the world (never changes it), blends positions between
// the last two fixed steps, and draws through the skin: the skin says what a
// character is made of and how it moves, this file puts it on screen. a 3/4
// camera orbits the warden with a saved zoom, turn and tilt. everything that comes
// in numbers (body parts, trays, bills) is one instanced mesh. the per-character
// work reuses one set of scratch matrices, colours and a pose; a few small
// allocations remain per frame (station lookups, closures), and the still parts
// of the jail are rebuilt only when something is bought.
import {
  BoxGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, Group, HemisphereLight, DirectionalLight, InstancedMesh,
  Line, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderer, DynamicDrawUsage, Euler, Quaternion,
  type Material,
} from "three";
import { WALL, walls } from "../engine/geom.ts";
import { CLEAN_TIME, DIRT_MAX, dirtSpots, isDone, isOpen, mood, padVisible, STAMP_AT, STAMP_HOLD, stampAt, stamped } from "../engine/sim.ts";
import type { Agent, AnyStation, Coin, LevelDef, Mood, Rect, RoomDef, World } from "../engine/types.ts";
import type { Action, Palette, Part, Pose, Skin } from "../skins/types.ts";
import { buildScene, PAPER_TOP, rubbleStones, STAMP_PAD, stoneColour, stoneGeometry, type Built } from "./scene.ts";
import type { CameraSettings } from "./camera.ts";

/** where everyone stood one step ago, by id */
export type Past = Map<number, { x: number; y: number; walk: number }>;
export const remember = (w: World, into: Past): Past => {
  for (const a of w.agents) {
    const p = into.get(a.id);
    if (p) (p.x = a.x), (p.y = a.y), (p.walk = a.walk);
    else into.set(a.id, { x: a.x, y: a.y, walk: a.walk });
  }
  forget(w, into);
  return into;
};
/** drop what is kept by id for anyone no longer in the world (released, or a new game) */
export function forget(w: World, kept: Map<number, unknown>) {
  if (kept.size <= w.agents.length) return;
  for (const id of kept.keys()) if (!w.agents.some((a) => a.id === id)) kept.delete(id);
}

/** how far a follower of the warden sways side to side as it goes, in world units: a waddle, not a step */
export const SWAY = 1.2;
/** the sim's body radius: within this of a wall the sway is gone */
const BODY = 10;
/** a follower's own feel, by id: where it starts in its idle and sway cycles, how fast they run, and how
 * quickly it turns. steps of the golden ratio spread ids apart, so any two in a line are out of step */
export function feel(id: number) {
  const u = (id * 0.6180339887) % 1, v = (id * 0.7548776662) % 1;
  return { phase: u * Math.PI * 2, rate: 0.85 + 0.3 * v, turn: 0.7 + 0.6 * u };
}
/** room from a point to the nearest wall piece */
export function clearance(x: number, y: number, ws: Rect[]) {
  let best = Infinity;
  for (const r of ws) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
/** a follower's sideways sway at time `t`, as an offset across its heading. it fades out as a wall comes
 * within a body's width, so a narrow door or a corner never draws anyone into the wall. drawing only:
 * the sim never sees it */
export function sway(id: number, t: number, x: number, y: number, heading: number, ws: Rect[]) {
  const f = feel(id);
  const room = Math.max(0, Math.min(1, (clearance(x, y, ws) - BODY) / 8));
  const s = Math.sin(t * 2.4 * f.rate + f.phase) * SWAY * room;
  return { x: Math.cos(heading) * s, y: -Math.sin(heading) * s };
}

/** what a character is doing, for the skin to pose. only someone ok sleeps */
export function actionOf(w: World, l: LevelDef, a: Agent): Action {
  if (a.state === "fight") return "fight";
  if (a.state === "use") {
    const st = l.stations.find((s) => s.id === a.station);
    if (st?.kind === "sink") return a.carry ? "eat" : "sit";
    if (st?.kind === "facility") return st.zone ? "wash" : "sit";
  }
  if (a.moving) return "walk";
  if (a.kind === "agent" && a.state === "home" && a.rest > 3 && mood(l, a) === "ok" && !isDone(l, a)) return "sleep";
  if (a.kind === "player" || a.kind === "cleaner") {
    for (const ms of w.messes) if (ms.clean > 0 && Math.hypot(ms.x - a.x, ms.y - a.y) < 22) return "clean";
    for (const s of dirtSpots(l)) {
      const d = w.dirt[s.key];
      if (d && d.level > 0 && d.clean > 0 && Math.hypot(s.at.x - a.x, s.at.y - a.y) < 22) return "clean";
    }
  }
  return "stand";
}
/** how a character's face looks: a resident at home by the one mood judge, anyone else ok */
export const poseMood = (l: LevelDef, a: Agent): Mood => (a.kind === "agent" && a.house ? mood(l, a) : "ok");
/** how much of a clogged toilet is drawn, by whole levels: 0 clean, 1 brown in the bowl, and one more
 * swirl beside it for each level past that, up to the most */
export const dirtStage = (level: number) => (level <= 0 ? 0 : Math.min(DIRT_MAX, Math.max(1, Math.floor(level + 1e-9))));

/** the stamp at the release desk, as a time into someone's stand at the desk (the sim's own `t`, or
 * -1 for nobody there): `over` 0 waits on the ink pad and 1 is over the papers, `lift` is how high
 * above where it sits, `sheet` their papers lying on the stack, `mark` the red mark on them. it
 * lifts off the pad, swings over the papers and comes down with a slam just as the sim says it
 * does, sits there a moment, then goes back. written into `out`, so nothing is made per frame */
export interface StampPose { over: number; lift: number; sheet: boolean; mark: boolean }
export const STAMP_UP = 18;
/** seconds the stamp stays pressed down on the papers after it lands */
export const STAMP_PRESS = 0.12;
export function stampPose(t: number, out: StampPose): StampPose {
  out.over = out.lift = 0;
  out.sheet = t >= 0;
  out.mark = t >= STAMP_AT - 1e-9;
  if (t < 0) return out;
  const ease = (k: number) => k * k * (3 - 2 * k);
  if (t < STAMP_AT) {
    const k = t / STAMP_AT;
    out.over = ease(Math.min(1, k / 0.6));
    // up to the top by three quarters of the way, then down hard: faster and faster till it hits
    out.lift = k < 0.75 ? STAMP_UP * ease(k / 0.75) : STAMP_UP * (1 - ((k - 0.75) / 0.25) ** 2);
  } else {
    // a moment pressed down, then a little hop back to the pad
    const k = Math.min(1, Math.max(0, (t - STAMP_AT - STAMP_PRESS) / (STAMP_HOLD - STAMP_AT - STAMP_PRESS)));
    out.over = 1 - ease(k);
    out.lift = Math.sin(k * Math.PI) * 8;
  }
  return out;
}
/** whose stamp is shown when more than one stands at the desk. a stamp just come down holds the
 * picture for its press, so every thunk is seen landing on its own marked papers; then the next one
 * due to come down; when all are stamped, the one stamped last. -1 for nobody standing there */
export function stampTime(w: World, st: string) {
  let pressed = Infinity, next = -1, last = Infinity;
  for (const a of w.agents) {
    if (a.state !== "stamp" || a.station !== st || a.path.length) continue;
    if (!stamped(a)) next = Math.max(next, a.t);
    else {
      last = Math.min(last, a.t);
      if (a.t < STAMP_AT + STAMP_PRESS) pressed = Math.min(pressed, a.t);
    }
  }
  return pressed < Infinity ? pressed : next >= 0 ? next : last < Infinity ? last : -1;
}

/** real seconds a landing stays drawn once the screen sees it, however many steps came in that frame */
export const STAMP_BEAT = 0.15;
/** the stamp as a screen draws it, frame by frame. a stamp the screen sees come down (someone at the
 * desk stamped who was not, the last time it looked) is drawn landed on marked papers for STAMP_BEAT
 * of real time from that frame, so the slam is on screen when its thunk plays even when a slow frame
 * carries a quarter second of steps. otherwise it is `stampPose` of `stampTime`. `now` is real seconds.
 * keeps only the ids of those at the desk already seen stamped, nothing made per frame */
export function stampLatch() {
  const seen: number[] = [];
  let until = -Infinity, first = true;
  return (w: World, st: string, now: number, out: StampPose): StampPose => {
    // forget whoever has left the desk (or the world: a new game starts its ids over)
    for (let i = seen.length - 1; i >= 0; i--) {
      const a = w.agents.find((x) => x.id === seen[i]);
      if (!a || a.state !== "stamp" || a.station !== st) seen.splice(i, 1);
    }
    let landed = false;
    for (const a of w.agents)
      if (a.state === "stamp" && a.station === st && stamped(a) && !seen.includes(a.id)) {
        seen.push(a.id);
        landed = true;
      }
    // one already stamped when the game is opened came down before anyone was looking
    if (landed && !first) until = now + STAMP_BEAT;
    first = false;
    if (now < until) {
      out.over = 1;
      out.lift = 0;
      out.sheet = out.mark = true;
      return out;
    }
    return stampPose(stampTime(w, st), out);
  };
}

/** seconds the rubble of a cell just cleared takes to tumble away */
export const REVEAL_S = 0.6;
/** seconds a cell just cleared glows instead, with less motion */
export const GLOW_S = 0.9;
/** the cells to show cleared when the still parts are rebuilt: drawn as rubble last time and not now,
 * and only when this same jail has bought more since. `was` null is a jail not drawn yet (opened,
 * travelled to, started over): what is open there was open before anyone looked, so nothing replays */
export function cleared(was: readonly string[] | null, now: readonly string[], grew: boolean): string[] {
  if (!was || !grew) return [];
  return was.filter((id) => !now.includes(id));
}

/** cells being cleared at once, at most: a cell is bought one at a time, so this is room to spare */
const MAX_REVEALS = 6;
const MAX_ROCKS = MAX_REVEALS * 32;
/** puffs of dust round each cell being cleared, their colour, and the glow it gets with less motion */
const DUST = 8;
const DUST_COLOUR = "#ece4d6";
const GLOW = "#fff2bf";

const MAX_CHARS = 64;
const MAX_TRAYS = 160;
const MAX_COINS = 320;
const MAX_FLY = 48;
const MAX_MESS = 40;
const MAX_BAGS = 8;
const BAG = "#c8a165";
/** the little grey cloud over someone upset */
const CLOUD = "#9ea4ad";
/** where the lumps of a clogged toilet sit, from the toilet, for each level past the first: out on the
 * floor in front of it, spreading towards where it is cleaned from */
const SPREAD = [[-8, 11], [-15, 15], [-6, 19]] as const;
/** how tall the safe stands in scene.ts, so its coins sit on top of it */
const SAFE_TOP = 16;
/** money is drawn as little flat bills, not coins: long, thin and wide */
export const BILL = { w: 9, h: 0.6, d: 5 };
export const billGeometry = () => new BoxGeometry(BILL.w, BILL.h, BILL.d);
/** every other bill a shade darker, so a pile reads as a stack of bills */
const BILL_SHADE = 0.82;
const FOV = 34;
const PIXEL_CAP = 2;
/** how much higher the warden sits on the unicorn: his hips on her saddle */
const SADDLE = 14;
/** the warden rides the unicorn while her ride lasts */
const riding = (w: World) => w.mountKind === "unicorn" && w.boosted > 0;

type S<K extends AnyStation["kind"]> = Extract<AnyStation, { kind: K }>;

export interface ScreenPoint { x: number; y: number; on: boolean }

export function createView(canvas: HTMLCanvasElement, skin: Skin) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(PIXEL_CAP, window.devicePixelRatio || 1));
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 10, 4000);
  const hemi = new HemisphereLight(0xffffff, 0xb8a890, 2.1);
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(-0.4, 1, 0.55);
  scene.add(hemi, sun);

  let pal: Palette = skin.palette(false);
  let built: Built | null = null;
  let builtLevel = "", builtBought = -1, builtPal: Palette | null = null;
  // the walls as residents meet them, for the followers' sway; they change only when the scene is rebuilt
  let wallsNow: Rect[] = [];
  const dynamic = new Group();
  scene.add(dynamic);

  // body parts: one instanced mesh per part, shared by every character
  const parts = new Map<Part, { mesh: InstancedMesh; used: number }>();
  for (const part of Object.keys(skin.model.parts) as Part[]) {
    const mesh = new InstancedMesh(skin.model.parts[part](), new MeshLambertMaterial(), MAX_CHARS * skin.model.perCharacter[part]);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new Color());
    parts.set(part, { mesh, used: 0 });
    dynamic.add(mesh);
  }
  const pool = (geo: BufferGeometry, count: number, material: Material = new MeshLambertMaterial()) => {
    const mesh = new InstancedMesh(geo, material, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new Color());
    mesh.count = 0;
    dynamic.add(mesh);
    return mesh;
  };
  const trays = pool(new BoxGeometry(18, 1.6, 12), MAX_TRAYS);
  const food = pool(new SphereGeometry(2.4, 8, 6), MAX_TRAYS * 2);
  const coins = pool(billGeometry(), MAX_COINS);
  const blobs = pool(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAX_CHARS + 8, new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.22 }));
  const lumps = pool(new SphereGeometry(1, 10, 8), MAX_MESS * 3);
  const puddles = pool(new CylinderGeometry(1, 1, 0.6, 18), MAX_MESS);
  // a collector's money bag, one ball per collector with coins, a little bigger the more it holds
  const bags = pool(new SphereGeometry(4, 12, 10), MAX_BAGS);
  // three puffs of grey cloud over each upset head
  const puffs = pool(new SphereGeometry(1, 10, 8), MAX_CHARS * 3);
  // a cell just cleared: its stones tumbling away and a puff of dust, or with less motion a soft glow
  // on its floor. made once, drawn only while a clearing lasts
  const rocks = pool(stoneGeometry(), MAX_ROCKS, new MeshLambertMaterial({ flatShading: true }));
  const dust = pool(new SphereGeometry(1, 8, 6), MAX_REVEALS * DUST, new MeshLambertMaterial({ transparent: true, opacity: 0.6, depthWrite: false }));
  const glowMaterial = new MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false });
  const glows = pool(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAX_REVEALS, glowMaterial);
  rocks.visible = dust.visible = glows.visible = false;
  const calm = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  // every clearing shown since the page opened, the most stones, glow and draw calls it had in a
  // frame, and how often the still parts were built: for tests
  interface Shown { room: string; quiet: boolean; rocks: number; glow: number; calls: number }
  const reveals: { room: RoomDef; start: number; quiet: boolean; shown: Shown }[] = [];
  const revealed: Shown[] = [];
  let builds = 0;
  // the rubble as last drawn, or null when nothing of this world has been drawn yet
  let rubbleWas: string[] | null = null;
  const lockedFloor = new Color();

  // the bus, and the surprises on the floor: one each, moved about. the unicorn the warden rides
  // and the fairy in flight are their own, bigger than the ones waiting to be picked up
  const bus = makeBus();
  const skates = makeSkates();
  const pony = makeUnicorn();
  pony.group.scale.setScalar(0.45);
  const sprite = makeFairy();
  sprite.group.scale.setScalar(2.2);
  const mount = makeUnicorn();
  const fairy = makeFairy();
  fairy.group.scale.setScalar(2);
  const fairyAt = new Vector3();
  let fairyShown = false;
  dynamic.add(bus.group, skates, pony.group, sprite.group, mount.group, fairy.group);
  // the rubber stamp at the release desk and the papers it comes down on, moved about, never remade
  const stamp = makeStamp();
  dynamic.add(stamp.stamp, stamp.sheet);
  const stampNow: StampPose = { over: 0, lift: 0, sheet: false, mark: false };
  let stampDrawn = stampLatch();
  let stampLift = 0;
  // the rainbow behind a boosted warden: six coloured lines along the trail
  const RAINBOW = 24;
  const rainbow = ["#ff6b6b", "#ffb34d", "#ffe066", "#7ccf7c", "#5cb8ee", "#b79be6"].map((c) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(RAINBOW * 3), 3));
    const line = new Line(g, new LineBasicMaterial({ color: c }));
    line.frustumCulled = false;
    dynamic.add(line);
    return line;
  });

  // scratch, made once
  const dummy = new Object3D(), local = new Object3D(), root = new Matrix4(), m = new Matrix4(), tint = new Color();
  const v = new Vector3(), q = new Quaternion(), e = new Euler(), one = new Vector3(1, 1, 1);
  const target = new Vector3(), look = new Vector3();
  const pose: Pose = { kind: "agent", action: "stand", walk: 0, t: 0, look: 0, uniform: false, carry: 0, mood: "ok" };
  const headings = new Map<number, number>();
  let camReady = false;
  let cssW = 1, cssH = 1;

  // coins that were on the floor last frame, to fly the picked ones to the warden. what he picked up
  // is read off the sim's own record of it, never off a pile going down: a collector empties piles too
  let prevFloor = new Set<Coin>(), nowFloor = new Set<Coin>();
  const fly = new Float32Array(MAX_FLY * 4); // x, z, age, live
  let lastFloor = -1;
  const lastTook = new Map<string, number>();
  function launch(x: number, z: number) {
    for (let i = 0; i < MAX_FLY; i++)
      if (!fly[i * 4 + 3]) {
        fly[i * 4] = x;
        fly[i * 4 + 1] = z;
        fly[i * 4 + 2] = 0;
        fly[i * 4 + 3] = 1;
        return;
      }
  }

  /** the skin places a part in the character's own space; this puts it in the world */
  const put = (part: Part, x: number, y: number, z: number, pitch: number, yaw: number, roll: number, sx: number, sy: number, sz: number, colour: number) => {
    const slot = parts.get(part)!;
    if (slot.used >= slot.mesh.instanceMatrix.count) return;
    local.position.set(x, y, z);
    local.rotation.set(pitch, yaw, roll);
    local.scale.set(sx, sy, sz);
    local.updateMatrix();
    m.multiplyMatrices(root, local.matrix);
    slot.mesh.setMatrixAt(slot.used, m);
    slot.mesh.setColorAt(slot.used, tint.setHex(colour));
    slot.used++;
  };
  const partList = [...parts.values()];

  // counters and placers for the pooled things, reset each frame
  let tn = 0, fn = 0, bn = 0, cn = 0, ln = 0, pn = 0, gn = 0, un = 0;
  /** one brown ball, squashed by `flat` */
  const lump = (x: number, y: number, z: number, r: number, flat: number) => {
    if (ln >= lumps.instanceMatrix.count) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(r, r * flat, r);
    dummy.updateMatrix();
    lumps.setMatrixAt(ln, dummy.matrix);
    lumps.setColorAt(ln++, tint.set(pal.poop));
  };
  const blob = (x: number, z: number, r: number) => {
    if (bn >= blobs.instanceMatrix.count) return;
    dummy.position.set(x, 0.9, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(r * 2.2, 1, r * 1.6);
    dummy.updateMatrix();
    blobs.setMatrixAt(bn++, dummy.matrix);
  };
  const tray = (x: number, y: number, z: number, yaw: number) => {
    if (tn >= MAX_TRAYS) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.copy(one);
    dummy.updateMatrix();
    trays.setMatrixAt(tn, dummy.matrix);
    trays.setColorAt(tn++, tint.set(pal.tray));
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1;
      dummy.position.set(x + Math.cos(yaw) * s * 4, y + 2, z - Math.sin(yaw) * s * 4);
      dummy.updateMatrix();
      food.setMatrixAt(fn, dummy.matrix);
      food.setColorAt(fn++, tint.set(pal.food[k]));
    }
  };
  // one bill: tipped a little as it bobs or flies, flat in a pile. `shade` 1 is the darker green,
  // picked by the caller from something steady so a bill never flickers between the two
  const coin = (x: number, y: number, z: number, spin: number, s = 1, tilt = Math.PI / 10, shade = 0) => {
    if (cn >= MAX_COINS) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(tilt, spin, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    coins.setMatrixAt(cn, dummy.matrix);
    tint.set(pal.coin);
    if (shade) tint.multiplyScalar(BILL_SHADE);
    coins.setColorAt(cn++, tint);
  };
  const finish = (mesh: InstancedMesh, n: number) => {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  function resize(w: number, h: number) {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    renderer.setPixelRatio(Math.min(PIXEL_CAP, window.devicePixelRatio || 1));
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  function setDark(dark: boolean) {
    pal = skin.palette(dark);
    scene.background = new Color(pal.background);
  }
  setDark(false);

  /** how much floor to show: about 400 world units across a phone's short side,
   * more on an ipad, so a bigger screen is a bigger view, not just bigger people */
  function frame(focus: { x: number; y: number; h: number }, dt: number, settings: CameraSettings) {
    const pitch = settings.tilt * Math.PI / 180, turn = settings.turn * Math.PI / 180;
    const zoom = Math.min(1.6, Math.max(0.8, Math.min(cssW, cssH) / 400)) * settings.zoom;
    const viewH = cssH / zoom, viewW = cssW / zoom;
    // far enough back that both the width and the depth of that much floor fit
    const half = Math.tan((FOV * Math.PI) / 360);
    const dist = Math.max((viewH * Math.sin(pitch) * 0.82) / (2 * half), (viewW * 0.92) / (2 * half * camera.aspect));
    // orbit the player rather than clamping to map axes: a turned view must
    // not leave the warden offscreen when walking along an edge.
    const tx = focus.x, tz = focus.y;
    if (!camReady) target.set(tx, focus.h, tz), (camReady = true);
    // ease toward the warden: quick, never a snap. up too, when he rides high,
    // so his head stays where a standing warden's would be
    const k = 1 - Math.exp(-dt * 7);
    target.x += (tx - target.x) * k;
    target.y += (focus.h - target.y) * k;
    target.z += (tz - target.z) * k;
    const back = Math.cos(pitch) * dist;
    camera.position.set(target.x + Math.sin(turn) * back, target.y + Math.sin(pitch) * dist, target.z + Math.cos(turn) * back);
    look.set(target.x, target.y, target.z);
    camera.lookAt(look);
  }

  /** a world point (ground x, height, ground y) to css pixels on the canvas */
  function screen(x: number, h: number, y: number, out: ScreenPoint) {
    v.set(x, h, y).project(camera);
    out.x = ((v.x + 1) / 2) * cssW;
    out.y = ((1 - v.y) / 2) * cssH;
    out.on = v.z < 1 && out.x > -40 && out.y > -40 && out.x < cssW + 40 && out.y < cssH + 40;
    return out;
  }

  /** how far the warden is lifted off the floor, for anything placed over his head */
  const lift = (w: World) => (riding(w) ? SADDLE : 0);

  /** start showing a cell cleared at time `t`: a tumble, or a glow with less motion */
  function reveal(l: LevelDef, id: string, t: number) {
    const room = l.rooms.find((r) => r.id === id);
    if (!room) return;
    const quiet = !!calm?.matches, shown = { room: id, quiet, rocks: 0, glow: 0, calls: 0 };
    if (reveals.length >= MAX_REVEALS) reveals.shift();
    reveals.push({ room, start: t, quiet, shown });
    revealed.push(shown);
    if (revealed.length > 32) revealed.shift();
  }

  /** cells being cleared: each stone tumbles a little out from the middle of the heap, up and over,
   * shrinking to nothing in REVEAL_S, with dust puffing out round it, all inside the cell's walls.
   * with less motion the cell's floor glows a moment and fades, and nothing moves */
  function drawReveals(t: number) {
    let rk = 0, dk = 0, hk = 0, glow = 0;
    lockedFloor.set(pal.locked);
    const inset = WALL / 2 + 1, inside = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    for (let i = reveals.length - 1; i >= 0; i--) {
      const rv = reveals[i], age = t - rv.start;
      if (age >= (rv.quiet ? GLOW_S : REVEAL_S)) {
        reveals.splice(i, 1);
        continue;
      }
      const { x, y, w: rw, h: rh } = rv.room.rect, cx = x + rw / 2, cz = y + rh / 2;
      if (rv.quiet) {
        glow = Math.max(glow, 1 - age / GLOW_S);
        rv.shown.glow = Math.max(rv.shown.glow, 1 - age / GLOW_S);
        dummy.position.set(cx, 1.2, cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(rw - inset * 2, 1, rh - inset * 2);
        dummy.updateMatrix();
        glows.setMatrixAt(hk, dummy.matrix);
        glows.setColorAt(hk++, tint.set("#ffffff"));
        continue;
      }
      const k = age / REVEAL_S, ease = k * k * (3 - 2 * k), keep = 1 - ease, hop = Math.sin(k * Math.PI);
      const from = rk;
      for (const s of rubbleStones(rv.room)) {
        if (rk >= MAX_ROCKS) break;
        const dx = s.x - cx, dz = s.z - cz, d = Math.hypot(dx, dz) || 1, r = Math.max(s.sx, s.sy, s.sz) * keep;
        dummy.position.set(
          inside(s.x + (dx / d) * 10 * ease, x + inset + r, x + rw - inset - r),
          s.y + hop * 8,
          inside(s.z + (dz / d) * 10 * ease, y + inset + r, y + rh - inset - r),
        );
        dummy.rotation.set(s.rx + k * 4, s.ry, s.rz + k * 3);
        dummy.scale.set(s.sx * keep, s.sy * keep, s.sz * keep);
        dummy.updateMatrix();
        rocks.setMatrixAt(rk, dummy.matrix);
        rocks.setColorAt(rk++, stoneColour(s, lockedFloor, tint));
      }
      rv.shown.rocks = Math.max(rv.shown.rocks, rk - from);
      for (let j = 0; j < DUST && dk < MAX_REVEALS * DUST; j++) {
        const a = (j / DUST) * Math.PI * 2 + 0.4, spread = 8 + 20 * ease, size = (3 + 5 * k) * hop;
        dummy.position.set(
          inside(cx + Math.cos(a) * spread, x + inset + size, x + rw - inset - size),
          3 + 7 * ease,
          inside(cz + Math.sin(a) * spread * 1.4, y + inset + size, y + rh - inset - size),
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(size, size * 0.8, size);
        dummy.updateMatrix();
        dust.setMatrixAt(dk, dummy.matrix);
        dust.setColorAt(dk++, tint.set(DUST_COLOUR));
      }
    }
    glowMaterial.opacity = 0.45 * glow;
    finish(rocks, rk);
    finish(dust, dk);
    finish(glows, hk);
    // hidden while nothing is being cleared, so an ordinary frame does not even look at them
    rocks.visible = rk > 0;
    dust.visible = dk > 0;
    glows.visible = hk > 0;
  }

  function render(w: World, l: LevelDef, past: Past | null, alpha: number, now: number, dt: number, settings: CameraSettings) {
    const t = now / 1000;
    // rebuild the still parts only when the level, what is bought, or the palette changes
    if (l.id !== builtLevel || w.bought.length !== builtBought || pal !== builtPal) {
      const grew = l.id === builtLevel && w.bought.length > builtBought;
      if (built) {
        scene.remove(built.group);
        built.dispose();
      }
      built = buildScene(l, w, pal);
      builds++;
      // a cell bought just now: the sim has opened it already, this only shows it being cleared
      for (const id of cleared(rubbleWas, built.rubble, grew)) reveal(l, id, t);
      rubbleWas = built.rubble;
      wallsNow = walls(l, (r) => isOpen(w, r.locked), true);
      scene.add(built.group);
      builtLevel = l.id;
      builtBought = w.bought.length;
      builtPal = pal;
    }

    // where each character stands this frame, blended between steps
    const me = w.agents[0], mp = past?.get(me.id);
    const fx = mp ? mp.x + (me.x - mp.x) * alpha : me.x, fy = mp ? mp.y + (me.y - mp.y) * alpha : me.y;
    frame({ x: fx, y: fy, h: lift(w) }, dt, settings);

    forget(w, headings);
    for (const p of partList) p.used = 0;
    tn = fn = bn = cn = ln = pn = gn = un = 0;
    const onUnicorn = riding(w);
    let meHeading = 0, meWalk = 0;

    for (const a of w.agents) {
      const p = past?.get(a.id);
      let x = p ? p.x + (a.x - p.x) * alpha : a.x, z = p ? p.y + (a.y - p.y) * alpha : a.y;
      // the warden's line: each its own sway, idle and turn, so they do not move as one
      const led = a.kind === "agent" && a.state === "follow" && a.leader === me.id;
      const own = led ? feel(a.id) : null;
      const walk = p ? p.walk + (a.walk - p.walk) * alpha : a.walk;
      // on the unicorn the warden sits, up on her saddle
      const mounted = a.kind === "player" && onUnicorn;
      const action = mounted ? "sit" : actionOf(w, l, a);
      const up = mounted ? SADDLE : 0;
      // face the way it is going, turning smoothly; in a bunk, lie along it
      let heading = headings.get(a.id) ?? 0;
      if (p && (Math.abs(a.x - p.x) > 0.01 || Math.abs(a.y - p.y) > 0.01)) {
        const want = Math.atan2(a.x - p.x, a.y - p.y);
        let d = want - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += d * Math.min(1, dt * 14 * (own?.turn ?? 1));
      }
      if (action === "sleep") heading = Math.PI;
      if (action === "fight" && w.alert) {
        // a squabble: the two come out of their bunks and square up in the doorway,
        // face to face, so it reads as a fight and not a bad dream
        const side = w.alert.ids.indexOf(a.id) === 0 ? -1 : 1;
        x = w.alert.x + side * 9;
        z = w.alert.y;
        heading = side * -Math.PI / 2;
      }
      if (action === "sit" || action === "eat") {
        // at a table, face it
        const st = l.stations.find((s) => s.id === a.station);
        if (st?.kind === "sink") heading = st.seats[a.seat].at.y < st.prop.y ? 0 : Math.PI;
      }
      headings.set(a.id, heading);
      if (own) {
        const off = sway(a.id, t, x, z, heading, wallsNow);
        x += off.x;
        z += off.y;
      }
      if (a.kind === "player") (meHeading = heading), (meWalk = walk);

      pose.kind = a.kind;
      pose.action = action;
      pose.walk = walk;
      pose.t = own ? t * own.rate + own.phase : t + a.id * 0.37;
      pose.look = a.look;
      pose.uniform = a.tags.includes("uniform");
      pose.carry = a.kind === "agent" ? 0 : a.carry;
      pose.mood = poseMood(l, a);
      const r = skin.model.root(pose);
      e.set(r.pitch, heading, 0, "YXZ");
      q.setFromEuler(e);
      v.set(x, r.lift + up, z);
      root.compose(v, q, one);
      skin.model.pose(pose, put);
      if (!mounted) blob(x, z, action === "sleep" ? 9 : 8);
      // upset: a small grey cloud hangs over the head, drifting a little
      if (pose.mood === "upset")
        for (let k = 0; k < 3 && un < MAX_CHARS * 3; k++) {
          const pr = k === 1 ? 3.4 : 2.6, drift = Math.sin(pose.t * 1.5) * 1.2;
          dummy.position.set(x + (k - 1) * 3.6 + drift, r.lift + skin.model.height + 5 + (k === 1 ? 1.2 : 0), z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(pr, pr * 0.8, pr);
          dummy.updateMatrix();
          puffs.setMatrixAt(un, dummy.matrix);
          puffs.setColorAt(un++, tint.set(CLOUD));
        }

      // a carried stack, held up in front
      const ca = skin.model.carryAt;
      for (let k = 0; k < pose.carry; k++)
        tray(x + Math.sin(heading) * ca.forward, up + ca.up + k * ca.step, z + Math.cos(heading) * ca.forward, heading);
      if (action === "eat") tray(x + Math.sin(heading) * 9, 11, z + Math.cos(heading) * 9, heading);
      // a collector's bag, hanging at its side
      if (a.kind === "collector" && a.cash > 0 && gn < MAX_BAGS) {
        const s = 1 + Math.min(0.6, a.cash / 50);
        dummy.position.set(x + Math.cos(heading) * 9, 6 * s, z - Math.sin(heading) * 9);
        dummy.rotation.set(0, heading, 0);
        dummy.scale.set(s, s * 0.9, s);
        dummy.updateMatrix();
        bags.setMatrixAt(gn, dummy.matrix);
        bags.setColorAt(gn++, tint.set(BAG));
        // and the money in it: a bill or two poking out of the top
        for (let k = 0; k < (a.cash > 6 ? 2 : 1); k++)
          coin(x + Math.cos(heading) * (9 + (k ? 1.5 : -1)), 9.5 * s, z - Math.sin(heading) * (9 + (k ? 1.5 : -1)), heading + (k ? 0.5 : -0.3), 0.7, 1.2, k);
      }
    }
    for (const p of partList) {
      p.mesh.count = p.used;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }

    // trays waiting on tables
    for (const s of l.stations) {
      if (s.kind !== "sink" || !isOpen(w, s.locked)) continue;
      const n = w.stock[s.id] ?? 0;
      for (let k = 0; k < n; k++) tray(s.prop.x + 25 + (k % 3) * 50, 10.8, s.prop.y + (k < 3 ? 9 : 25), 0);
    }

    // bills on the floor bob and spin; picked ones fly to the warden
    nowFloor.clear();
    for (let i = 0; i < w.floor.length; i++) {
      const c = w.floor[i];
      nowFloor.add(c);
      coin(c.x, 4 + Math.abs(Math.sin(t * 3 + i)) * 2, c.y, t * 3 + i, 1, Math.PI / 10, Math.round(c.x + c.y) & 1);
    }
    if (lastFloor >= 0 && w.took.floor > lastFloor) for (const c of prevFloor) if (!nowFloor.has(c)) launch(c.x, c.y);
    [prevFloor, nowFloor] = [nowFloor, prevFloor];
    for (const s of l.stations) {
      if (s.kind !== "checkin" && s.kind !== "release" && s.kind !== "safe") continue;
      const n = w.piles[s.id] ?? 0, took = w.took.piles[s.id] ?? 0, was = lastTook.get(s.id) ?? took;
      if (lastFloor >= 0 && took > was) for (let k = 0; k < Math.min(8, took - was); k++) launch(s.pileAt.x + (k % 3) * 4 - 4, s.pileAt.y);
      lastTook.set(s.id, took);
      // the safe's money sits on top of it, the desks' on the floor: two neat piles of bills,
      // flat, each one turned a hair so the pile does not look like one block
      const up = s.kind === "safe" ? SAFE_TOP : 0;
      for (let k = 0; k < Math.min(14, Math.ceil(n / 2)); k++) {
        const layer = Math.floor(k / 2);
        coin(s.pileAt.x + (k % 2 ? 5.5 : -5.5), up + 0.3 + layer * 0.75, s.pileAt.y, ((layer % 3) - 1) * 0.07, 1, 0, layer & 1);
      }
    }
    lastFloor = w.took.floor;
    for (let i = 0; i < MAX_FLY; i++) {
      if (!fly[i * 4 + 3]) continue;
      const age = (fly[i * 4 + 2] += dt), k = Math.min(1, age / 0.4);
      if (k >= 1) {
        fly[i * 4 + 3] = 0;
        continue;
      }
      const ease = k * k * (3 - 2 * k);
      coin(fly[i * 4] + (fx - fly[i * 4]) * ease, 6 + Math.sin(k * Math.PI) * 30 + ease * 14, fly[i * 4 + 1] + (fy - fly[i * 4 + 1]) * ease, age * 20, 1 + Math.sin(k * Math.PI) * 0.5);
    }

    // messes on the floor: a puddle, shrinking as it is cleaned
    for (const ms of w.messes) {
      const left = 1 - Math.min(1, ms.clean / CLEAN_TIME) * 0.8;
      if (pn < MAX_MESS) {
        dummy.position.set(ms.x, 1.2, ms.y);
        dummy.rotation.set(0, 0.4, 0);
        dummy.scale.set(15 * left, 1, 9 * left);
        dummy.updateMatrix();
        puddles.setMatrixAt(pn, dummy.matrix);
        puddles.setColorAt(pn++, tint.set(pal.puddle));
      }
    }
    // a clogged toilet, at the toilet: brown in the bowl from the first level, then a swirl on the floor
    // beside it for each level past that, up to the most. drawn by whole levels; the newest swirl (or the
    // bowl, at the first) shrinks as it is cleaned
    for (const s of dirtSpots(l)) {
      const d = w.dirt[s.key];
      if (!d || d.level <= 0) continue;
      const stage = dirtStage(d.level);
      const wipe = 1 - Math.min(1, d.clean / CLEAN_TIME) * 0.6;
      lump(s.seatAt.x - 3, 5.6, s.seatAt.y, 5 * (stage === 1 ? wipe : 1), 0.3);
      for (let k = 1; k < stage; k++) {
        const r = 4.5 * (k === stage - 1 ? wipe : 1), sx = s.seatAt.x + SPREAD[k - 1][0], sz = s.seatAt.y + SPREAD[k - 1][1];
        lump(sx, r * 0.5, sz, r, 0.7);
        lump(sx, r * 1.1, sz, r * 0.6, 0.8);
      }
    }

    // the bus, the skates, the rainbow
    const spawn = l.stations.find((s) => s.kind === "spawn") as S<"spawn"> | undefined;
    bus.group.visible = !!spawn && w.ride.state !== "away";
    if (spawn) {
      bus.group.position.set(w.ride.x, 0, spawn.roadY + 6);
      for (const wh of bus.wheels) wh.rotation.y = -w.ride.x / 8;
      bus.riders.visible = w.ride.state === "in";
      blob(w.ride.x, spawn.roadY + 6, 40);
    }
    // the boost on the floor, by what it is: skates, a little unicorn, a fairy in her glow
    const kind = w.boostKind;
    skates.visible = w.boost.here && kind === "skates";
    pony.group.visible = w.boost.here && kind === "unicorn";
    sprite.group.visible = w.boost.here && kind === "fairy";
    if (w.boost.here) {
      const pick = kind === "unicorn" ? pony.group : kind === "fairy" ? sprite.group : skates;
      pick.position.set(w.boost.x, (kind === "fairy" ? 14 : 2) + Math.abs(Math.sin(t * 3)) * 3, w.boost.y);
      pick.rotation.y = t * 1.5;
      if (kind === "fairy") flap(sprite, t);
      blob(w.boost.x, w.boost.y, 7);
    }
    // the unicorn the warden rides: under him, facing his way, galloping as he goes
    mount.group.visible = onUnicorn;
    if (onUnicorn) {
      mount.group.position.set(fx, 0, fy);
      mount.group.rotation.y = meHeading;
      const a = (meWalk / 40) * Math.PI * 2, go = me.moving ? 0.7 : 0;
      mount.legs.forEach((leg, k) => (leg.rotation.x = Math.sin(a + (k % 2 ? Math.PI : 0) + (k > 1 ? 0.6 : 0)) * go));
      blob(fx, fy, 14);
    }
    // the fairy in flight, eased toward where she is, with a little bob
    const flying = w.fairy.target !== null;
    fairy.group.visible = flying;
    if (flying) {
      if (!fairyShown) fairyAt.set(w.fairy.x, 0, w.fairy.y);
      const dx = w.fairy.x - fairyAt.x, dz = w.fairy.y - fairyAt.z, k = 1 - Math.exp(-dt * 18);
      fairyAt.x += dx * k;
      fairyAt.z += dz * k;
      fairy.group.position.set(fairyAt.x, 30 + Math.sin(t * 5) * 3, fairyAt.z);
      if (Math.abs(dx) + Math.abs(dz) > 0.5) fairy.group.rotation.y = Math.atan2(dx, dz);
      flap(fairy, t);
      blob(fairyAt.x, fairyAt.z, 6);
    }
    fairyShown = flying;
    // the stamp: on its ink pad until someone stands at the desk for their papers. it goes up as
    // quick as it can and comes down exactly when the sim says, so the thunk and the slam agree
    const desk = l.stations.find((s) => s.kind === "release") as S<"release"> | undefined;
    stamp.stamp.visible = stamp.sheet.visible = !!desk;
    if (desk) {
      const at = stampAt(desk), pose = stampDrawn(w, desk.id, t, stampNow);
      stampLift = pose.lift < stampLift ? pose.lift : stampLift + (pose.lift - stampLift) * (1 - Math.exp(-dt * 30));
      stamp.stamp.position.set(at.x - STAMP_PAD * (1 - pose.over), PAPER_TOP + 0.3 + stampLift, at.y);
      stamp.sheet.visible = pose.sheet;
      stamp.mark.visible = pose.mark;
      stamp.sheet.position.set(at.x, PAPER_TOP, at.y);
    }
    const trail = me.trail, high = onUnicorn ? 10 : 0;
    rainbow.forEach((line, k) => {
      line.visible = w.boosted > 0 && trail.length > 2;
      if (!line.visible) return;
      const pos = line.geometry.getAttribute("position") as Float32BufferAttribute;
      const n = Math.min(RAINBOW, trail.length);
      pos.setXYZ(0, fx, high + 3 + k * 1.4, fy);
      for (let i = 1; i < n; i++) pos.setXYZ(i, trail[i - 1].x, high + 3 + k * 1.4, trail[i - 1].y);
      pos.needsUpdate = true;
      line.geometry.setDrawRange(0, n);
    });

    finish(trays, tn);
    finish(food, fn);
    finish(coins, cn);
    finish(blobs, bn);
    finish(lumps, ln);
    finish(puddles, pn);
    finish(bags, gn);
    finish(puffs, un);
    drawReveals(t);

    // price pads: tinted by whether the rank allows them, filled by what is paid
    if (built)
      for (const pm of built.pads) {
        const show = padVisible(w, pm.pad);
        pm.frame.visible = pm.fill.visible = show;
        if (!show) continue;
        (pm.frame.material as MeshBasicMaterial).color.set(w.rank >= (pm.pad.rank ?? 0) ? pal.pad : pal.padLocked);
        pm.fill.scale.x = Math.max(0.0001, ((w.paid[pm.pad.id] ?? 0) / pm.pad.cost) * pm.w);
      }

    renderer.render(scene, camera);
    // what a frame with a clearing in it cost to draw, measured, not assumed
    for (const rv of reveals) rv.shown.calls = Math.max(rv.shown.calls, renderer.info.render.calls);
  }

  return {
    resize,
    setDark,
    render,
    screen,
    /** the warden on screen, for tests and screenshots */
    where: (w: World, out: ScreenPoint) => screen(w.agents[0].x, 14 + lift(w), w.agents[0].y, out),
    height: skin.model.height,
    lift,
    /** another world from here on (a trip on the map, a start over): forget what was seen of the last
     * one, kept by ids that mean someone else now, so no coin flies and no stamp lands from it */
    reset() {
      headings.clear();
      lastTook.clear();
      prevFloor.clear();
      nowFloor.clear();
      lastFloor = -1;
      fly.fill(0);
      stampDrawn = stampLatch();
      // nothing being cleared carries over, and the still parts are drawn afresh for this world, its
      // open cells taken as they are: a bought cell never shows being cleared twice
      reveals.length = 0;
      rubbleWas = null;
      builtLevel = "";
    },
    info: () => ({
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0,
      eye: camera.position.toArray(), target: look.toArray(),
      stamp: { x: stamp.stamp.position.x, y: stamp.stamp.position.y, sheet: stamp.sheet.visible, mark: stamp.mark.visible },
      rubble: {
        rooms: built ? [...built.rubble] : [], stones: built?.stones ?? 0, builds,
        clearing: reveals.map((r) => r.room.id), revealed: revealed.map((r) => ({ ...r })),
      },
    }),
    dispose() {
      built?.dispose();
      renderer.dispose();
    },
  };
}

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function makeBus() {
  const group = new Group();
  const mat = (c: string) => new MeshLambertMaterial({ color: c });
  const body = new Mesh(new BoxGeometry(110, 30, 38), mat("#f2b84b"));
  body.position.y = 21;
  const roof = new Mesh(new BoxGeometry(104, 4, 34), mat("#ffd27a"));
  roof.position.y = 38;
  const glass = mat("#cfeeff");
  const riders = new Group();
  for (let k = 0; k < 4; k++) {
    const win = new Mesh(new BoxGeometry(18, 12, 1), glass);
    win.position.set(-36 + k * 24, 27, 19.2);
    group.add(win);
    if (k < 3) {
      const head = new Mesh(new SphereGeometry(4, 10, 8), mat(["#f1d3a8", "#d49f74", "#e6bb8e"][k]));
      head.position.set(-36 + k * 24, 27, 16);
      riders.add(head);
    }
  }
  const wheels: Mesh[] = [];
  for (const x of [-34, 34])
    for (const z of [-17, 17]) {
      const wh = new Mesh(new CylinderGeometry(8, 8, 6, 14), mat("#3a2e2b"));
      wh.rotation.x = Math.PI / 2;
      wh.position.set(x, 8, z);
      wheels.push(wh);
      group.add(wh);
    }
  group.add(body, roof, riders);
  return { group, wheels, riders };
}

/** a white unicorn facing +z: body, four legs that swing from the hip, a neck and head, a gold horn,
 * a pink mane and tail, and a saddle on top at the height the warden's hips sit */
function makeUnicorn() {
  const group = new Group();
  const mat = (c: string) => new MeshLambertMaterial({ color: c });
  const white = mat("#fbf8ff"), pink = mat("#ff8fc8"), gold = mat("#ffcf33"), dark = mat("#2a2230");
  const add = (mesh: Mesh, x: number, y: number, z: number, pitch = 0, parent: Object3D = group) => {
    mesh.position.set(x, y, z);
    mesh.rotation.x = pitch;
    parent.add(mesh);
    return mesh;
  };
  // the body: a long capsule, its back just under the saddle
  add(new Mesh(new CapsuleGeometry(4.5, 13, 6, 12), white), 0, 16.5, 0, Math.PI / 2);
  add(new Mesh(new BoxGeometry(8, 1, 8), pink), 0, 21.3, -0.5);
  // legs from the hips, each a pivot so it can swing
  const legs: Group[] = [];
  for (const z of [7.5, -7.5])
    for (const x of [-2.8, 2.8]) {
      const hip = new Group();
      hip.position.set(x, 13, z);
      add(new Mesh(new CylinderGeometry(1.5, 1.3, 12, 8), white), 0, -6, 0, 0, hip);
      add(new Mesh(new CylinderGeometry(1.5, 1.6, 1.6, 8), gold), 0, -12.2, 0, 0, hip);
      group.add(hip);
      legs.push(hip);
    }
  // the neck leaning forward, the head on top, well in front of the rider
  add(new Mesh(new BoxGeometry(4.5, 12, 5), white), 0, 24.5, 12, 0.45);
  add(new Mesh(new BoxGeometry(5, 5.5, 10), white), 0, 30.5, 16.5, 0.3);
  add(new Mesh(new CylinderGeometry(0, 1, 8, 10), gold), 0, 36, 18.5, 0.6);
  for (const side of [-1, 1]) {
    add(new Mesh(new SphereGeometry(0.8, 8, 6), dark), side * 2.6, 32, 18.5);
    add(new Mesh(new CylinderGeometry(0, 1, 3, 6), white), side * 1.6, 34.5, 13.5, -0.2);
  }
  // the mane down the back of the neck, and the tail
  add(new Mesh(new BoxGeometry(1.8, 13, 3), pink), 0, 26, 9.6, 0.45);
  add(new Mesh(new BoxGeometry(2.2, 2, 4), pink), 0, 33.6, 13.4, 0.3);
  add(new Mesh(new CylinderGeometry(1.6, 0.7, 13, 8), pink), 0, 14, -14.5, 0.64);
  return { group, legs };
}

/** a little fairy: a body, a head, two wings that flap on their pivots, and a soft glow round her */
function makeFairy() {
  const group = new Group();
  const body = new Mesh(new SphereGeometry(2.2, 10, 8), new MeshLambertMaterial({ color: "#c9a2ff" }));
  body.scale.set(1, 1.4, 1);
  const head = new Mesh(new SphereGeometry(1.7, 10, 8), new MeshLambertMaterial({ color: "#f6dcc0" }));
  head.position.y = 4;
  const hair = new Mesh(new SphereGeometry(1.8, 10, 8), new MeshLambertMaterial({ color: "#ffcf33" }));
  hair.position.set(0, 4.6, -0.4);
  hair.scale.set(1, 0.7, 1);
  const glow = new Mesh(new SphereGeometry(6, 14, 10), new MeshBasicMaterial({ color: "#fff3a6", transparent: true, opacity: 0.3, depthWrite: false }));
  const wingMat = new MeshBasicMaterial({ color: "#ffd6f0", transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false });
  const wings: Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(0, 1.5, -1.2);
    const wing = new Mesh(new PlaneGeometry(6, 7), wingMat);
    wing.position.set(side * 3, 1, 0);
    pivot.add(wing);
    group.add(pivot);
    wings.push(pivot);
  }
  group.add(body, head, hair, glow);
  return { group, wings };
}
/** her wings beat fast, both together */
function flap(f: { wings: Group[] }, t: number) {
  const open = 0.5 + Math.sin(t * 30) * 0.5;
  f.wings[0].rotation.y = open;
  f.wings[1].rotation.y = -open;
}

/** a big rubber stamp standing on its base: a red rubber foot, a wooden stem and a round knob on top,
 * its bottom at the group's origin. and a sheet of release papers with a red square for the mark */
function makeStamp() {
  const stamp = new Group();
  const red = new MeshLambertMaterial({ color: "#e5484d" }), wood = new MeshLambertMaterial({ color: "#6b4b3a" });
  const foot = new Mesh(new BoxGeometry(12, 4, 10), red);
  foot.position.y = 2;
  const stem = new Mesh(new CylinderGeometry(2, 2.4, 9, 10), wood);
  stem.position.y = 8.5;
  const knob = new Mesh(new SphereGeometry(4.5, 12, 10), wood);
  knob.position.y = 15;
  stamp.add(foot, stem, knob);
  const sheet = new Group();
  const page = new Mesh(new BoxGeometry(16, 0.3, 20), new MeshLambertMaterial({ color: "#ffffff" }));
  page.position.y = 0.15;
  const mark = new Mesh(new BoxGeometry(10, 0.2, 8), red);
  mark.position.y = 0.4;
  sheet.add(page, mark);
  sheet.visible = mark.visible = false;
  return { stamp, sheet, mark };
}

function makeSkates() {
  const group = new Group();
  const pink = new MeshLambertMaterial({ color: "#ff8fc8" }), blue = new MeshLambertMaterial({ color: "#7cc6ee" });
  for (const side of [-1, 1]) {
    const boot = new Mesh(new BoxGeometry(6, 9, 6), pink);
    boot.position.set(side * 5, 7, -2);
    const sole = new Mesh(new BoxGeometry(6, 2.5, 13), pink);
    sole.position.set(side * 5, 3, 1);
    group.add(boot, sole);
    for (const z of [-4, 0, 4, 8]) {
      const wh = new Mesh(new CylinderGeometry(1.8, 1.8, 2, 10), blue);
      wh.rotation.z = Math.PI / 2;
      wh.position.set(side * 5, 1.4, z - 2);
      group.add(wh);
    }
  }
  return group;
}
