// cartoon birds: round bodies, a tuft, a beak, little orange legs. the warden
// wears a cap with a badge; hired help wear their own hats. our own design.
import type { Pose, Skin } from "./types.ts";
import { BIRDS } from "./palettes.ts";
import { OUTLINE, circle, line, rounded, scenery, stripes, tray } from "./scenery.ts";

const BEAK = "#ff9f40";
/** body colour and hat for the actors; agents take the palette's looks */
const ACTORS = {
  player: { body: "#5b7fcf", hat: "#2f3f6b" },
  carrier: { body: "#f4f1ea", hat: "#ffffff" },
  cleaner: { body: "#6cc5b0", hat: "#2f7f6f" },
  escort: { body: "#8a94a6", hat: "#3b4a5e" },
} as const;
const STRIDE = 26;

function character(ctx: CanvasRenderingContext2D, p: Pose, pal: { looks: string[] }) {
  const actor = p.kind === "agent" ? null : ACTORS[p.kind];
  const r = p.kind === "player" ? 13 : actor ? 12 : 10;
  const colour = actor?.body ?? pal.looks[p.look % pal.looks.length];
  const f = p.face;
  // the cycle turns with distance, so feet plant instead of sliding
  const a = (p.walk / STRIDE) * Math.PI * 2;
  const swing = p.moving ? Math.sin(a) : 0;
  const bob = p.moving ? Math.abs(Math.sin(a)) * r * 0.2 : p.using ? Math.abs(Math.sin(p.t * 7)) * r * 0.12 : 0;
  const breathe = p.moving ? 1 : 1 + Math.sin(p.t * 2.4 + p.look) * 0.03;
  const lean = p.moving ? f * 0.1 : 0;
  const x = p.x, y = p.y - bob;

  // shadow stays on the ground
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + r * 0.98, r * 0.85 - bob * 0.3, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  ctx.fill();

  // legs: hip to foot, swinging front to back, the lifted one up a touch
  ctx.strokeStyle = BEAK;
  ctx.lineCap = "round";
  ctx.lineWidth = r * 0.15;
  for (const side of [-1, 1]) {
    const s = swing * side;
    const hipX = x + side * r * 0.28, hipY = y + r * 0.6;
    const footX = hipX + s * r * 0.4 * f, footY = p.y + r * 0.95 - Math.max(0, s) * r * 0.22;
    line(ctx, hipX, hipY, footX, footY);
    line(ctx, footX, footY, footX + f * r * 0.22, footY);
  }
  ctx.lineCap = "butt";

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.scale(1 / breathe, breathe);

  // tail feathers behind
  ctx.beginPath();
  ctx.moveTo(-f * r * 0.8, r * 0.1);
  ctx.lineTo(-f * r * 1.35, -r * 0.15 + swing * r * 0.08);
  ctx.lineTo(-f * r * 1.25, r * 0.35);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = r * 0.1;
  ctx.stroke();
  // tuft
  if (!actor) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.85);
    ctx.quadraticCurveTo(-r * 0.1, -r * 1.45, r * 0.25, -r * 1.25);
    ctx.quadraticCurveTo(r * 0.1, -r * 1.05, r * 0.2, -r * 0.85);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.stroke();
  }
  // body, striped once through intake
  circle(ctx, 0, 0, r, colour);
  if (p.uniform) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    stripes(ctx, -r, r * 0.05, r * 2, r, r * 0.15);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = r * 0.13;
  ctx.stroke();

  // the eye, blinking now and then, and the beak
  const blink = (p.t + p.look * 0.7) % 3.4 < 0.12;
  circle(ctx, f * r * 0.36, -r * 0.3, r * 0.26, "#ffffff");
  if (blink) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = r * 0.08;
    line(ctx, f * r * 0.2, -r * 0.3, f * r * 0.52, -r * 0.3);
  } else circle(ctx, f * r * 0.44, -r * 0.3, r * 0.13, OUTLINE);
  if (p.mood === "cross") {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = r * 0.1;
    line(ctx, f * r * 0.12, -r * 0.68, f * r * 0.58, -r * 0.5);
  }
  ctx.beginPath();
  ctx.moveTo(f * r * 0.75, -r * 0.2);
  ctx.lineTo(f * r * 1.35, -r * 0.02 + (p.using === "food" ? Math.sin(p.t * 14) * r * 0.08 : 0));
  ctx.lineTo(f * r * 0.75, r * 0.18);
  ctx.closePath();
  ctx.fillStyle = BEAK;
  ctx.fill();
  ctx.lineWidth = r * 0.07;
  ctx.stroke();

  // the wing: flaps with the stride, or both up front holding the stack
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  if (p.carry > 0) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * r * 0.55, -r * 0.55, r * 0.22, r * 0.5, side * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = r * 0.08;
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(-f * r * 0.3, r * 0.12, r * 0.42, r * 0.26, f * (0.4 + swing * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }

  // hats
  if (actor) {
    if (p.kind === "carrier") {
      circle(ctx, -r * 0.3, -r * 1.05, r * 0.32, actor.hat, OUTLINE, r * 0.07);
      circle(ctx, r * 0.3, -r * 1.05, r * 0.32, actor.hat, OUTLINE, r * 0.07);
      circle(ctx, 0, -r * 1.2, r * 0.38, actor.hat, OUTLINE, r * 0.07);
      rounded(ctx, -r * 0.55, -r * 0.95, r * 1.1, r * 0.3, 2, actor.hat, OUTLINE, r * 0.07);
    } else if (p.kind === "cleaner") {
      rounded(ctx, -r * 0.8, -r * 0.92, r * 1.6, r * 0.28, 3, actor.hat);
    } else {
      ctx.beginPath();
      ctx.roundRect(-r * 0.75, -r * 1.15, r * 1.5, r * 0.55, [r * 0.4, r * 0.4, 0, 0]);
      ctx.fillStyle = actor.hat;
      ctx.fill();
      ctx.fillRect(-r * 0.2 + f * r * 0.3, -r * 0.68, r, r * 0.18);
      if (p.kind === "player") circle(ctx, 0, -r * 0.88, r * 0.15, "#ffd23f");
    }
  }
  ctx.restore();

  // the stack, held up front
  for (let k = 0; k < p.carry; k++) tray(ctx, x + f * r * 0.1, y - r * 1.25 - k * 5);
}

export const birds: Skin = {
  ...scenery,
  id: "birds",
  name: "birds",
  noun: "birds",
  palette: (dark) => (dark ? BIRDS.dark : BIRDS.light),
  character,
};
