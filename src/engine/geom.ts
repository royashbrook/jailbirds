// walls from rooms, the player bumping into them, and a way round them for
// everyone else: a coarse grid, a* across it, then the corners pulled tight.
import type { Door, LevelDef, Pt, Rect, RoomDef } from "./types.ts";

export const WALL = 6;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const near = (a: Pt, b: Pt, r: number) => dist(a, b) <= r;
export const inside = (p: Pt, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

/** the gap's middle on the wall line, and which way is out */
export function doorMid(room: RoomDef, d: Door): { mid: Pt; out: Pt } {
  const r = room.rect, c = d.at + d.width / 2;
  if (d.side === "n") return { mid: { x: r.x + c, y: r.y }, out: { x: 0, y: -1 } };
  if (d.side === "s") return { mid: { x: r.x + c, y: r.y + r.h }, out: { x: 0, y: 1 } };
  if (d.side === "w") return { mid: { x: r.x, y: r.y + c }, out: { x: -1, y: 0 } };
  return { mid: { x: r.x + r.w, y: r.y + c }, out: { x: 1, y: 0 } };
}

/** wall pieces of every room, with gaps for its doors. a door marked `actors: false`
 * (a door only residents use) is shut to the player and helpers and open to the agents who live there */
export function walls(level: LevelDef, open: (room: RoomDef) => boolean, agents = false): Rect[] {
  const out: Rect[] = [];
  for (const room of level.rooms) {
    const r = room.rect;
    for (const side of ["n", "s", "e", "w"] as const) {
      const horizontal = side === "n" || side === "s";
      const length = horizontal ? r.w : r.h;
      const gaps = open(room)
        ? room.doors.filter((d) => d.side === side && (agents || d.actors !== false)).map((d) => [d.at, d.at + d.width])
        : [];
      gaps.sort((a, b) => a[0] - b[0]);
      let from = 0;
      for (const [a, b] of [...gaps, [length, length]]) {
        if (a > from) {
          if (horizontal) out.push({ x: r.x + from - WALL / 2, y: (side === "n" ? r.y : r.y + r.h) - WALL / 2, w: a - from + WALL, h: WALL });
          else out.push({ x: (side === "w" ? r.x : r.x + r.w) - WALL / 2, y: r.y + from - WALL / 2, w: WALL, h: a - from + WALL });
        }
        from = b;
      }
    }
  }
  return out;
}

/** push a round body of radius `rad` out of every wall it overlaps */
export function collide(p: Pt, rad: number, ws: Rect[]) {
  for (let pass = 0; pass < 2; pass++)
    for (const w of ws) {
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w)), cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      if (d >= rad) continue;
      if (d > 0.0001) {
        p.x = cx + (dx / d) * rad;
        p.y = cy + (dy / d) * rad;
      } else {
        // centre inside the wall: out along the shortest way
        const l = p.x - w.x, r = w.x + w.w - p.x, t = p.y - w.y, b = w.y + w.h - p.y, m = Math.min(l, r, t, b);
        if (m === l) p.x = w.x - rad;
        else if (m === r) p.x = w.x + w.w + rad;
        else if (m === t) p.y = w.y - rad;
        else p.y = w.y + w.h + rad;
      }
    }
}

const TILE = 8;
const CLEAR = 11;
export interface Nav { cols: number; rows: number; blocked: Uint8Array }
export function nav(level: LevelDef, ws: Rect[]): Nav {
  const cols = Math.ceil(level.size.w / TILE), rows = Math.ceil(level.size.h / TILE);
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
      if (ws.some((w) => inside(p, w, CLEAR))) blocked[r * cols + c] = 1;
    }
  return { cols, rows, blocked };
}
const cellOf = (n: Nav, p: Pt) => {
  const c = Math.min(n.cols - 1, Math.max(0, Math.floor(p.x / TILE))), r = Math.min(n.rows - 1, Math.max(0, Math.floor(p.y / TILE)));
  return r * n.cols + c;
};
/** the nearest open tile, for a point that sits on a wall's edge */
function open(n: Nav, i: number) {
  if (!n.blocked[i]) return i;
  const seen = new Set([i]), queue = [i];
  while (queue.length) {
    const at = queue.shift()!;
    if (!n.blocked[at]) return at;
    const c = at % n.cols, r = (at - c) / n.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr, j = rr * n.cols + cc;
      if (cc >= 0 && rr >= 0 && cc < n.cols && rr < n.rows && !seen.has(j)) seen.add(j), queue.push(j);
    }
  }
  return i;
}
/** true when a straight walk from a to b touches no blocked tile */
export function clear(n: Nav, a: Pt, b: Pt) {
  const steps = Math.ceil(dist(a, b) / (TILE / 2));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (n.blocked[cellOf(n, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })]) return false;
  }
  return true;
}
/** waypoints from one point to another round the walls, ending exactly at `to` */
export function route(n: Nav, from: Pt, to: Pt): Pt[] {
  if (clear(n, from, to)) return [to];
  const start = open(n, cellOf(n, from)), goal = open(n, cellOf(n, to));
  const size = n.cols * n.rows;
  const g = new Float32Array(size).fill(Infinity), came = new Int32Array(size).fill(-1), done = new Uint8Array(size);
  const gx = goal % n.cols, gy = (goal - gx) / n.cols;
  const h = (i: number) => {
    const c = i % n.cols, dx = Math.abs(c - gx), dy = Math.abs((i - c) / n.cols - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  // a small binary heap of [f, tile]
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };
  g[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const i = pop();
    if (i === goal) break;
    if (done[i]) continue;
    done[i] = 1;
    const c = i % n.cols, r = (i - c) / n.cols;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= n.cols || rr >= n.rows) continue;
        const j = rr * n.cols + cc;
        if (n.blocked[j] || done[j]) continue;
        // no cutting a corner between two blocked tiles
        if (dr && dc && (n.blocked[r * n.cols + cc] || n.blocked[rr * n.cols + c])) continue;
        const cost = g[i] + (dr && dc ? 1.414 : 1);
        if (cost < g[j]) {
          g[j] = cost;
          came[j] = i;
          push(cost + h(j), j);
        }
      }
  }
  if (goal !== start && came[goal] < 0) return [to];
  const tiles: Pt[] = [];
  for (let i = goal; i !== start && i >= 0; i = came[i]) {
    const c = i % n.cols;
    tiles.unshift({ x: c * TILE + TILE / 2, y: ((i - c) / n.cols) * TILE + TILE / 2 });
  }
  tiles.push(to);
  // pull the string: from each corner, jump to the farthest point still in sight
  const out: Pt[] = [];
  let at = from, k = 0;
  while (k < tiles.length) {
    let far = k;
    for (let j = tiles.length - 1; j > k; j--)
      if (clear(n, at, tiles[j])) {
        far = j;
        break;
      }
    out.push(tiles[far]);
    at = tiles[far];
    k = far + 1;
  }
  return out;
}
