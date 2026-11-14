import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/content/jail.ts";
import { pegs } from "../src/skins/pegs.ts";
import { WALL_CAP, WALL_H, yardPieces } from "../src/view/scene.ts";

test("the yard uses bounded shared shapes outside every playable rectangle, in both palettes", () => {
  for (const l of LEVELS) for (const dark of [false, true]) {
    const pal = pegs.palette(dark), inputs = JSON.stringify({ l, pal });
    const pieces = yardPieces(l, pal);
    assert.ok(pieces.length > 30 && pieces.length < 100);
    assert.deepEqual(pieces, yardPieces(l, pegs.palette(dark)));
    assert.equal(JSON.stringify({ l, pal }), inputs);
    for (const p of pieces) {
      assert.ok(["box", "cyl", "ball"].includes(p.shape));
      const rx = p.shape === "box" ? p.sx / 2 : p.sx;
      const rz = p.shape === "box" ? p.sz / 2 : p.sz;
      assert.ok(p.x + rx < 0 || p.x - rx > l.size.w || p.z + rz < 0 || p.z - rz > l.size.h, JSON.stringify(p));
      assert.ok([p.x, p.y, p.z, p.sx, p.sy, p.sz].every(Number.isFinite));
      assert.ok(p.sx > 0 && p.sy > 0 && p.sz > 0);
      assert.match(p.colour, /^#[a-f0-9]{6}$/i);
    }
    assert.equal(pieces.filter(p => p.shape === "ball").length, 18);
  }
});

test("first-pass wall caps and jambs stay below a standing head", () => {
  const headBottom = pegs.model.height - 4.6 * 2 - 4;
  assert.ok(WALL_H + WALL_CAP + 1 < headBottom);
});
