// the still parts of the jail in 3d: floors, walls, furniture, labels and price
// pads. built from a level, what has been bought and a palette, and rebuilt only
// when one of those changes. everything of one shape shares one instanced mesh,
// so the whole jail is a handful of draw calls.
import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, SphereGeometry, SRGBColorSpace, type Material,
  type BufferGeometry,
} from "three";
import { walls } from "../engine/geom.ts";
import { isOpen, stampAt } from "../engine/sim.ts";
import type { AnyStation, LevelDef, PadDef, World } from "../engine/types.ts";
import type { Palette } from "../skins/types.ts";

export const WALL_H = 11;
/** how tall the desks stand, so what sits on them sits on top */
export const DESK_H = 13;
/** how far along the release desk the ink pad sits from the papers, where the stamp waits */
export const STAMP_PAD = 26;
/** the top of the papers' stack on the release desk */
export const PAPER_TOP = DESK_H + 1.8;
const TILE = 40;

type Shape = "box" | "cyl" | "ball" | "floor";
interface Piece { shape: Shape; x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; colour: string }

/** lambert, with a soft tile grid drawn from where each pixel sits in the world */
function tiled(): MeshLambertMaterial {
  const m = new MeshLambertMaterial();
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vTile;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvec4 tileWorld = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ntileWorld = instanceMatrix * tileWorld;\n#endif\nvTile = (modelMatrix * tileWorld).xz;",
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vTile;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 tileEdge = abs(fract(vTile / ${TILE.toFixed(1)} - 0.5) - 0.5) * ${TILE.toFixed(1)};
float tileLine = 1.0 - smoothstep(0.5, 1.5, min(tileEdge.x, tileEdge.y));
diffuseColor.rgb *= 1.0 - 0.07 * tileLine;`,
      );
  };
  return m;
}

/** a word painted flat on the floor */
function floorLabel(text: string, colour: string, size = 22): Mesh {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `800 ${size * 4}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width + 16);
  c.height = size * 5;
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(c.width / 4 / 2.2, c.height / 4 / 2.2), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** the dashed square a price pad is drawn with, white so each pad can tint it */
let padTexture: CanvasTexture | null = null;
function padFrame() {
  if (padTexture) return padTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 112, 22);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 9;
  ctx.setLineDash([18, 12]);
  ctx.stroke();
  padTexture = new CanvasTexture(c);
  return padTexture;
}

export interface PadMesh { pad: PadDef; frame: Mesh; fill: Mesh; w: number; h: number }
export interface Built { group: Group; pads: PadMesh[]; dispose(): void }

type S<K extends AnyStation["kind"]> = Extract<AnyStation, { kind: K }>;

export function buildScene(l: LevelDef, w: World, pal: Palette): Built {
  const pieces: Piece[] = [];
  const add = (shape: Shape, x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: string, ry = 0) =>
    pieces.push({ shape, x, y, z, sx, sy, sz, ry, colour });
  /** a box standing on the floor at x,z (centre), w wide, d deep, h tall */
  const box = (x: number, z: number, w: number, d: number, h: number, colour: string, y = 0) => add("box", x, y + h / 2, z, w, h, d, colour);
  const cyl = (x: number, z: number, r: number, h: number, colour: string, y = 0) => add("cyl", x, y + h / 2, z, r, h, r, colour);
  const ball = (x: number, y: number, z: number, r: number, colour: string) => add("ball", x, y, z, r, r, r, colour);
  const open = (id?: string) => isOpen(w, id);
  const group = new Group();
  const disposables: { dispose(): void }[] = [];

  // the ground, the road and its dashes
  const spawn = l.stations.find((s) => s.kind === "spawn") as S<"spawn"> | undefined;
  const roadY = spawn?.roadY ?? l.size.h;
  add("floor", l.size.w / 2, -0.5, roadY / 2 - 300, l.size.w + 2400, 1, roadY + 1200, pal.hall);
  box(l.size.w / 2, roadY + 300, l.size.w + 2400, 640, 0.6, pal.road);
  for (let x = -600; x < l.size.w + 600; x += 32) box(x, roadY + 22, 16, 3, 0.8, pal.roadLine);

  // floors, biggest first so a cell sits on top of its block
  const rooms = [...l.rooms].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  rooms.forEach((r, k) => {
    const ok = open(r.locked);
    add("floor", r.rect.x + r.rect.w / 2, 0.2 + k * 0.05, r.rect.y + r.rect.h / 2, r.rect.w, 0.6, r.rect.h, ok ? (pal.floors[r.look] ?? pal.hall) : pal.locked);
    if (r.look === "cell") {
      // two jail bunks: a metal frame, a thin grey mattress and a flat pillow
      for (const dy of [30, 82]) {
        const bx = r.rect.x + 18, bz = r.rect.y + dy - 2;
        box(bx, bz, 24, 44, 6, ok ? pal.metal : pal.locked);
        box(bx, bz + 1, 21, 40, 2.5, ok ? pal.bed : pal.locked, 6);
        box(bx, bz - 14, 16, 8, 2.5, ok ? pal.pillow : pal.locked, 8.5);
      }
    }
    if (!ok) {
      // a padlock in the middle
      const cx = r.rect.x + r.rect.w / 2, cz = r.rect.y + Math.min(r.rect.h / 2, 60);
      box(cx, cz, 16, 6, 12, pal.dark, 1);
      add("cyl", cx, 17, cz, 5, 2, 5, pal.dark);
    }
    if (ok && r.label) {
      const at = r.labelAt ?? { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h - 24 };
      const label = floorLabel(r.label, pal.label);
      label.position.set(at.x, 1.5, at.y);
      group.add(label);
      disposables.push(label.geometry, label.material as Material, (label.material as MeshBasicMaterial).map!);
    }
  });

  // low walls, with gaps for doors
  for (const wl of walls(l, (r) => open(r.locked), true)) box(wl.x + wl.w / 2, wl.y + wl.h / 2, wl.w + 2, wl.h + 2, WALL_H, pal.wall);

  // stand-here spots and furniture
  const spot = (x: number, z: number) => add("cyl", x, 1.4, z, 17, 0.4, 11, pal.spot);
  for (const s of l.stations) {
    if (s.kind === "checkin") {
      spot(s.at.x, s.at.y);
      box(s.prop.x + s.prop.w / 2, s.prop.y + s.prop.h / 2, s.prop.w, s.prop.h, 13, pal.wood);
      // a pile of folded orange shirts
      for (let k = 0; k < 3; k++) box(s.prop.x + 26, s.prop.y + s.prop.h / 2, 16, 12, 2.2, k % 2 ? "#ff8a3d" : "#ffffff", 13 + k * 2.2);
      // a little computer: a screen on a stand, and a keyboard
      const mx = s.prop.x + s.prop.w - 26, mz = s.prop.y + s.prop.h / 2;
      box(mx, mz, 3, 3, 4, pal.dark, 13);
      box(mx, mz, 18, 2, 12, pal.dark, 17);
      // facing the warden's spot behind the desk
      const toward = Math.sign(s.at.y - mz) || -1;
      box(mx, mz + toward * 1.1, 15, 0.4, 9, "#7fc8f8", 18.5);
      box(mx, mz + toward * 7, 14, 5, 1, "#e8eef4", 13);
      if (s.gate) {
        // a walk-through scanner: two posts, a top with a light, and a red beam
        box(s.gate.x - 24, s.gate.y, 6, 8, 30, pal.metal);
        box(s.gate.x + 24, s.gate.y, 6, 8, 30, pal.metal);
        box(s.gate.x, s.gate.y, 58, 10, 7, pal.dark, 30);
        box(s.gate.x, s.gate.y, 42, 1, 0.8, "#e5484d", 14);
        ball(s.gate.x, 40, s.gate.y, 3, "#7ccf7c");
      }
    } else if (s.kind === "house" && open(s.locked)) spot(s.at.x, s.at.y);
    else if (s.kind === "source") {
      spot(s.at.x, s.at.y);
      box(s.prop.x + s.prop.w / 2, s.prop.y + s.prop.h / 2, s.prop.w, s.prop.h, 14, pal.metal);
      cyl(s.prop.x + 22, s.prop.y + s.prop.h / 2, 9, 1.5, "#4b525b", 14);
      cyl(s.prop.x + 48, s.prop.y + s.prop.h / 2, 9, 1.5, "#4b525b", 14);
      // the waiting stack of trays
      for (let k = 0; k < 5; k++) {
        box(s.prop.x + s.prop.w - 22, s.prop.y + s.prop.h / 2, 18, 12, 1.6, pal.tray, 14 + k * 2.4);
      }
    } else if (s.kind === "release") {
      spot(s.at.x, s.at.y);
      box(s.prop.x + s.prop.w / 2, s.prop.y + s.prop.h / 2, s.prop.w, s.prop.h, 13, pal.wood);
      // the ink pad, and the release papers where the stamp comes down: a little stack. the big
      // rubber stamp itself moves, so it is drawn in view.ts
      const paper = stampAt(s);
      box(paper.x - STAMP_PAD, paper.y, 20, 12, 2, "#e5484d", 13);
      for (let k = 0; k < 3; k++) box(paper.x, paper.y, 16, 20, 0.6, "#ffffff", 13 + k * 0.6);
    } else if (s.kind === "sink") {
      const ok = open(s.locked);
      const c = ok ? pal.wood : pal.locked;
      box(s.prop.x + s.prop.w / 2, s.prop.y + s.prop.h / 2, s.prop.w, s.prop.h, 10, c);
      s.seats.forEach((seat) => cyl(seat.at.x, seat.at.y, 6, 6, ok && open(seat.locked) ? "#c98a4f" : pal.locked));
    } else if (s.kind === "facility") {
      s.seats.forEach((seat) => {
        const ok = open(seat.locked);
        if (s.look === "toilet") {
          cyl(seat.at.x - 3, seat.at.y, 7, 6, ok ? pal.porcelain : pal.locked);
          box(seat.at.x + 7, seat.at.y, 6, 14, 12, ok ? pal.porcelain : pal.locked);
        } else {
          box(seat.at.x, seat.at.y, 32, 28, 1.6, ok ? pal.glass : pal.locked);
          cyl(seat.at.x, seat.at.y + 14, 1.4, 34, pal.metal);
          ball(seat.at.x, 34, seat.at.y + 11, 3.5, pal.metal);
        }
      });
    } else if (s.kind === "safe") {
      // a little safe on the floor, 22 by 16, with a coin slot on top and a dial on the front
      const sx = s.pileAt.x, sz = s.pileAt.y, high = 16;
      box(sx, sz, 22, 16, high, pal.metal);
      box(sx, sz, 12, 2, 0.4, pal.dark, high);
      ball(sx, high / 2, sz + 8, 2.2, pal.dark);
    } else if (s.kind === "spawn") {
      // the stop sign
      cyl(s.at.x - 66, s.at.y, 1.6, 30, pal.dark);
      add("cyl", s.at.x - 66, 34, s.at.y, 8, 2, 8, pal.bus);
    }
  }

  // one instanced mesh per shape
  const shapes: Record<Shape, () => BufferGeometry> = {
    box: () => new BoxGeometry(1, 1, 1),
    floor: () => new BoxGeometry(1, 1, 1),
    cyl: () => new CylinderGeometry(1, 1, 1, 18),
    ball: () => new SphereGeometry(1, 14, 10),
  };
  const dummy = new Object3D(), tint = new Color();
  for (const shape of Object.keys(shapes) as Shape[]) {
    const mine = pieces.filter((p) => p.shape === shape);
    if (!mine.length) continue;
    const material = shape === "floor" ? tiled() : new MeshLambertMaterial();
    const mesh = new InstancedMesh(shapes[shape](), material, mine.length);
    mine.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.set(p.colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push(mesh.geometry, material);
  }

  // price pads: a tinted dashed square and a fill that grows as coins go in
  const pads: PadMesh[] = [];
  const frameGeo = new PlaneGeometry(1, 1), fillGeo = new PlaneGeometry(1, 1).applyMatrix4(new Matrix4().makeTranslation(0.5, 0, 0));
  disposables.push(frameGeo, fillGeo);
  for (const pad of l.pads) {
    const pw = 52, ph = 40;
    const frame = new Mesh(frameGeo, new MeshBasicMaterial({ map: padFrame(), transparent: true, depthWrite: false, side: DoubleSide }));
    frame.rotation.x = -Math.PI / 2;
    frame.scale.set(pw, ph, 1);
    frame.position.set(pad.at.x, 1.8, pad.at.y);
    const fill = new Mesh(fillGeo, new MeshBasicMaterial({ color: pal.padFill, transparent: true, opacity: 0.55, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(pad.at.x - pw / 2 + 4, 1.9, pad.at.y);
    fill.scale.set(0.0001, ph - 8, 1);
    group.add(frame, fill);
    disposables.push(frame.material as Material, fill.material as Material);
    pads.push({ pad, frame, fill, w: pw - 8, h: ph - 8 });
  }

  return {
    group,
    pads,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
