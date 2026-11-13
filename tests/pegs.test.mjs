import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, Vector3 } from "three";
import { ARM, model } from "../src/skins/pegs.ts";

const pose = (over) => ({ kind: "agent", action: "stand", walk: 0, t: 0, look: 0, uniform: false, carry: 0, mood: "ok", ...over });
function parts(p) {
  const out = [];
  model.pose(p, (part, x, y, z, pitch, yaw, roll, sx, sy, sz, colour) => out.push({ part, x, y, z, pitch, yaw, roll, sx, sy, sz, colour }));
  return out;
}
const hex = (s) => parseInt(s.slice(1), 16);

test("every character fits in the parts the view sets aside for one", () => {
  for (const kind of ["agent", "player", "escort", "carrier", "clerk", "cleaner", "collector"])
    for (const uniform of [false, true])
      for (const action of ["stand", "walk", "sit", "eat", "sleep", "clean", "fight", "wash"]) {
        const counts = {};
        for (const { part } of parts(pose({ kind, uniform, action, walk: 7, t: 1.3, carry: kind === "carrier" ? 2 : 0 }))) counts[part] = (counts[part] ?? 0) + 1;
        for (const [part, n] of Object.entries(counts)) assert.ok(n <= model.perCharacter[part], `${kind} ${action}: ${n} ${part}`);
      }
});

test("heads are blank: nothing on the face for anyone", () => {
  for (const kind of ["agent", "player", "escort", "carrier", "clerk", "cleaner", "collector"]) {
    const all = parts(pose({ kind }));
    const head = all.find((q) => q.part === "head");
    const onFace = all.filter((q) => q.part === "dot" && Math.hypot(q.x - head.x, q.y - head.y, q.z - head.z) < 6);
    assert.deepEqual(onFace, [], kind);
  }
});

test("a squabble is a hop and windmill punches, one arm then the other", () => {
  const at = (t) => parts(pose({ action: "fight", t }));
  const hips = [0, 0.05, 0.1, 0.15].map((t) => at(t).find((q) => q.part === "body").y);
  assert.ok(Math.max(...hips) - Math.min(...hips) > 1.5, "hops");
  const arms = at(0.3).filter((q) => q.part === "limb").slice(2);
  assert.ok(Math.abs(arms[0].pitch - arms[1].pitch) > 0.5, "the arms take turns");
});

test("hands sit at the end of the arms, wherever the arms swing", () => {
  for (const p of [pose({ action: "walk", walk: 5 }), pose({ action: "wash", t: 0.4 }), pose({ kind: "carrier", carry: 1 })]) {
    const all = parts(p);
    const arms = all.filter((q) => q.part === "limb").slice(2);
    const hands = all.filter((q) => q.part === "dot" && q.sx === q.sy && q.sx > 1.5 && q.colour !== hex("#c5ced8"));
    assert.equal(hands.length, 2, p.action);
    arms.forEach((arm, k) => {
      const end = new Vector3(0, -(ARM + 0.4) * arm.sx, 0).applyEuler(new Euler(arm.pitch, arm.yaw, arm.roll));
      const h = hands[k];
      assert.ok(Math.hypot(h.x - arm.x - end.x, h.y - arm.y - end.y, h.z - arm.z - end.z) < 1e-9, `${p.action} hand ${k}`);
    });
  }
});

test("new arrivals wear jeans and cuffs, inmates an orange jumpsuit, guards a badge", () => {
  const metal = hex("#c5ced8"), badge = hex("#ffcf33"), orange = hex("#ff8a3d"), jeans = hex("#4d6a9a");
  const fresh = parts(pose({}));
  assert.equal(fresh.filter((q) => q.colour === metal).length, 2, "two cuffs");
  assert.ok(fresh.filter((q) => q.part === "limb").slice(0, 2).every((l) => l.colour === jeans), "jeans");
  const inmate = parts(pose({ uniform: true }));
  assert.equal(inmate.filter((q) => q.colour === metal).length, 0, "cuffs come off at intake");
  assert.ok(inmate.filter((q) => q.part === "limb").every((l) => l.colour === orange), "one orange suit");
  assert.equal(inmate.filter((q) => q.part === "hat" && q.colour === orange).length, 0, "no pants band on a jumpsuit");
  for (const kind of ["player", "escort"]) assert.equal(parts(pose({ kind })).filter((q) => q.colour === badge).length, 1, kind);
  assert.equal(parts(pose({ kind: "cleaner" })).filter((q) => q.colour === badge).length, 0);
});

test("the collector has a look of its own: green, in a cap", () => {
  const body = (kind) => parts(pose({ kind })).find((q) => q.part === "body").colour;
  const looks = ["player", "escort", "carrier", "clerk", "cleaner"].map(body);
  assert.equal(body("collector"), hex("#4caf50"));
  assert.ok(!looks.includes(body("collector")), "nobody else in that colour");
  const cap = parts(pose({ kind: "collector" })).filter((q) => q.part === "hat" && q.colour === hex("#1e5e2a"));
  assert.equal(cap.length, 2, "a cap and its peak");
});
