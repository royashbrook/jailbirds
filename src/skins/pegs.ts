// peg people: a capsule body, a round head with no face, little stubby arms and
// legs. grey until intake, orange after; the warden in blue with a cap, each kind
// of helper its own colour and hat. every pose is worked out here from the
// character's state and how far it has walked, so feet plant instead of sliding.
import { CapsuleGeometry, CylinderGeometry, SphereGeometry } from "three";
import type { Model, Palette, Part, Pose, Put, Skin } from "./types.ts";

const HIP = 6;
const BODY_R = 5.2;
const BODY_LEN = 6;
const BODY_H = BODY_LEN + BODY_R * 2;
const HEAD_R = 4.6;
const STRIDE = 22;
const TAU = Math.PI * 2;

const hex = (s: string) => parseInt(s.slice(1), 16);
// how the whole body sits, shared rather than made fresh every frame
const STANDING = { lift: 0, pitch: 0 } as const;
const SITTING = { lift: 1, pitch: 0 } as const;
const LYING = { lift: 9, pitch: -Math.PI / 2 } as const;
/** heads come in a few warm tones */
const HEADS = ["#f1d3a8", "#e6bb8e", "#d49f74", "#f6dcc0", "#c58b5f", "#a8714a"].map(hex);
const GREY = hex("#b9bec7");
const ORANGE = hex("#ff8a3d");
const BEANIE = hex("#e8672a");
const CROSS = hex("#e9877a");
const DRESS: Record<string, { body: number; hat: number }> = {
  player: { body: hex("#3f6fd8"), hat: hex("#22325a") },
  escort: { body: hex("#6b778c"), hat: hex("#2f3a4d") },
  carrier: { body: hex("#f4f1ea"), hat: hex("#ffffff") },
  clerk: { body: hex("#e0a040"), hat: hex("#2f8f6a") },
  cleaner: { body: hex("#2fb39a"), hat: hex("#1f6f60") },
};

function pose(p: Pose, put: Put) {
  const s = p.kind === "player" ? 1.15 : p.kind === "agent" ? 1 : 1.08;
  const dress = DRESS[p.kind];
  const body = dress?.body ?? (p.uniform ? ORANGE : GREY);
  const head = p.mood === "cross" ? CROSS : HEADS[p.look % HEADS.length];
  const a = (p.walk / STRIDE) * TAU;
  const walking = p.action === "walk";
  const swing = walking ? Math.sin(a) : 0;
  const bob = walking ? Math.abs(Math.cos(a)) * 1.3 : 0;
  const breathe = p.action === "sleep" ? Math.sin(p.t * 1.3) * 0.03 : walking ? 0 : Math.sin(p.t * 2.2) * 0.02;
  const jitter = p.action === "fight" ? Math.sin(p.t * 38) * 1.2 : 0;
  const sitting = p.action === "sit" || p.action === "eat";
  const lean = walking ? 0.12 : p.action === "clean" ? 0.25 : 0;
  const hip = (HIP + bob) * s;

  // legs from the hips: swinging opposite, out in front when sitting
  for (const side of [-1, 1]) {
    const pitch = sitting ? -1.45 : p.action === "sleep" ? 0 : -swing * 0.9 * side;
    put("limb", side * 2.5 * s + jitter, hip, 0, pitch, 0, 0, s, s, s, dress ? 0x4a4f5c : 0x5d6475);
  }
  // the body, leaning into the walk, breathing when still
  const top = hip + BODY_H * s * (1 + breathe);
  put("body", jitter, hip + (BODY_H * s * (1 + breathe)) / 2, 0, lean, 0, 0, s, s * (1 + breathe), s, body);
  // the head, a little forward with the lean
  const hy = top + HEAD_R * s * 0.8, hz = Math.sin(lean) * BODY_H * s * 0.9;
  put("head", jitter, hy, hz, 0, 0, 0, s, s, s, head);

  // arms from the shoulders
  const shoulder = top - 4 * s, sz = Math.sin(lean) * BODY_H * s * 0.7;
  for (const side of [-1, 1]) {
    let pitch = swing * 0.75 * side, yaw = 0, roll = side * 0.18;
    if (p.carry > 0) pitch = -1.35;
    else if (p.action === "eat") pitch = side > 0 ? -1.6 - Math.abs(Math.sin(p.t * 5)) * 0.8 : -0.9;
    else if (p.action === "clean") (pitch = -0.8), (yaw = Math.sin(p.t * 8) * 0.6);
    else if (p.action === "fight") pitch = -2.5 + Math.sin(p.t * 20 + side) * 0.5;
    else if (p.action === "wash") (pitch = -2.9), (roll = side * (0.5 + Math.sin(p.t * 9) * 0.3));
    else if (p.action === "sleep") pitch = 0;
    else if (!walking) pitch = Math.sin(p.t * 1.6 + side) * 0.05;
    put("limb", side * (BODY_R + 1.2) * s + jitter, shoulder, sz, pitch, yaw, roll, s * 0.85, s * 0.85, s * 0.85, body);
  }

  // hats
  const ht = hy + HEAD_R * s * 0.7;
  if (p.kind === "player" || p.kind === "escort") {
    put("hat", jitter, ht, hz, 0, 0, 0, 4.9 * s, 2.6 * s, 4.9 * s, dress.hat);
    put("hat", jitter, ht - 1.1 * s, hz + 3.6 * s, 0, 0, 0, 3.2 * s, 0.6 * s, 2.6 * s, dress.hat);
  } else if (p.kind === "carrier") {
    put("hat", jitter, ht + 2.2 * s, hz, 0, 0, 0, 4.1 * s, 5 * s, 4.1 * s, dress.hat);
    put("hat", jitter, ht + 5 * s, hz, 0, 0, 0, 5 * s, 2.4 * s, 5 * s, dress.hat);
  } else if (p.kind === "clerk") {
    put("hat", jitter, ht - 1.2 * s, hz, 0, 0, 0, 4.85 * s, 1.4 * s, 4.85 * s, dress.hat);
    put("hat", jitter, ht - 1.6 * s, hz + 3.8 * s, 0, 0, 0, 3.2 * s, 0.5 * s, 2.8 * s, dress.hat);
  } else if (p.kind === "cleaner") {
    put("hat", jitter, ht - 1.4 * s, hz, 0, 0, 0, 4.8 * s, 1.6 * s, 4.8 * s, dress.hat);
  } else if (p.uniform) {
    put("hat", jitter, ht - 0.6 * s, hz, 0, 0, 0, 4.7 * s, 2.2 * s, 4.7 * s, BEANIE);
  }
}

export const model: Model = {
  parts: {
    body: () => new CapsuleGeometry(BODY_R, BODY_LEN, 6, 14),
    head: () => new SphereGeometry(HEAD_R, 16, 12),
    // a limb hangs from its top, so turning it swings it from the hip or shoulder
    limb: () => new CapsuleGeometry(2, 3, 4, 8).translate(0, -3.5, 0),
    // a unit cylinder, sized by each hat
    hat: () => new CylinderGeometry(1, 1, 1, 16),
  } satisfies Record<Part, unknown>,
  perCharacter: { body: 1, head: 1, limb: 4, hat: 2 },
  pose,
  root: (p) => (p.action === "sleep" ? LYING : p.action === "sit" || p.action === "eat" ? SITTING : STANDING),
  carryAt: { forward: 9, up: 21, step: 2.6 },
  height: HIP + BODY_H + HEAD_R * 2 + 4,
};

const light: Palette = {
  background: "#e6efe4",
  hall: "#efe6d6",
  floors: {
    block: "#e4e0ee", cell: "#f0e3f5", canteen: "#ffe3c2", kitchen: "#dcedf4",
    washroom: "#d2eef6", intake: "#f2e8cd", release: "#dcf1d6",
  },
  locked: "#b9b4ab",
  wall: "#9aa6cf",
  wood: "#d9a066",
  metal: "#c5ced8",
  porcelain: "#ffffff",
  bed: "#8fb8ef",
  pillow: "#ffffff",
  road: "#a9adb7",
  roadLine: "#ffffff",
  spot: "#c3dbf2",
  pad: "#2fa35f",
  padLocked: "#9b95a3",
  padFill: "#5fd08a",
  label: "#7d6f5e",
  coin: "#ffcf33",
  tray: "#e8eef4",
  food: ["#ff9f40", "#7ccf7c", "#ff6b6b"],
  poop: "#8a5a3b",
  puddle: "#6cc3f0",
  bus: "#f2b84b",
  glass: "#cfeeff",
  dark: "#3a2e2b",
};
const dark: Palette = {
  ...light,
  background: "#1b1d24",
  hall: "#3a3742",
  floors: {
    block: "#3d3a4a", cell: "#463f55", canteen: "#4d4136", kitchen: "#36434c",
    washroom: "#324750", intake: "#47402f", release: "#33443a",
  },
  locked: "#25232b",
  wall: "#7d88b0",
  road: "#4a4d56",
  roadLine: "#9a9da6",
  label: "#c9bca9",
  padLocked: "#7c7686",
};

export const pegs: Skin = {
  id: "pegs",
  name: "peg people",
  noun: "inmates",
  squabble: "hey!",
  palette: (d) => (d ? dark : light),
  model,
};
