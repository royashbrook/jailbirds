// peg people: a capsule body and a round head, no face, like wooden toy pegs.
// arms and legs swing opposite as they walk; arms go up to hold a stack.
import type { Pose, Skin } from "./types.ts";
import { PEGS } from "./palettes.ts";
import { OUTLINE, circle, rounded, scenery, stripes, tray } from "./scenery.ts";

const HEAD = "#f1d3a8";
const ACTORS = {
  player: { body: "#3f5fa8", hat: "#22325a" },
  carrier: { body: "#f4f1ea", hat: "#ffffff" },
  cleaner: { body: "#3fa68f", hat: "#25695b" },
  escort: { body: "#6b778c", hat: "#323d50" },
} as const;
const STRIDE = 24;

function limb(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, w: number, angle: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  rounded(ctx, -w / 2, -w / 2, w, len + w / 2, w / 2, fill, OUTLINE, 1.3);
  ctx.restore();
}

function character(ctx: CanvasRenderingContext2D, p: Pose, pal: { looks: string[] }) {
  const actor = p.kind === "agent" ? null : ACTORS[p.kind];
  const s = p.kind === "player" ? 1.25 : actor ? 1.12 : 1;
  const colour = actor?.body ?? pal.looks[p.look % pal.looks.length];
  const f = p.face;
  const a = (p.walk / STRIDE) * Math.PI * 2;
  const swing = p.moving ? Math.sin(a) : 0;
  const bob = p.moving ? Math.abs(Math.cos(a)) * 1.6 * s : p.using ? Math.abs(Math.sin(p.t * 6)) * 1.2 : 0;
  const breathe = p.moving ? 0 : Math.sin(p.t * 2.2 + p.look) * 0.5;
  const bw = 15 * s, bh = 17 * s, hr = 6.5 * s;
  const x = p.x, foot = p.y + 10 * s;
  const hip = foot - 7 * s - bob;
  const top = hip - bh + 4 * s - breathe;

  ctx.beginPath();
  ctx.ellipse(p.x, foot, bw * 0.55, 3.5 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  ctx.fill();

  // legs from the hip, swinging opposite each other
  for (const side of [-1, 1]) limb(ctx, x + side * 3.5 * s, hip, 6 * s, 4.5 * s, -swing * side * 0.55 * f, actor ? "#4a4f5c" : "#5d6475");

  // the back arm, behind the body
  const shoulder = top + 5 * s;
  const holding = p.carry > 0;
  const armAngle = (side: number) => (holding ? Math.PI * 0.95 * -f * 0.9 : swing * side * 0.6 * f + f * 0.08);
  limb(ctx, x - f * bw * 0.42, shoulder, 8 * s, 4.2 * s, armAngle(1), colour);

  // body: a capsule, striped once through intake
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, top, bw, bh, bw / 2.2);
  ctx.clip();
  if (p.uniform) stripes(ctx, x - bw / 2, top, bw, bh, 2.3 * s);
  else {
    ctx.fillStyle = colour;
    ctx.fillRect(x - bw / 2, top, bw, bh);
  }
  ctx.restore();
  rounded(ctx, x - bw / 2, top, bw, bh, bw / 2.2, "transparent", OUTLINE, 1.6);

  // head: round, no face. it turns a touch toward where it is going
  const hx = x + f * 0.8 * s, hy = top - hr + 1.5 * s;
  circle(ctx, hx, hy, hr, HEAD, OUTLINE, 1.6);
  if (p.mood === "cross") circle(ctx, hx, hy, hr * 0.45, "rgba(230, 90, 90, 0.45)");

  // the front arm
  limb(ctx, x + f * bw * 0.42, shoulder, 8 * s, 4.2 * s, armAngle(-1), colour);

  // hats
  if (actor) {
    if (p.kind === "carrier") {
      circle(ctx, hx - hr * 0.4, hy - hr * 0.95, hr * 0.48, actor.hat, OUTLINE, 1.2);
      circle(ctx, hx + hr * 0.4, hy - hr * 0.95, hr * 0.48, actor.hat, OUTLINE, 1.2);
      circle(ctx, hx, hy - hr * 1.15, hr * 0.55, actor.hat, OUTLINE, 1.2);
      rounded(ctx, hx - hr * 0.8, hy - hr * 0.85, hr * 1.6, hr * 0.42, 2, actor.hat, OUTLINE, 1.2);
    } else if (p.kind === "cleaner") {
      rounded(ctx, hx - hr, hy - hr * 0.55, hr * 2, hr * 0.42, 2, actor.hat);
    } else {
      ctx.beginPath();
      ctx.roundRect(hx - hr * 0.95, hy - hr * 1.15, hr * 1.9, hr * 0.8, [hr * 0.6, hr * 0.6, 0, 0]);
      ctx.fillStyle = actor.hat;
      ctx.fill();
      ctx.fillRect(hx - hr * 0.3 + f * hr * 0.4, hy - hr * 0.45, hr * 1.3, hr * 0.25);
      if (p.kind === "player") circle(ctx, hx, hy - hr * 0.78, hr * 0.2, "#ffd23f");
    }
  }

  for (let k = 0; k < p.carry; k++) tray(ctx, x + f * 2, top - hr * 2 - 4 - k * 5);
}

export const pegs: Skin = {
  ...scenery,
  id: "pegs",
  name: "peg people",
  noun: "inmates",
  palette: (dark) => (dark ? PEGS.dark : PEGS.light),
  character,
};
