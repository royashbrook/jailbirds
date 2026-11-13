import { test } from "node:test";
import assert from "node:assert/strict";
import { create, HOLD } from "../src/engine/sim.ts";
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
  // and long after, with nothing up: two that came in before a frame are still one
  p.overlay.gain("coin", 2);
  p.overlay.gain("coin", 3);
  p.draw(2300);
  assert.deepEqual(p.pops(), ["+5"]);
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

test("the hold: a ring over the one held fills with the sim's own hold, stays put through a pause, and goes when it ends", () => {
  const p = page();
  p.draw(1000);
  assert.deepEqual(p.up("hold"), [], "no hold, no ring");
  const b = { ...structuredClone(p.world.agents[0]), id: 7, kind: "agent", state: "ready", x: 200, y: 300 };
  p.world.agents.push(b);
  p.world.grab = { id: 7, t: HOLD / 2 };
  const before = JSON.stringify(p.world);
  p.draw(1016);
  const [el] = p.up("hold");
  assert.equal(el.style.transform, at(200, 300 - HEAD - 6), "over their head");
  assert.equal(el.dataset.fill, "50");
  assert.equal(el.getAttribute("aria-hidden"), "true");
  // the screen only reads: nothing in the world moved on, and a long gap with the sim paused fills nothing
  p.draw(9000);
  assert.equal(el.dataset.fill, "50");
  assert.equal(JSON.stringify(p.world), before);
  p.world.grab.t = HOLD;
  p.draw(9016);
  assert.equal(el.dataset.fill, "100");
  // a resident at home has a bubble there: the ring goes above it
  b.state = "home";
  p.draw(9032);
  assert.ok(el.classList.contains("up") && !el.classList.contains("side"));
  // near the top of the screen (a phone on its side) there is no room above: beside the bubble,
  // and the whole ring stays on screen (its top is the anchor less 34px)
  b.y = HEAD + 6 + 20;
  p.draw(9040);
  assert.ok(el.classList.contains("side") && !el.classList.contains("up"), "beside, not above");
  const y = Number(el.style.transform.match(/, (-?\d+)px, 0\)/)[1]);
  assert.ok(y - 34 >= 0, `ring top on screen, anchor ${y}`);
  assert.ok(!el.classList.contains("left"), "right of the bubble when there is room");
  // near the right edge too (the screen here is 390 wide): it goes on the bubble's left, all on screen
  b.x = 370;
  p.draw(9044);
  assert.ok(el.classList.contains("side") && el.classList.contains("left"), "left of the bubble at the right edge");
  const x = Number(el.style.transform.match(/translate3d\((-?\d+)px/)[1]);
  assert.ok(x - 52 >= 0 && x - 52 + 30 <= 390, `ring across ${x - 52}..${x - 22} on a 390 screen`);
  b.x = 200;
  b.y = 300;
  p.world.grab = null;
  p.draw(9048);
  assert.deepEqual(p.up("hold"), [], "gone the moment the hold ends");
  // a hold on someone no longer there shows nothing
  p.world.grab = { id: 99, t: 0.3 };
  p.draw(9064);
  assert.deepEqual(p.up("hold"), []);
});

test("a squabble's burst says a new comic shout every so often, from the skin's list", async () => {
  const { SHOUT_MS } = await import("../src/view/overlay.ts");
  const { pegs } = await import("../src/skins/pegs.ts");
  const made = [];
  globalThis.document = {
    createElement() {
      const el = { className: "", innerHTML: "", hidden: false, textContent: "", dataset: {}, offsetWidth: 40, offsetHeight: 20,
        style: { transform: "", setProperty() {} }, classList: { toggle() {}, contains: () => false },
        setAttribute() {}, getAttribute: () => null, firstElementChild: { textContent: "" }, lastElementChild: { textContent: "" } };
      made.push(el);
      return el;
    },
  };
  const overlay = createOverlay({ append() {} });
  const world = create(LEVELS, 0);
  world.alert = { x: 200, y: 300, ids: [], held: 0 };
  const view = { height: HEAD, screen: (x, h, y, out) => Object.assign(out, { x, y: y - h, on: x >= 0 }) };
  const said = (now) => {
    overlay.update(world, LEVELS[0], view, pegs, { full: "max!", noBed: "no beds!" }, null, 390, 700, now);
    return made.find((el) => el.className === "burst").firstElementChild.textContent;
  };
  const heard = new Set(pegs.shouts.map((_, k) => said(k * SHOUT_MS + 1)));
  assert.deepEqual([...heard].sort(), [...pegs.shouts].sort(), "every shout comes round");
  assert.equal(said(10), said(SHOUT_MS - 10), "one shout holds for a moment");
  assert.ok(pegs.shouts.includes("watch this!") && pegs.shouts.includes("pow!"));
});

test("the squabble burst sits over the doorway where the two are drawn, not over their bunks", () => {
  const p = page();
  // two fighters really in the world, in their bunks, well away from the door
  const a = { ...p.world.agents[0], id: p.world.nextId++, kind: "agent", state: "fight", x: 40, y: 120 };
  const b = { ...p.world.agents[0], id: p.world.nextId++, kind: "agent", state: "fight", x: 60, y: 140 };
  p.world.agents.push(a, b);
  p.world.alert = { x: 200, y: 300, ids: [a.id, b.id], held: 0 };
  p.draw(1000);
  const burst = p.made.find((el) => el.className === "burst");
  assert.equal(burst.style.transform, at(200, 300 - HEAD - 10));
});
