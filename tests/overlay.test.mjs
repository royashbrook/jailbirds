import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";
import { createOverlay } from "../src/view/overlay.ts";

// the "+3" and the ring, through a stand-in for the page: it draws nothing, it keeps
// what each element was told. how they look and move is css, and tests/polish.spec.js
// looks at that in a browser; this is when they show, what they say and when they go.
const HEAD = 30;
function page() {
  const made = [];
  globalThis.document = {
    createElement() {
      const classes = new Set(), attrs = {};
      const el = {
        className: "", innerHTML: "", hidden: false, textContent: "", dataset: {}, offsetWidth: 40, offsetHeight: 20,
        style: { transform: "", setProperty() {} },
        classList: { toggle: (name, on) => void (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
        setAttribute: (name, value) => void (attrs[name] = value),
        getAttribute: (name) => attrs[name] ?? null,
        firstElementChild: { textContent: "" }, lastElementChild: { textContent: "" },
      };
      made.push(el);
      return el;
    },
  };
  const overlay = createOverlay({ append() {} });
  const world = create(LEVELS, 0);
  // a flat stand-in camera: a spot in the world is the same spot on the screen, a height
  // lifts it, and anything left of the screen's edge is out of sight
  const view = { height: HEAD, screen: (x, h, y, out) => Object.assign(out, { x, y: y - h, on: x >= 0 }) };
  const draw = (now) => overlay.update(world, LEVELS[0], view, { squabble: "hey!" }, { full: "full!", noBed: "no beds!" }, null, 390, 700, now);
  const up = (cls) => made.filter((el) => el.className === cls && !el.hidden);
  const pops = () => up("pop").map((el) => `${el.firstElementChild.textContent}${el.classList.contains("star") ? " star" : ""}`).sort();
  return { overlay, world, draw, up, pops, made };
}
const at = (x, y) => `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;

test("nothing came in, nothing shows", () => {
  const p = page();
  p.draw(1000);
  assert.deepEqual(p.pops(), []);
  assert.deepEqual(p.up("ring"), []);
  assert.deepEqual(p.overlay.shown(), { coins: 0, stars: 0, rings: 0 });
  assert.equal(p.made.filter((el) => el.className === "pop").length, 8);
  assert.equal(p.made.filter((el) => el.className === "ring").length, 4);
});

test("coins that came in show as one +n over the warden's head, for the eyes only", () => {
  const p = page();
  p.overlay.gain("coin", 3);
  assert.deepEqual(p.pops(), [], "not before a frame is drawn");
  p.draw(1000);
  assert.deepEqual(p.pops(), ["+3"]);
  const [el] = p.up("pop"), me = p.world.agents[0];
  assert.equal(el.style.transform, at(me.x, me.y - HEAD - 8));
  assert.equal(el.getAttribute("aria-hidden"), "true");
  assert.deepEqual(p.overlay.shown(), { coins: 3, stars: 0, rings: 0 });
  // it goes where the warden goes
  me.x += 40;
  me.y -= 25;
  p.draw(1016);
  assert.equal(el.style.transform, at(me.x, me.y - HEAD - 8));
});

test("a +n is up for 900ms from the frame that first drew it, and then put away", () => {
  const p = page();
  p.overlay.gain("coin", 3);
  p.draw(5000);
  p.draw(5899);
  assert.deepEqual(p.pops(), ["+3"]);
  p.draw(5900);
  assert.deepEqual(p.pops(), []);
  // the tally is of everything that ever came in, not of what is up
  assert.deepEqual(p.overlay.shown(), { coins: 3, stars: 0, rings: 0 });
});

test("more coins inside 300ms count up on the +n already floating; after that a new one starts", () => {
  const p = page();
  p.overlay.gain("coin", 1);
  p.overlay.gain("coin", 2);
  p.draw(1000);
  assert.deepEqual(p.pops(), ["+3"], "two that came in before a frame are one");
  p.overlay.gain("coin", 2);
  p.draw(1299);
  assert.deepEqual(p.pops(), ["+5"]);
  p.overlay.gain("coin", 1);
  p.draw(1300);
  assert.deepEqual(p.pops(), ["+6"], "at 299ms it still counts up");
  p.overlay.gain("coin", 4);
  p.draw(1316);
  assert.deepEqual(p.pops(), ["+4", "+6"], "at 300ms a new one starts");
  assert.deepEqual(p.overlay.shown(), { coins: 10, stars: 0, rings: 0 });
  // counting up did not keep the first one up any longer
  p.draw(1899);
  assert.deepEqual(p.pops(), ["+4", "+6"]);
  p.draw(1900);
  assert.deepEqual(p.pops(), ["+4"]);
  p.draw(2215);
  assert.deepEqual(p.pops(), ["+4"]);
  p.draw(2216);
  assert.deepEqual(p.pops(), []);
});

test("a star gets its own +n, marked as a star, and coins do not count up on it", () => {
  const p = page();
  p.overlay.gain("coin", 2);
  p.overlay.gain("star", 1);
  p.overlay.gain("coin", 5);
  p.overlay.gain("star", 1);
  p.draw(1000);
  assert.deepEqual(p.pops(), ["+2 star", "+7"]);
  assert.deepEqual(p.overlay.shown(), { coins: 7, stars: 2, rings: 0 });
});

test("a slot used for a star is a coin's again the next time", () => {
  const p = page();
  p.overlay.gain("star", 1);
  p.draw(1000);
  const [el] = p.up("pop");
  p.draw(1900);
  // the same count as the star had, so nothing but the kind has changed
  p.overlay.gain("coin", 1);
  p.draw(2000);
  assert.deepEqual(p.up("pop"), [el]);
  assert.deepEqual(p.pops(), ["+1"]);
});

test("a pad bought shows a ring where the pad stood, for 600ms", () => {
  const p = page();
  p.overlay.ring(200, 300);
  assert.deepEqual(p.up("ring"), []);
  p.draw(1000);
  const [el] = p.up("ring");
  assert.equal(p.up("ring").length, 1);
  assert.equal(el.style.transform, at(200, 300 - 2));
  assert.equal(el.getAttribute("aria-hidden"), "true");
  assert.deepEqual(p.overlay.shown(), { coins: 0, stars: 0, rings: 1 });
  // it stays on the pad, not on the warden
  p.world.agents[0].x += 50;
  p.draw(1599);
  assert.equal(el.style.transform, at(200, 300 - 2));
  assert.equal(p.up("ring").length, 1);
  p.draw(1600);
  assert.deepEqual(p.up("ring"), []);
});

test("a ring for a pad out of sight is counted and not shown", () => {
  const p = page();
  p.overlay.ring(-50, 300);
  p.overlay.ring(120, 300);
  p.draw(1000);
  assert.deepEqual(p.up("ring").map((el) => el.style.transform), [at(120, 298)]);
  assert.deepEqual(p.overlay.shown(), { coins: 0, stars: 0, rings: 2 });
});

test("a fifth ring while four are up takes the place of the one up the longest", () => {
  const p = page();
  for (let i = 0; i < 4; i++) {
    p.overlay.ring(100 + i * 10, 300);
    p.draw(1000 + i * 100);
  }
  assert.deepEqual(p.up("ring").map((el) => el.style.transform), [at(100, 298), at(110, 298), at(120, 298), at(130, 298)]);
  p.overlay.ring(500, 300);
  p.draw(1400);
  assert.deepEqual(p.up("ring").map((el) => el.style.transform), [at(500, 298), at(110, 298), at(120, 298), at(130, 298)]);
  // and it gets its own full 600ms
  p.draw(1999);
  assert.deepEqual(p.up("ring").map((el) => el.style.transform), [at(500, 298)]);
  p.draw(2000);
  assert.deepEqual(p.up("ring"), []);
});
