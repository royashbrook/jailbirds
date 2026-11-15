import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { LEVELS } from "../src/content/jail.ts";
import { pegs } from "../src/skins/pegs.ts";
import { CARE_BED_SHAPE, HOME_BED_SHAPE } from "../src/view/scene.ts";
import { actionOf, restIn } from "../src/view/view.ts";

// someone resting in a care bed is drawn with the head on the pillow and the body on the sheet, inside
// the bed. measured off the skin's own parts, put together the way view.ts puts them together, so it
// cannot pass just because the pose is called sleep
const L = LEVELS[0];
const care = L.stations.find((s) => s.id === "hospital");
const resident = (seat) => ({
  id: 9, kind: "agent", x: care.seats[seat].at.x, y: care.seats[seat].at.y, face: 1, moving: false, walk: 0, look: 1, tags: ["uniform"],
  state: "use", leader: -1, house: "c0", slot: 0, station: "hospital", seat, needs: { food: 1, wash: 1, toilet: 1 },
  unrest: 0, served: 0, hurt: 10, rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
});

/** every part of the drawn character, as a world box, the way view.ts lays it out */
function drawn(a, place) {
  const pose = { kind: a.kind, action: actionOf(null, L, a), walk: 0, t: 0, look: a.look, uniform: true, carry: 0, mood: "ok" };
  const r = pegs.model.root(pose);
  const root = new Matrix4().compose(new Vector3(place.x, r.lift + place.up, place.z), new Quaternion().setFromEuler(new Euler(r.pitch, place.heading, 0, "YXZ")), new Vector3(1, 1, 1));
  const geo = Object.fromEntries(Object.entries(pegs.model.parts).map(([k, make]) => {
    const g = make();
    g.computeBoundingBox();
    return [k, g.boundingBox];
  }));
  const local = new Object3D(), m = new Matrix4(), out = [];
  pegs.model.pose(pose, (part, x, y, z, pitch, yaw, roll, sx, sy, sz) => {
    local.position.set(x, y, z);
    local.rotation.set(pitch, yaw, roll);
    local.scale.set(sx, sy, sz);
    local.updateMatrix();
    m.multiplyMatrices(root, local.matrix);
    out.push({ part, box: new Box3().copy(geo[part]).applyMatrix4(m) });
  });
  return { pose, out };
}

for (const seat of [0, 1, 2, 3]) test(`in care bed ${seat}: head on the pillow, lying on the sheet, all of it on the bed`, () => {
  const a = resident(seat), at = care.seats[seat].at, { half, pillow, sheetTop } = CARE_BED_SHAPE;
  const place = restIn(L, a, actionOf(null,L,a));
  assert.ok(place, "a care rest place");
  const { pose, out } = drawn(a, place);
  assert.equal(pose.action, "sleep");
  const head = out.find((p) => p.part === "head").box.getCenter(new Vector3());
  // the pillow is 16 across and 8 along, centred `pillow` from the seat
  assert.ok(Math.abs(head.x - at.x) <= 8, `head x ${head.x}`);
  assert.ok(Math.abs(head.z - (at.y + pillow)) <= 4, `head z ${head.z} vs pillow ${at.y + pillow}`);
  const all = out.reduce((b, p) => b.union(p.box), new Box3().makeEmpty());
  // on the sheet: not sunk into it, not floating over it
  const body = out.find((p) => p.part === "body").box;
  assert.ok(body.min.y >= sheetTop - 0.2, `body underside ${body.min.y} below the sheet ${sheetTop}`);
  assert.ok(body.min.y <= sheetTop + 1.5, `body underside ${body.min.y} floats over the sheet ${sheetTop}`);
  // the whole figure inside the bed's length
  assert.ok(all.min.z >= at.y - half - 0.5 && all.max.z <= at.y + half + 0.5, `figure z ${all.min.z}..${all.max.z}`);
});

for (const house of L.stations.filter(s => s.kind === "house")) for (const slot of [0,1]) for (const hurt of [0,10])
  test(`${house.id} bunk${slot}, bump${hurt}: head is on its own pillow, not beyond the foot of the mattress`, () => {
    const at=house.seats[slot].at,home={...resident(0),state:"home",house:house.id,slot,station:"",seat:-1,
      x:at.x,y:at.y,hurt,rest:10};
    const before=JSON.stringify(home),place=restIn(L,home,actionOf(null,L,home));
    assert.ok(place);
    const {pose,out}=drawn(home,place),head=out.find(p=>p.part==="head").box.getCenter(new Vector3());
    assert.equal(pose.action,"sleep");
    assert.ok(Math.abs(head.z-(at.y+HOME_BED_SHAPE.offset+HOME_BED_SHAPE.pillow))<.01);
    assert.ok(Math.abs(head.x-at.x)<.01);
    const body=out.find(p=>p.part==="body").box;
    assert.ok(body.min.y>=HOME_BED_SHAPE.sheetTop-.2&&body.min.y<=HOME_BED_SHAPE.sheetTop+1.5);
    const all=out.reduce((b,p)=>b.union(p.box),new Box3().makeEmpty());
    assert.ok(all.min.z>=at.y+HOME_BED_SHAPE.offset-HOME_BED_SHAPE.half-.5);
    assert.ok(all.max.z<=at.y+HOME_BED_SHAPE.offset+HOME_BED_SHAPE.half+.5);
    assert.equal(JSON.stringify(home),before);
  });

test("an invalid home is not a fabricated bed pose", () => {
  assert.equal(restIn(L,{...resident(0),state:"home",house:"missing"},"sleep"),null);
});

test("an awake resident at home keeps the standing position instead of a bed transform", () => {
  const a={...resident(0),state:"home",station:"",seat:-1,hurt:0,rest:0};
  const action=actionOf(null,L,a);
  assert.equal(action,"stand");
  assert.equal(restIn(L,a,action),null);
});
