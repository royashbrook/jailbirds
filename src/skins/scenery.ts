// the rooms, props and bits both skins share, drawn from whichever palette the
// skin hands in. a skin can take these as they are or bring its own.
import type { Palette, Skin } from "./types.ts";

export const OUTLINE = "#3a2e2b";
export const COIN = "#ffd23f";
const COIN_EDGE = "#c9960f";
const STRIPE = "#3a2e2b";
const BUS = "#f2b84b";

type Ctx = CanvasRenderingContext2D;
export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke?: string, width = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
export function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, width = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
export function text(ctx: Ctx, s: string, x: number, y: number, colour: string, size = 11, weight = 700, align: CanvasTextAlign = "center") {
  ctx.font = `${weight} ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = colour;
  ctx.fillText(s, x, y);
}
/** stripes across whatever shape is clipped */
export function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, band: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = STRIPE;
  for (let k = y + band * 0.6; k < y + h; k += band * 2) ctx.fillRect(x, k, w, band);
}
export function star(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

export function tray(ctx: Ctx, x: number, y: number) {
  rounded(ctx, x - 9, y - 3, 18, 6, 2, "#e8eef4", OUTLINE, 1.5);
  circle(ctx, x - 3.5, y - 3.5, 2.8, "#ff9f40");
  circle(ctx, x + 3.5, y - 3.5, 2.8, "#7ccf7c");
}

export const scenery: Omit<Skin, "id" | "name" | "noun" | "palette" | "character"> = {
  hall(ctx, size, roadY, pal) {
    ctx.fillStyle = pal.hall;
    ctx.fillRect(-2000, -2000, size.w + 4000, size.h + 4000);
    ctx.strokeStyle = pal.hallLine;
    ctx.lineWidth = 1;
    for (let y = 0; y < roadY - 20; y += 40) line(ctx, 0, y, size.w, y);
    for (let x = 0; x <= size.w; x += 40) line(ctx, x, 0, x, roadY - 20);
    ctx.fillStyle = pal.road;
    ctx.fillRect(-2000, roadY - 20, size.w + 4000, 2000);
    ctx.strokeStyle = pal.roadLine;
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 14]);
    line(ctx, -2000, roadY + 22, size.w + 2000, roadY + 22);
    ctx.setLineDash([]);
  },
  room(ctx, room, open, pal) {
    const r = room.rect;
    ctx.fillStyle = open ? (pal.floors[room.look] ?? pal.hall) : pal.locked;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (room.look === "cell" && open) {
      // a bunk and a pillow
      rounded(ctx, r.x + 8, r.y + 10, 22, 34, 5, pal.floors.bed ?? "#9fc3e8", OUTLINE, 1.5);
      rounded(ctx, r.x + 11, r.y + 13, 16, 8, 3, "#ffffff");
    }
    if (!open) {
      const cx = r.x + r.w / 2, cy = r.y + Math.min(r.h / 2, 60);
      ctx.strokeStyle = pal.inkDim;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 7, Math.PI, 0);
      ctx.stroke();
      rounded(ctx, cx - 10, cy - 4, 20, 16, 4, pal.inkDim);
    }
  },
  walls(ctx, walls, pal) {
    ctx.fillStyle = pal.wall;
    for (const w of walls) ctx.fillRect(w.x, w.y, w.w, w.h);
  },
  cellDoor(ctx, from, to, pal) {
    ctx.strokeStyle = pal.bars;
    ctx.lineWidth = 2.5;
    for (let x = from.x + 4; x < to.x; x += 7) line(ctx, x, from.y - 10, x, from.y + 3);
    line(ctx, from.x, from.y + 2, to.x, to.y + 2);
  },
  roomLabel(ctx, room, pal) {
    if (room.label) text(ctx, room.label, room.rect.x + room.rect.w / 2, room.rect.y + room.rect.h - 10, pal.label, 11);
  },
  prop(ctx, look, r, pal, stock) {
    if (look === "desk") {
      rounded(ctx, r.x, r.y, r.w, r.h, 6, pal.wood, OUTLINE);
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x + 20 + k * 7, r.y + 7 - k * 3, 12, 12);
        ctx.clip();
        stripes(ctx, r.x + 20 + k * 7, r.y + 7 - k * 3, 12, 12, 1.6);
        ctx.restore();
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 20 + k * 7, r.y + 7 - k * 3, 12, 12);
      }
      text(ctx, "shirts", r.x + r.w - 40, r.y + r.h / 2, OUTLINE, 11, 800);
    } else if (look === "stove") {
      rounded(ctx, r.x, r.y, r.w, r.h, 6, pal.metal, OUTLINE);
      circle(ctx, r.x + 20, r.y + r.h / 2, 10, "#4b525b", OUTLINE, 1.5);
      circle(ctx, r.x + 46, r.y + r.h / 2, 10, "#4b525b", OUTLINE, 1.5);
      for (let k = 0; k < 4; k++) tray(ctx, r.x + r.w - 22, r.y + r.h - 8 - k * 5);
    } else if (look === "table") {
      rounded(ctx, r.x, r.y, r.w, r.h, 8, pal.wood, OUTLINE);
      for (let k = 0; k < stock; k++) tray(ctx, r.x + 25 + (k % 3) * 50, r.y + (k < 3 ? 10 : 24));
    }
  },
  seat(ctx, look, at, open, pal) {
    if (!open) {
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = pal.inkDim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (look === "stool") circle(ctx, at.x, at.y + 4, 7, pal.wood, OUTLINE, 1.5);
    else if (look === "toilet") {
      rounded(ctx, at.x + 4, at.y - 12, 12, 24, 4, pal.porcelain, OUTLINE, 1.5);
      ctx.beginPath();
      ctx.ellipse(at.x - 4, at.y, 12, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = pal.porcelain;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(at.x - 4, at.y, 6, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#bfe3f5";
      ctx.fill();
    } else if (look === "shower") {
      rounded(ctx, at.x - 18, at.y - 16, 36, 30, 4, "#cfe9f7", OUTLINE, 1.5);
      ctx.strokeStyle = pal.metal;
      ctx.lineWidth = 3;
      line(ctx, at.x, at.y + 14, at.x, at.y + 22);
      circle(ctx, at.x, at.y + 6, 4, pal.metal, OUTLINE, 1);
    }
  },
  spot(ctx, at, pal) {
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, 24, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.spot;
    ctx.fill();
  },
  item(ctx, kind, x, y) {
    if (kind === "tray") tray(ctx, x, y);
  },
  mess(ctx, kind, x, y, left, t) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.75 * left;
    if (kind === "poop") {
      const b = Math.sin(t * 3) * 0.6;
      circle(ctx, x, y + 3, 7, "#8a5a3b", OUTLINE, 1.5);
      circle(ctx, x, y - 3 + b, 5, "#9b6744", OUTLINE, 1.5);
      circle(ctx, x, y - 8 + b, 3, "#a87250", OUTLINE, 1.5);
      // stink lines
      ctx.strokeStyle = "rgba(120,160,80,0.7)";
      ctx.lineWidth = 1.5;
      for (const dx of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y - 6);
        ctx.quadraticCurveTo(x + dx + 3, y - 11 - b, x + dx, y - 16);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(x, y, 15, 8, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = "#7cc6ee";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 9, y + 4, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x - 5, y - 2, 4, 2, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
    }
    ctx.restore();
  },
  coin(ctx, x, y) {
    circle(ctx, x, y, 5.5, COIN, COIN_EDGE, 1.5);
    circle(ctx, x - 1.7, y - 1.7, 1.5, "rgba(255,255,255,0.75)");
  },
  pad(ctx, pad, paid, ready, pal) {
    ctx.font = `700 8.5px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    const w = Math.max(54, ctx.measureText(pad.label ?? "").width + 12), h = 34, x = pad.at.x, y = pad.at.y;
    rounded(ctx, x - w / 2, y - h / 2, w, h, 8, pal.padFill);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 8);
    ctx.clip();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = pal.pad;
    ctx.fillRect(x - w / 2, y - h / 2, (w * paid) / pad.cost, h);
    ctx.restore();
    ctx.setLineDash([5, 4]);
    rounded(ctx, x - w / 2, y - h / 2, w, h, 8, "transparent", ready ? pal.pad : pal.inkDim, 2);
    ctx.setLineDash([]);
    if (ready) {
      circle(ctx, x - 14, y - 4, 5, COIN, COIN_EDGE, 1.2);
      text(ctx, String(pad.cost - paid), x - 6, y - 3, pal.ink, 12, 800, "left");
    } else {
      star(ctx, x - 14, y - 4, 6, "#ffd23f");
      text(ctx, String(pad.stars ?? 0), x - 4, y - 3, pal.inkDim, 12, 800, "left");
    }
    if (pad.label) text(ctx, pad.label, x, y + 10, ready ? pal.ink : pal.inkDim, 8.5, 700);
  },
  bus(ctx, x, y, full, pal) {
    rounded(ctx, x - 56, y - 22, 112, 38, 9, BUS, OUTLINE);
    for (let k = 0; k < 4; k++) {
      rounded(ctx, x - 46 + k * 24, y - 15, 18, 13, 3, "#dff3ff", OUTLINE, 1.5);
      if (full && k < 3) circle(ctx, x - 37 + k * 24, y - 7, 4.5, pal.looks[k]);
    }
    circle(ctx, x - 32, y + 16, 8, OUTLINE);
    circle(ctx, x + 32, y + 16, 8, OUTLINE);
    circle(ctx, x - 32, y + 16, 3, "#bbb");
    circle(ctx, x + 32, y + 16, 3, "#bbb");
  },
  stop(ctx, at, pal) {
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 3;
    line(ctx, at.x - 66, at.y + 4, at.x - 66, at.y - 30);
    circle(ctx, at.x - 66, at.y - 36, 9, BUS, OUTLINE, 2);
    text(ctx, "bus", at.x - 66, at.y - 36, OUTLINE, 6.5, 800);
  },
  bubble(ctx, need, x, y, pal) {
    rounded(ctx, x - 11, y - 11, 22, 19, 8, "#ffffff", OUTLINE, 1.5);
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 8);
    ctx.lineTo(x, y + 13);
    ctx.lineTo(x + 3, y + 8);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    if (need === "food") {
      // a bowl with steam
      ctx.beginPath();
      ctx.arc(x, y - 2, 6, 0, Math.PI);
      ctx.fillStyle = "#ff9f40";
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      line(ctx, x - 2, y - 5, x - 2, y - 8);
      line(ctx, x + 2, y - 5, x + 2, y - 8);
    } else if (need === "toilet") {
      // a roll of paper
      rounded(ctx, x - 6, y - 7, 9, 11, 2, "#ffffff", OUTLINE, 1.2);
      circle(ctx, x + 3, y - 1.5, 3.5, "#ffffff", OUTLINE, 1.2);
      circle(ctx, x + 3, y - 1.5, 1.2, OUTLINE);
    } else {
      // a drop of water
      ctx.beginPath();
      ctx.moveTo(x, y - 9);
      ctx.quadraticCurveTo(x + 7, y - 1, x, y + 3);
      ctx.quadraticCurveTo(x - 7, y - 1, x, y - 9);
      ctx.fillStyle = "#5cb8ee";
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    void pal;
  },
};

