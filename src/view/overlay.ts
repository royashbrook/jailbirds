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

interface Slot { el: HTMLElement; x: number; y: number; shown: boolean; key: string }

export function createOverlay(root: HTMLElement) {
  const make = (cls: string, html = ""): Slot => {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    el.hidden = true;
    root.append(el);
    return { el, x: NaN, y: NaN, shown: false, key: "" };
  };
  const bubbles = Array.from({ length: 64 }, () => make("bubble"));
  const tags = Array.from({ length: 40 }, () => make("tag", "<b></b><span></span>"));
  const full = make("shout");
  const nobed = make("shout warn");
  const burst = make("burst");
  const arrow = make("alert-arrow", "<i></i><b>!</b>");
  const stick = make("stick", "<i></i>");
  const pt: ScreenPoint = { x: 0, y: 0, on: false };

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
      move(s, pt.x, pt.y);
      show(s, true);
    }
    for (; b < bubbles.length; b++) show(bubbles[b], false);

    // price tags
    let n = 0;
    for (const p of l.pads) {
      if (n >= tags.length || !padVisible(w, p)) continue;
      view.screen(p.at.x, 2, p.at.y, pt);
      if (!pt.on) continue;
      const s = tags[n++];
      const ready = w.rank >= (p.rank ?? 0);
      const price = ready ? String(p.cost - (w.paid[p.id] ?? 0)) : `lv ${p.rank}`;
      label(s, `${ready}:${price}:${p.label}`, () => {
        s.el.classList.toggle("locked", !ready);
        s.el.firstElementChild!.textContent = price;
        s.el.lastElementChild!.textContent = p.label ?? "";
      });
      move(s, pt.x, pt.y);
      show(s, true);
    }
    for (; n < tags.length; n++) show(tags[n], false);

    // a full line over the warden; no beds over the desk
    const me = w.agents[0];
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
