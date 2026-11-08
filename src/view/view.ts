// the jail in 3d. reads the world (never changes it), blends positions between
// the last two fixed steps, and draws through the skin: the skin says what a
// character is made of and how it moves, this file puts it on screen. a 3/4
// camera looks down at about 55 degrees and follows the warden. everything that
// comes in numbers (body parts, trays, coins) is one instanced mesh, and nothing
// is allocated per frame once it is running.
import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, HemisphereLight, DirectionalLight, InstancedMesh,
  Line, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3, WebGLRenderer, DynamicDrawUsage, Euler, Quaternion,
  type Material,
} from "three";
import { isDone, isOpen, mood, padVisible } from "../engine/sim.ts";
import type { Agent, AnyStation, Coin, LevelDef, World } from "../engine/types.ts";
import type { Action, Palette, Part, Pose, Skin } from "../skins/types.ts";
import { buildScene, type Built } from "./scene.ts";

/** where everyone stood one step ago, by id */
export type Past = Map<number, { x: number; y: number; walk: number }>;
export const remember = (w: World, into: Past): Past => {
  for (const a of w.agents) {
    const p = into.get(a.id);
    if (p) (p.x = a.x), (p.y = a.y), (p.walk = a.walk);
    else into.set(a.id, { x: a.x, y: a.y, walk: a.walk });
  }
  return into;
};

const MAX_CHARS = 64;
const MAX_TRAYS = 160;
const MAX_COINS = 320;
const MAX_FLY = 48;
const MAX_MESS = 40;
const PITCH = (50 * Math.PI) / 180;
const FOV = 34;
const PIXEL_CAP = 2;

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
  const coins = pool(new CylinderGeometry(3.6, 3.6, 1.4, 16), MAX_COINS);
  const blobs = pool(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAX_CHARS + 8, new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.22 }));
  const lumps = pool(new SphereGeometry(1, 10, 8), MAX_MESS * 3);
  const puddles = pool(new CylinderGeometry(1, 1, 0.6, 18), MAX_MESS);

  // the bus and the skates: one each, moved about
  const bus = makeBus();
  const skates = makeSkates();
  dynamic.add(bus.group, skates);
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

  // coins that were on the floor last frame, to fly the picked ones to the warden
  let prevFloor = new Set<Coin>(), nowFloor = new Set<Coin>();
  const fly = new Float32Array(MAX_FLY * 4); // x, z, age, live
  let lastCoins = -1;
  const lastPiles = new Map<string, number>();
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
  let tn = 0, fn = 0, bn = 0, cn = 0, ln = 0, pn = 0;
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
  const coin = (x: number, y: number, z: number, spin: number, s = 1) => {
    if (cn >= MAX_COINS) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(Math.PI / 8, spin, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    coins.setMatrixAt(cn, dummy.matrix);
    coins.setColorAt(cn++, tint.set(pal.coin));
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
  function frame(l: LevelDef, focus: { x: number; y: number }, dt: number) {
    const zoom = Math.min(1.6, Math.max(0.8, Math.min(cssW, cssH) / 400));
    const viewH = cssH / zoom, viewW = cssW / zoom;
    // far enough back that both the width and the depth of that much floor fit
    const half = Math.tan((FOV * Math.PI) / 360);
    const dist = Math.max((viewH * Math.sin(PITCH) * 0.82) / (2 * half), (viewW * 0.92) / (2 * half * camera.aspect));
    // keep the jail filling the frame: clamp where the camera looks so the frustum's
    // far and near edges, where they meet the floor, stay near the map's edges
    const h = Math.sin(PITCH) * dist, back = Math.cos(PITCH) * dist, f = (FOV * Math.PI) / 360;
    const far = back - h / Math.tan(PITCH - f), near = back - h / Math.tan(PITCH + f);
    const halfW = dist * half * camera.aspect, margin = 30;
    const span = (lo: number, hi: number, c: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, c)));
    const tx = span(halfW - margin, l.size.w - halfW + margin, focus.x);
    const tz = span(-margin - far, l.size.h + margin - near, focus.y);
    if (!camReady) target.set(tx, 0, tz), (camReady = true);
    // ease toward the warden: quick, never a snap
    const k = 1 - Math.exp(-dt * 7);
    target.x += (tx - target.x) * k;
    target.z += (tz - target.z) * k;
    camera.position.set(target.x, Math.sin(PITCH) * dist, target.z + Math.cos(PITCH) * dist);
    look.set(target.x, 0, target.z);
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

  function actionOf(w: World, l: LevelDef, a: Agent): Action {
    if (a.state === "fight") return "fight";
    if (a.state === "use") {
      const st = l.stations.find((s) => s.id === a.station);
      if (st?.kind === "sink") return a.carry ? "eat" : "sit";
      if (st?.kind === "facility") return st.zone ? "wash" : "sit";
    }
    if (a.moving) return "walk";
    if (a.kind === "agent" && a.state === "home" && a.rest > 3 && mood(l, a) === "ok" && !isDone(l, a)) return "sleep";
    if (a.kind === "player" || a.kind === "cleaner")
      for (const ms of w.messes) if (ms.clean > 0 && Math.hypot(ms.x - a.x, ms.y - a.y) < 22) return "clean";
    return "stand";
  }

  function render(w: World, l: LevelDef, past: Past | null, alpha: number, now: number, dt: number) {
    const t = now / 1000;
    // rebuild the still parts only when the level, what is bought, or the palette changes
    if (l.id !== builtLevel || w.bought.length !== builtBought || pal !== builtPal) {
      if (built) {
        scene.remove(built.group);
        built.dispose();
      }
      built = buildScene(l, w, pal);
      scene.add(built.group);
      builtLevel = l.id;
      builtBought = w.bought.length;
      builtPal = pal;
    }

    // where each character stands this frame, blended between steps
    const me = w.agents[0], mp = past?.get(me.id);
    const fx = mp ? mp.x + (me.x - mp.x) * alpha : me.x, fy = mp ? mp.y + (me.y - mp.y) * alpha : me.y;
    frame(l, { x: fx, y: fy }, dt);

    for (const p of partList) p.used = 0;
    tn = fn = bn = cn = ln = pn = 0;

    for (const a of w.agents) {
      const p = past?.get(a.id);
      const x = p ? p.x + (a.x - p.x) * alpha : a.x, z = p ? p.y + (a.y - p.y) * alpha : a.y;
      const walk = p ? p.walk + (a.walk - p.walk) * alpha : a.walk;
      const action = actionOf(w, l, a);
      // face the way it is going, turning smoothly; in a bunk, lie along it
      let heading = headings.get(a.id) ?? 0;
      if (p && (Math.abs(a.x - p.x) > 0.01 || Math.abs(a.y - p.y) > 0.01)) {
        const want = Math.atan2(a.x - p.x, a.y - p.y);
        let d = want - heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        heading += d * Math.min(1, dt * 14);
      }
      if (action === "sleep") heading = Math.PI;
      if (action === "sit" || action === "eat") {
        // at a table, face it
        const st = l.stations.find((s) => s.id === a.station);
        if (st?.kind === "sink") heading = st.seats[a.seat].at.y < st.prop.y ? 0 : Math.PI;
      }
      headings.set(a.id, heading);

      pose.kind = a.kind;
      pose.action = action;
      pose.walk = walk;
      pose.t = t + a.id * 0.37;
      pose.look = a.look;
      pose.uniform = a.tags.includes("uniform");
      pose.carry = a.kind === "agent" ? 0 : a.carry;
      pose.mood = a.kind === "agent" && a.house ? mood(l, a) : "ok";
      const r = skin.model.root(pose);
      e.set(r.pitch, heading, 0, "YXZ");
      q.setFromEuler(e);
      v.set(x, r.lift, z);
      root.compose(v, q, one);
      skin.model.pose(pose, put);
      blob(x, z, action === "sleep" ? 9 : 8);

      // a carried stack, held up in front
      const ca = skin.model.carryAt;
      for (let k = 0; k < pose.carry; k++)
        tray(x + Math.sin(heading) * ca.forward, ca.up + k * ca.step, z + Math.cos(heading) * ca.forward, heading);
      if (action === "eat") tray(x + Math.sin(heading) * 9, 11, z + Math.cos(heading) * 9, heading);
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

    // coins on the floor bob and spin; picked ones fly to the warden
    nowFloor.clear();
    for (let i = 0; i < w.floor.length; i++) {
      const c = w.floor[i];
      nowFloor.add(c);
      coin(c.x, 4 + Math.abs(Math.sin(t * 3 + i)) * 2, c.y, t * 3 + i);
    }
    if (lastCoins >= 0 && w.coins > lastCoins) for (const c of prevFloor) if (!nowFloor.has(c)) launch(c.x, c.y);
    [prevFloor, nowFloor] = [nowFloor, prevFloor];
    for (const s of l.stations) {
      if (s.kind !== "checkin" && s.kind !== "release") continue;
      const n = w.piles[s.id] ?? 0, was = lastPiles.get(s.id) ?? 0;
      if (n < was) for (let k = 0; k < Math.min(8, was); k++) launch(s.pileAt.x + (k % 3) * 4 - 4, s.pileAt.y);
      lastPiles.set(s.id, n);
      for (let k = 0; k < Math.min(14, Math.ceil(n / 2)); k++) coin(s.pileAt.x + (k % 2 ? 6 : -6), 1.5 + Math.floor(k / 2) * 1.8, s.pileAt.y, k, 1);
    }
    lastCoins = w.coins;
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

    // messes: a little brown swirl, or a puddle, shrinking as they are cleaned
    for (const ms of w.messes) {
      const left = 1 - Math.min(1, ms.clean / 0.4) * 0.8;
      if (ms.kind === "poop") {
        for (let k = 0; k < 3 && ln < lumps.instanceMatrix.count; k++) {
          const r = (6 - k * 1.8) * left;
          dummy.position.set(ms.x, 1 + r * 0.6 + k * 3.2 * left, ms.y);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(r, r * 0.75, r);
          dummy.updateMatrix();
          lumps.setMatrixAt(ln, dummy.matrix);
          lumps.setColorAt(ln++, tint.set(pal.poop));
        }
      } else if (pn < MAX_MESS) {
        dummy.position.set(ms.x, 1.2, ms.y);
        dummy.rotation.set(0, 0.4, 0);
        dummy.scale.set(15 * left, 1, 9 * left);
        dummy.updateMatrix();
        puddles.setMatrixAt(pn, dummy.matrix);
        puddles.setColorAt(pn++, tint.set(pal.puddle));
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
    skates.visible = w.boost.here;
    if (w.boost.here) {
      skates.position.set(w.boost.x, 2 + Math.abs(Math.sin(t * 3)) * 3, w.boost.y);
      skates.rotation.y = t * 1.5;
      blob(w.boost.x, w.boost.y, 7);
    }
    const trail = me.trail;
    rainbow.forEach((line, k) => {
      line.visible = w.boosted > 0 && trail.length > 2;
      if (!line.visible) return;
      const pos = line.geometry.getAttribute("position") as Float32BufferAttribute;
      const n = Math.min(RAINBOW, trail.length);
      pos.setXYZ(0, fx, 3 + k * 1.4, fy);
      for (let i = 1; i < n; i++) pos.setXYZ(i, trail[i - 1].x, 3 + k * 1.4, trail[i - 1].y);
      pos.needsUpdate = true;
      line.geometry.setDrawRange(0, n);
    });

    finish(trays, tn);
    finish(food, fn);
    finish(coins, cn);
    finish(blobs, bn);
    finish(lumps, ln);
    finish(puddles, pn);

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
  }

  return {
    resize,
    setDark,
    render,
    screen,
    /** the warden on screen, for tests and screenshots */
    where: (w: World, out: ScreenPoint) => screen(w.agents[0].x, 14, w.agents[0].y, out),
    height: skin.model.height,
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
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
