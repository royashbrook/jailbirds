import { test } from "node:test";
import assert from "node:assert/strict";
import { create, isOpen } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";
import { pegs } from "../src/skins/pegs.ts";
import { carePieces, rubbleRooms } from "../src/view/scene.ts";

// the care room is drawn as a care room: a bed at each seat it really has, grey until that bed is
// bought, a bedside ice pack in each open row and a little cabinet. not shower stalls, and nothing at
// all while the room is still rubble
const pieces = (l, bought, dark = false) => {
  const w = create(LEVELS, LEVELS.indexOf(l), 3);
  w.bought = [...bought];
  const st = l.stations.find((s) => s.kind === "facility" && s.look === "care");
  const buried = new Set(rubbleRooms(l, w).map((r) => r.id));
  return { st, pal: pegs.palette(dark), got: carePieces(l, st, (id) => isOpen(w, id), buried, pegs.palette(dark)) };
};
/** the beds drawn: one frame per seat, at the seat */
const beds = (st, got, pal) => got.filter((p) => p.sx === 24 && p.sz === 44 && st.seats.some((s) => s.at.x === p.x && s.at.y === p.z));
const open = (got, pal) => got.filter((p) => p.sx === 21 && p.colour !== pal.locked);

test("nothing is drawn in the care room while it is rubble", () => {
  for (const l of LEVELS) assert.deepEqual(pieces(l, []).got, [], l.id);
});

test("the care room bought: four beds where its four seats are, two open, two grey, one ice pack row, a cabinet", () => {
  for (const l of LEVELS) for (const dark of [false, true]) {
    const { st, pal, got } = pieces(l, ["hospital"], dark);
    assert.equal(beds(st, got, pal).length, 4, l.id);
    assert.equal(open(got, pal).length, 2, "the two bought");
    assert.equal(got.filter((p) => p.colour === "#8fd3f4").length, 1, "an ice pack by the open row");
    assert.equal(got.filter((p) => p.sx === 26 && p.sy === 22).length, 1, "the cabinet");
    // no shower stall bits: glass panes or shower poles
    assert.ok(!got.some((p) => p.colour === pal.glass), "no shower glass");
  }
});

test("with the extra beds bought all four are open, an ice pack in each row", () => {
  for (const l of LEVELS) {
    const { st, pal, got } = pieces(l, ["hospital", "carebeds"]);
    assert.equal(beds(st, got, pal).length, 4);
    assert.equal(open(got, pal).length, 4);
    assert.equal(got.filter((p) => p.colour === "#8fd3f4").length, 2);
  }
});

test("everything drawn stays inside the care room and off its walking zone, and is a sane shape", () => {
  for (const l of LEVELS) {
    const { st, got } = pieces(l, ["hospital", "carebeds"]);
    const room = l.rooms.find((r) => r.id === "hospital").rect;
    for (const p of got) {
      assert.ok(p.x - p.sx / 2 >= room.x && p.x + p.sx / 2 <= room.x + room.w, JSON.stringify(p));
      assert.ok(p.z - p.sz / 2 >= room.y && p.z + p.sz / 2 <= room.y + room.h, JSON.stringify(p));
      assert.ok([p.x, p.y, p.z, p.sx, p.sy, p.sz].every(Number.isFinite) && p.sx > 0 && p.sy > 0 && p.sz > 0);
      assert.match(p.colour, /^#[0-9a-f]{6}$/i);
      // the zone between the rows is where people walk to the beds: nothing tall stands in it
      const z = st.zone;
      const inZone = p.x > z.x && p.x < z.x + z.w && p.z > z.y && p.z < z.y + z.h;
      assert.ok(!inZone || p.y + p.sy / 2 <= 12, `tall piece in the walking zone ${JSON.stringify(p)}`);
    }
  }
});
