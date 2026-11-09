// the words and signs over the 3d jail, as plain html laid over the canvas:
// need bubbles, price tags, "full!", "no beds!", the squabble burst, the arrow
// to trouble at the screen's edge, and the thumb stick. every element is made
// once and reused; a frame only moves them and changes text that changed.
import { followers, isDone, noBed, padVisible, SETTLE, wants } from "../engine/sim.ts";
import type { AnyStation, LevelDef, World } from "../engine/types.ts";
import type { Skin } from "../skins/types.ts";
import type { ScreenPoint } from "./view.ts";

export type Thumb = { ox: number; oy: number; x: number; y: number; r: number } | null;
type View = { screen(x: number, h: number, y: number, out: ScreenPoint): ScreenPoint; height: number };
type S<K extends AnyStation["kind"]> = Extract<AnyStation, { kind: K }>;

/** where a tag may go: above its pad, slid right or left past the warden, below, beside */
const SPOTS = 6;
/** how far down a bubble's anchor must be so the whole bubble shows */
const TOP = 40;
/** a pad's half depth in world units, a tag's gap off it and its clearance round the warden, in pixels */
const PAD_HALF = 20;
const GAP = 3;
const CLEAR = 4;

interface Slot { el: HTMLElement; x: number; y: number; shown: boolean; key: string; w: number; h: number }

export function createOverlay(root: HTMLElement) {
  const make = (cls: string, html = ""): Slot => {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    el.hidden = true;
    root.append(el);
    return { el, x: NaN, y: NaN, shown: false, key: "", w: 0, h: 0 };
  };
  const bubbles = Array.from({ length: 64 }, () => make("bubble"));
  const tags = Array.from({ length: 40 }, () => make("tag", "<b></b><span></span>"));
  const full = make("shout");
  const nobed = make("shout warn");
  const burst = make("burst");
  const arrow = make("alert-arrow", "<i></i><b>!</b>");
  const stick = make("stick", "<i></i>");
  const pt: ScreenPoint = { x: 0, y: 0, on: false };
  const edge: ScreenPoint = { x: 0, y: 0, on: false };
  // per tag: candidate spots (x, y each), placed boxes, and who still needs a spot
  const spots = new Float32Array(tags.length * SPOTS * 2);
  const boxes = new Float32Array(tags.length * 4);
  const order = new Int16Array(tags.length);
  let sizedFor = "";

  const show = (s: Slot, on: boolean) => {
    if (s.shown !== on) {
      s.el.hidden = !on;
      s.shown = on;
    }
  };
  const move = (s: Slot, x: number, y: number) => {
    const rx = Math.round(x), ry = Math.round(y);
    if (rx === s.x && ry === s.y) return;
    s.x = rx;
    s.y = ry;
    s.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
  };
  const label = (s: Slot, key: string, write: () => void) => {
    if (s.key === key) return;
    s.key = key;
    write();
  };

  function update(w: World, l: LevelDef, view: View, skin: Skin, words: { full: string; noBed: string }, thumb: Thumb, cssW: number, cssH: number) {
    // need bubbles over heads at home
    let b = 0;
    for (const a of w.agents) {
      if (b >= bubbles.length) break;
      if (a.kind !== "agent" || a.state !== "home" || a.rest < SETTLE) continue;
      const need = isDone(l, a) ? "done" : wants(l, a, true);
      if (!need) continue;
      view.screen(a.x, view.height + 6, a.y, pt);
      if (!pt.on) continue;
      const s = bubbles[b++];
      label(s, need, () => (s.el.dataset.need = need));
      // a bubble sits above its head; near the top edge it stays on screen
      move(s, pt.x, Math.max(pt.y, TOP));
      show(s, true);
    }
    for (; b < bubbles.length; b++) show(bubbles[b], false);

    // price tags: up off the pad's far edge. a tag that would cover the warden
    // slides sideways past him, or goes below or beside the pad, taking the first spot that covers
    // neither the warden nor a tag already placed.
    const me = w.agents[0];
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    // A torso point is not enough at a low angle or close zoom: protect the
    // standing model envelope, including the head and cap, from every direction.
    for (let x = -1; x <= 1; x += 2)
      for (let z = -1; z <= 1; z += 2)
        for (let h = 0; h <= 1; h++) {
          view.screen(me.x + x * view.height / 3, h * (view.height + 2), me.y + z * view.height / 3, pt);
          left = Math.min(left, pt.x); right = Math.max(right, pt.x);
          top = Math.min(top, pt.y); bottom = Math.max(bottom, pt.y);
        }
    const screenKey = `${cssW}x${cssH}`;
    let n = 0, placed = 0, waiting = 0;
    for (const p of l.pads) {
      if (n >= tags.length || !padVisible(w, p)) continue;
      view.screen(p.at.x, 2, p.at.y, pt);
      if (!pt.on) continue;
      const k = n, s = tags[n++];
      const ready = w.rank >= (p.rank ?? 0);
      const price = ready ? String(p.cost - (w.paid[p.id] ?? 0)) : `lv ${p.rank}`;
      label(s, `${ready}:${price}:${p.label}`, () => {
        s.el.classList.toggle("locked", !ready);
        s.el.firstElementChild!.textContent = price;
        s.el.lastElementChild!.textContent = p.label ?? "";
        s.w = 0;
      });
      show(s, true);
      // measure once per text and per screen size (the css shrinks tags on small screens)
      if (!s.w || sizedFor !== screenKey) {
        s.w = s.el.offsetWidth;
        s.h = s.el.offsetHeight;
      }
      // the candidate spots: above, above slid right or left of the warden, below, left, right
      view.screen(p.at.x, 2, p.at.y - PAD_HALF, edge);
      const c = k * SPOTS * 2, top = edge.y - s.h - GAP;
      spots[c] = pt.x - s.w / 2;
      spots[c + 1] = top;
      spots[c + 2] = right + CLEAR * 2;
      spots[c + 3] = top;
      spots[c + 4] = left - CLEAR * 2 - s.w;
      spots[c + 5] = top;
      view.screen(p.at.x, 2, p.at.y + PAD_HALF, edge);
      spots[c + 6] = pt.x - s.w / 2;
      spots[c + 7] = edge.y + GAP;
      view.screen(p.at.x - PAD_HALF * 1.3, 2, p.at.y, edge);
      spots[c + 8] = edge.x - s.w - GAP;
      spots[c + 9] = pt.y - s.h / 2;
      view.screen(p.at.x + PAD_HALF * 1.3, 2, p.at.y, edge);
      spots[c + 10] = edge.x + GAP;
      spots[c + 11] = pt.y - s.h / 2;
      // Judge the actual clamped, rounded position. Moving it inside the screen
      // after testing could put it back over the character or another label.
      for (let j = 0; j < SPOTS; j++) {
        const i = c + j * 2;
        spots[i] = Math.round(Math.max(0, Math.min(cssW - s.w, spots[i])));
        spots[i + 1] = Math.round(Math.max(0, Math.min(cssH - s.h, spots[i + 1])));
      }
      if (coversWarden(spots[c], spots[c + 1], s) || hitsPlaced(spots[c], spots[c + 1], s)) order[waiting++] = k;
      else keep(k, 0);
    }
    // the ones in the warden's way pick from what is left
    for (let i = 0; i < waiting; i++) {
      const k = order[i], s = tags[k];
      let pick = -1;
      for (let j = 0; j < SPOTS && pick < 0; j++) {
        const x = spots[k * SPOTS * 2 + j * 2], y = spots[k * SPOTS * 2 + j * 2 + 1];
        if (!coversWarden(x, y, s) && !hitsPlaced(x, y, s)) pick = j;
      }
      // At an extreme angle there may be no legible slot. The pad remains;
      // its label returns when the camera moves and there is room for it.
      if (pick < 0) show(s, false);
      else keep(k, pick);
    }
    sizedFor = screenKey;
    for (; n < tags.length; n++) show(tags[n], false);

    function coversWarden(x: number, y: number, s: Slot) {
      return left < x + s.w + CLEAR && right > x - CLEAR && top < y + s.h + CLEAR && bottom > y - CLEAR;
    }
    function hitsPlaced(x: number, y: number, s: Slot) {
      for (let i = 0; i < placed; i++) {
        const b = i * 4;
        if (x < boxes[b] + boxes[b + 2] && x + s.w > boxes[b] && y < boxes[b + 1] + boxes[b + 3] && y + s.h > boxes[b + 1]) return true;
      }
      return false;
    }
    function keep(k: number, j: number) {
      const s = tags[k];
      const x = spots[k * SPOTS * 2 + j * 2];
      const y = spots[k * SPOTS * 2 + j * 2 + 1];
      move(s, x, y);
      const b = placed++ * 4;
      boxes[b] = x;
      boxes[b + 1] = y;
      boxes[b + 2] = s.w;
      boxes[b + 3] = s.h;
    }

    // a full line over the warden; no beds over the desk
    const isFull = followers(w, me).length >= w.lineMax;
    if (isFull) {
      view.screen(me.x, view.height + 16, me.y, pt);
      label(full, words.full, () => (full.el.textContent = words.full));
      move(full, pt.x, pt.y);
    }
    show(full, isFull);
    const stalled = noBed(w, l);
    const desk = l.stations.find((s) => s.kind === "checkin") as S<"checkin"> | undefined;
    if (stalled && desk) {
      view.screen(desk.prop.x + desk.prop.w / 2, 30, desk.prop.y + desk.prop.h / 2, pt);
      label(nobed, words.noBed, () => (nobed.el.textContent = words.noBed));
      move(nobed, pt.x, pt.y);
    }
    show(nobed, stalled && !!desk);

    // trouble: a burst over the squabble, an arrow pointing to it from the edge
    const al = w.alert;
    if (al) {
      let mx = 0, my = 0, k = 0;
      for (const a of w.agents)
        if (al.ids.includes(a.id)) {
          mx += a.x;
          my += a.y;
          k++;
        }
      view.screen(k ? mx / k : al.x, view.height + 10, k ? my / k : al.y, pt);
      label(burst, skin.squabble, () => (burst.el.textContent = skin.squabble));
      move(burst, pt.x, pt.y);
      show(burst, pt.on);
      view.screen(al.x, 0, al.y, pt);
      const edge = 34;
      const inView = pt.on && pt.x > edge && pt.y > edge && pt.x < cssW - edge && pt.y < cssH - edge;
      let angle = Math.PI / 2, ax = pt.x, ay = pt.y - 70;
      if (!inView) {
        const cx = cssW / 2, cy = cssH / 2;
        angle = Math.atan2(pt.y - cy, pt.x - cx);
        const reach = Math.min(Math.abs((cx - edge) / Math.cos(angle) || Infinity), Math.abs((cy - edge) / Math.sin(angle) || Infinity));
        ax = cx + Math.cos(angle) * reach;
        ay = cy + Math.sin(angle) * reach;
      }
      move(arrow, ax, ay);
      const deg = String(Math.round((angle * 180) / Math.PI));
      label(arrow, deg, () => (arrow.el.style.setProperty("--turn", `${deg}deg`)));
    } else show(burst, false);
    show(arrow, !!al);

    // the thumb stick where the finger went down
    if (thumb) {
      move(stick, thumb.ox, thumb.oy);
      const kx = Math.round(thumb.x - thumb.ox), ky = Math.round(thumb.y - thumb.oy);
      label(stick, `${kx},${ky}`, () => (stick.el.style.setProperty("--knob", `translate(${kx}px, ${ky}px)`)));
    }
    show(stick, !!thumb);
  }

  return { update };
}
