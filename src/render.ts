// puts the world on the canvas through a skin: the camera, draw order, and
// positions blended between the last two fixed steps so a 120hz ipad moves as
// smoothly as the sim allows. it never changes the world.
import { walls, doorMid } from "./engine/geom.ts";
import { isOpen, mood, padVisible, stars, wants } from "./engine/sim.ts";
import type { LevelDef, StationDef, World } from "./engine/types.ts";
import type { Palette, Pose, Skin } from "./skins/types.ts";

export type Thumb = { ox: number; oy: number; x: number; y: number; r: number } | null;
/** where everyone stood one step ago, by id */
export type Past = Map<number, { x: number; y: number; walk: number }>;
export const remember = (w: World): Past => new Map(w.agents.map((a) => [a.id, { x: a.x, y: a.y, walk: a.walk }]));

/** about this much world fits across the short side of a phone; an ipad zooms in less
 * and sees more of the jail, so a bigger screen is a bigger view, not just bigger birds */
const SHORT_SIDE = 400;
export function camera(w: World, l: LevelDef, cssW: number, cssH: number, centre: { x: number; y: number }) {
  const zoom = Math.min(1.6, Math.max(0.8, Math.min(cssW, cssH) / SHORT_SIDE));
  const vw = cssW / zoom, vh = cssH / zoom;
  const bottom = l.size.h;
  const fit = (c: number, view: number, size: number) => (view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, c)));
  return { zoom, x: fit(centre.x, vw, l.size.w) - vw / 2, y: fit(centre.y, vh, bottom) - vh / 2 };
}

export function render(
  ctx: CanvasRenderingContext2D, w: World, l: LevelDef, skin: Skin, pal: Palette, dpr: number,
  cssW: number, cssH: number, past: Past | null, alpha: number, now: number, thumb: Thumb,
) {
  const t = now / 1000;
  const at = (id: number, x: number, y: number, walk: number) => {
    const p = past?.get(id);
    return p ? { x: p.x + (x - p.x) * alpha, y: p.y + (y - p.y) * alpha, walk: p.walk + (walk - p.walk) * alpha } : { x, y, walk };
  };
  const me = w.agents[0];
  const cam = camera(w, l, cssW, cssH, at(me.id, me.x, me.y, me.walk));
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom);

  const spawn = l.stations.find((s) => s.kind === "spawn") as Extract<StationDef, { kind: "spawn" }> | undefined;
  skin.hall(ctx, l.size, spawn?.roadY ?? l.size.h, pal);
  const open = (id?: string) => isOpen(w, id);
  // rooms biggest first, so a cell sits on top of its block
  const rooms = [...l.rooms].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  for (const r of rooms) skin.room(ctx, r, open(r.locked), pal);

  // stand-here spots, under everything else
  for (const s of l.stations) {
    if (s.kind === "tag" || s.kind === "source") skin.spot(ctx, s.at, pal);
    if (s.kind === "house" && open(s.locked)) skin.spot(ctx, s.at, pal);
  }
  // seats and props
  for (const s of l.stations) {
    if (s.kind === "sink" || s.kind === "facility")
      s.seats.forEach((seat, i) => skin.seat(ctx, seat.look ?? s.look, seat.at, open(seat.locked) && (s.kind !== "sink" || open(s.locked)), pal));
    if (s.kind === "tag" || s.kind === "source") skin.prop(ctx, s.look, s.prop, pal, 0);
    if (s.kind === "sink") {
      if (open(s.locked)) skin.prop(ctx, s.look, s.prop, pal, w.stock[s.id] ?? 0);
      else {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = pal.inkDim;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.prop.x, s.prop.y, s.prop.w, s.prop.h);
        ctx.setLineDash([]);
      }
    }
  }
  skin.walls(ctx, walls(l, (r) => open(r.locked), true), pal);
  for (const r of l.rooms)
    for (const d of r.doors)
      if (d.actors === false) {
        const { mid } = doorMid(r, d);
        skin.cellDoor(ctx, { x: mid.x - d.width / 2, y: mid.y }, { x: mid.x + d.width / 2, y: mid.y }, pal);
      }
  for (const r of l.rooms) if (open(r.locked)) skin.roomLabel(ctx, r, pal);
  if (spawn) skin.stop(ctx, spawn.at, pal);

  const rating = stars(w, l);
  for (const p of l.pads) if (padVisible(w, p)) skin.pad(ctx, p, w.paid[p.id] ?? 0, rating >= (p.stars ?? 0), pal);
  for (const m of w.messes) skin.mess(ctx, m.kind, m.x, m.y, 1 - m.clean / 0.4, t);
  w.floor.forEach((c, k) => skin.coin(ctx, c.x, c.y - 2 - Math.abs(Math.sin(t * 3 + k)) * 2));
  if (spawn && w.ride.state !== "away") skin.bus(ctx, w.ride.x, spawn.roadY + 2, w.ride.state === "in", pal);

  // everyone, back to front
  const poses: Pose[] = w.agents.map((a) => {
    const p = at(a.id, a.x, a.y, a.walk);
    const using = a.state === "use" ? (l.stations.find((s) => s.id === a.station) as { need?: string } | undefined)?.need ?? null : null;
    return {
      kind: a.kind, x: p.x, y: p.y, face: a.face, moving: a.moving, walk: p.walk, t: t + a.id * 0.37, look: a.look,
      uniform: a.tags.includes("uniform"), carry: a.carry, mood: a.kind === "agent" && a.state !== "wait" && a.state !== "follow" ? mood(l, a) : "ok", using,
    };
  });
  const order = poses.map((p, i) => [p, w.agents[i]] as const).sort((a, b) => a[0].y - b[0].y);
  for (const [p, a] of order) {
    skin.character(ctx, p, pal);
    if (a.kind === "agent" && a.state === "home") {
      const need = wants(l, a);
      if (need) skin.bubble(ctx, need, p.x, p.y - 30, pal);
    }
  }

  // the thumb stick, in screen pixels, where the finger went down
  if (thumb) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(thumb.ox, thumb.oy, thumb.r, 0, Math.PI * 2);
    ctx.fillStyle = pal.stick;
    ctx.fill();
    ctx.strokeStyle = pal.inkDim;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(thumb.x, thumb.y, thumb.r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = pal.inkDim;
    ctx.fill();
  }
}
