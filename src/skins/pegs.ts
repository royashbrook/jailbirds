// peg people: a capsule body, a round blank head, arms with hands
// and legs in the colour of their pants. grey shirt and jeans until intake, with
// metal cuffs on the wrists; an orange jumpsuit after. the warden in blue with a
// cap and a badge, each kind of helper its own colour and hat. every pose is
// worked out here from the character's state and how far it has walked, so feet
// plant instead of sliding.
import { CapsuleGeometry, CylinderGeometry, Euler, SphereGeometry, Vector3 } from "three";
import type { Model, Palette, Part, Pose, Put, Skin } from "./types.ts";

const HIP = 6;
// slim, not round ("why am i so fat")
const BODY_R = 4.2;
// the same height as before slimming, so shoulders, hands and a carried tray stay where they were
const BODY_LEN = 8;
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
const JEANS = hex("#4d6a9a");
const METAL = hex("#c5ced8");
const BADGE = hex("#ffcf33");
const DRESS: Record<string, { body: number; hat: number; pants: number }> = {
  player: { body: hex("#3f6fd8"), hat: hex("#22325a"), pants: hex("#22325a") },
  escort: { body: hex("#6b778c"), hat: hex("#2f3a4d"), pants: hex("#2f3a4d") },
  carrier: { body: hex("#f4f1ea"), hat: hex("#ffffff"), pants: hex("#8a8f99") },
  clerk: { body: hex("#e0a040"), hat: hex("#2f8f6a"), pants: hex("#5a4a3a") },
  cleaner: { body: hex("#2fb39a"), hat: hex("#1f6f60"), pants: hex("#1f6f60") },
  collector: { body: hex("#4caf50"), hat: hex("#1e5e2a"), pants: hex("#5b4636") },
};
/** how long an arm is, shoulder to wrist, before scaling */
export const ARM = 7;
const reach = new Vector3(), turn = new Euler();

function pose(p: Pose, put: Put) {
  const s = p.kind === "player" ? 1.15 : p.kind === "agent" ? 1 : 1.08;
  const dress = DRESS[p.kind];
  const body = dress?.body ?? (p.uniform ? ORANGE : GREY);
  const skin = HEADS[p.look % HEADS.length];
  // upset looks as red in the face as cross; the view adds a little grey cloud over it
  const head = p.mood === "cross" || p.mood === "upset" ? CROSS : skin;
  const pants = dress?.pants ?? (p.uniform ? ORANGE : JEANS);
  const a = (p.walk / STRIDE) * TAU;
  const walking = p.action === "walk";
  const swing = walking ? Math.sin(a) : 0;
  // a squabble is a hop on the spot, cartoon style
  const bob = walking ? Math.abs(Math.cos(a)) * 1.3 : p.action === "fight" ? Math.abs(Math.sin(p.t * 9)) * 3 : 0;
  const breathe = p.action === "sleep" ? Math.sin(p.t * 1.3) * 0.03 : walking ? 0 : Math.sin(p.t * 2.2) * 0.02;
  const jitter = p.action === "fight" ? Math.sin(p.t * 38) * 1.2 : 0;
  const sitting = p.action === "sit" || p.action === "eat";
  // upright when walking (she asked why her head pushed forward); only a mop leans
  const lean = p.action === "clean" ? 0.25 : 0;
  const hip = (HIP + bob) * s;

  // legs from the hips: swinging opposite, out in front when sitting
  for (const side of [-1, 1]) {
    const pitch = sitting ? -1.45 : p.action === "sleep" ? 0 : -swing * 1.0 * side;
    put("limb", side * 2.5 * s + jitter, hip, 0, pitch, 0, 0, s, s, s, pants);
  }
  // the body, leaning into the walk, breathing when still
  const top = hip + BODY_H * s * (1 + breathe);
  put("body", jitter, hip + (BODY_H * s * (1 + breathe)) / 2, 0, lean, 0, 0, s, s * (1 + breathe), s, body);
  // the pants: a short band round the hips, unless it is all one jumpsuit
  if (pants !== body) put("hat", jitter, hip + 2.6 * s, Math.sin(lean) * 2.6 * s, lean, 0, 0, BODY_R * 1.04 * s, 5.2 * s, BODY_R * 1.04 * s, pants);
  // a badge on a guard's chest
  if (p.kind === "player" || p.kind === "escort")
    put("dot", jitter + 2 * s, top - 6 * s, BODY_R * s + Math.sin(lean) * BODY_H * s * 0.6, lean, 0, 0, 1.3 * s, 1.3 * s, 0.6 * s, BADGE);
  // the head, a little forward with the lean. no face: she likes them blank
  const hy = top + HEAD_R * s * 0.8, hz = Math.sin(lean) * BODY_H * s * 0.9;
  put("head", jitter, hy, hz, 0, 0, 0, s, s, s, head);

  // arms from the shoulders
  const shoulder = top - 4 * s, sz = Math.sin(lean) * BODY_H * s * 0.7;
  for (const side of [-1, 1]) {
    let pitch = swing * 0.95 * side, yaw = 0, roll = side * 0.18;
    if (p.carry > 0) pitch = -1.35;
    else if (p.action === "eat") pitch = side > 0 ? -1.6 - Math.abs(Math.sin(p.t * 5)) * 0.8 : -0.9;
    else if (p.action === "clean") (pitch = -0.8), (yaw = Math.sin(p.t * 8) * 0.6);
    // windmill punches, one arm then the other
    else if (p.action === "fight") pitch = -1.7 + Math.sin(p.t * 14 + (side > 0 ? Math.PI : 0)) * 1.1;
    else if (p.action === "wash") (pitch = -2.9), (roll = side * (0.5 + Math.sin(p.t * 9) * 0.3));
    else if (p.action === "sleep") pitch = 0;
    else if (!walking) pitch = Math.sin(p.t * 1.6 + side) * 0.05;
    const ax = side * (BODY_R + 1.2) * s + jitter, as = s * 0.85;
    put("limb", ax, shoulder, sz, pitch, yaw, roll, as, as, as, body);
    // a hand at the end of the arm; a cuff on the wrist until intake
    const hand = (along: number) => reach.set(0, -along * as, 0).applyEuler(turn.set(pitch, yaw, roll));
    hand(ARM + 0.4);
    put("dot", ax + reach.x, shoulder + reach.y, sz + reach.z, 0, 0, 0, 2.1 * s, 2.1 * s, 2.1 * s, skin);
    if (p.kind === "agent" && !p.uniform) {
      hand(ARM - 1.6);
      put("dot", ax + reach.x, shoulder + reach.y, sz + reach.z, pitch, yaw, roll, 2.3 * s, 1.1 * s, 2.3 * s, METAL);
    }
  }

  // hats
  const ht = hy + HEAD_R * s * 0.7;
  if (p.kind === "player" || p.kind === "escort") {
    put("hat", jitter, ht, hz, 0, 0, 0, 4.9 * s, 2.6 * s, 4.9 * s, dress.hat);
    put("hat", jitter, ht - 1.1 * s, hz + 2.6 * s, 0, 0, 0, 3.2 * s, 0.6 * s, 2.4 * s, dress.hat);
  } else if (p.kind === "carrier") {
    put("hat", jitter, ht + 2.2 * s, hz, 0, 0, 0, 4.1 * s, 5 * s, 4.1 * s, dress.hat);
    put("hat", jitter, ht + 5 * s, hz, 0, 0, 0, 5 * s, 2.4 * s, 5 * s, dress.hat);
  } else if (p.kind === "clerk") {
    put("hat", jitter, ht - 1.2 * s, hz, 0, 0, 0, 4.85 * s, 1.4 * s, 4.85 * s, dress.hat);
    put("hat", jitter, ht - 1.6 * s, hz + 2.8 * s, 0, 0, 0, 3.2 * s, 0.5 * s, 2.4 * s, dress.hat);
  } else if (p.kind === "collector") {
    // a green cap with its peak turned round to the back
    put("hat", jitter, ht - 0.9 * s, hz, 0, 0, 0, 4.85 * s, 1.8 * s, 4.85 * s, dress.hat);
    put("hat", jitter, ht - 1.4 * s, hz - 2.8 * s, 0, 0, 0, 3.2 * s, 0.5 * s, 2.4 * s, dress.hat);
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
    // a unit ball, for hands, cuffs and badges
    dot: () => new SphereGeometry(1, 10, 8),
  } satisfies Record<Part, unknown>,
  perCharacter: { body: 1, head: 1, limb: 4, hat: 3, dot: 7 },
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
  // jail bunks: a plain grey mattress and a dull pillow, nothing dream house
  bed: "#8f97a3",
  pillow: "#d6dade",
  road: "#a9adb7",
  roadLine: "#ffffff",
  spot: "#c3dbf2",
  pad: "#2fa35f",
  padLocked: "#9b95a3",
  padFill: "#5fd08a",
  label: "#7d6f5e",
  // money is green bills, the name stays coin with the rest of the code
  coin: "#6cc070",
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
  shouts: ["hey!", "watch this!", "pow!", "take that!", "bonk!", "oof!"],
  palette: (d) => (d ? dark : light),
  model,
};
