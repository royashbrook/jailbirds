import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMERA_CONTROLS, DEFAULT_CAMERA, cameraDrag, cameraPinch, cameraSettings, cameraStick, cameraWheel } from "../src/view/camera.ts";

const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);

test("camera preferences are finite and bounded without changing their defaults", () => {
  assert.deepEqual(DEFAULT_CAMERA, { zoom: 2, turn: 30, tilt: 35 });
  assert.deepEqual(CAMERA_CONTROLS.map(c => [c.key, c.min, c.max]), [
    ["zoom", 0.5, 3], ["turn", -180, 180], ["tilt", 15, 85],
  ]);
  assert.deepEqual(cameraSettings({}), DEFAULT_CAMERA);
  for (const c of CAMERA_CONTROLS) {
    assert.equal(cameraSettings({ [c.key]: -1000 })[c.key], c.min);
    assert.equal(cameraSettings({ [c.key]: 1000 })[c.key], c.max);
    for (const value of [NaN, Infinity, -Infinity, null, true, "1.6", [], {}])
      assert.equal(cameraSettings({ [c.key]: value })[c.key], DEFAULT_CAMERA[c.key]);
  }
  const copy = cameraSettings({ zoom: 1.5, turn: -20, tilt: 65 });
  assert.deepEqual(copy, { zoom: 1.5, turn: -20, tilt: 65 });
  copy.zoom = 9;
  assert.equal(DEFAULT_CAMERA.zoom, 2);
});

test("a drag turns by the screen's height for a whole turn and tilts by half that, the jail going with the finger", () => {
  const c = { zoom: 1.5, turn: 30, tilt: 35 };
  const d = cameraDrag(c, 100, 50, 1000);
  near(d.turn, 30 - 36, "a tenth across turns a tenth of the way round, against the finger");
  near(d.tilt, 35 + 9, "a twentieth down tilts nine degrees more over the top");
  assert.equal(d.zoom, 1.5);
  assert.deepEqual(c, { zoom: 1.5, turn: 30, tilt: 35 }, "the start is left alone");
  assert.deepEqual(cameraDrag(c, 0, 0, 1000), c);
  // round and round: it wraps, it never sticks at an end
  near(cameraDrag({ ...c, turn: 170 }, -100, 0, 1000).turn, -154, "past 180 comes round to the other side");
  near(cameraDrag({ ...c, turn: -170 }, 100, 0, 1000).turn, 154, "and the other way");
  near(cameraDrag(c, -1000 * 10, 0, 1000).turn, 30, "ten whole turns land where they began");
  // tilt stops at its ends
  assert.equal(cameraDrag(c, 0, 10000, 1000).tilt, 85);
  assert.equal(cameraDrag(c, 0, -10000, 1000).tilt, 15);
  // a screen with no height is not a division by nothing
  for (const v of Object.values(cameraDrag(c, 5, 5, 0))) assert.ok(Number.isFinite(v));
});

test("two fingers zoom by how far they spread, within its ends", () => {
  const c = { zoom: 1, turn: 10, tilt: 40 };
  near(cameraPinch(c, 100, 150).zoom, 1.5, "half again apart is half again closer");
  near(cameraPinch(c, 100, 80).zoom, 0.8, "closing them backs away");
  assert.equal(cameraPinch(c, 100, 1000).zoom, 3);
  assert.equal(cameraPinch(c, 100, 1).zoom, 0.5);
  assert.deepEqual({ ...cameraPinch(c, 100, 150), zoom: 1 }, c, "only the zoom moves");
  assert.deepEqual(cameraPinch(c, 0, 100), c, "fingers that began together give nothing to go by");
  assert.deepEqual(cameraPinch(c, 100, 0), c);
});

test("a scroll up comes in and down backs away, a notch about a tenth, within its ends", () => {
  const c = { zoom: 1, turn: 10, tilt: 40 };
  near(cameraWheel(c, -100).zoom, Math.exp(0.1), "a notch up");
  near(cameraWheel(c, 100).zoom, Math.exp(-0.1), "a notch down");
  near(cameraWheel(cameraWheel(c, 100), -100).zoom, 1, "down then up is where it was");
  assert.equal(cameraWheel(c, -100000).zoom, 3);
  assert.equal(cameraWheel(c, 100000).zoom, 0.5);
  assert.deepEqual({ ...cameraWheel(c, -100), zoom: 1 }, c, "only the zoom moves");
});

test("a turned camera maps screen right and down onto the ground", () => {
  const right = cameraStick({ x: 1, y: 0 }, 30);
  const down = cameraStick({ x: 0, y: 1 }, 30);
  assert(Math.abs(right.x - Math.sqrt(3) / 2) < 1e-12);
  assert(Math.abs(right.y + 0.5) < 1e-12);
  assert(Math.abs(down.x - 0.5) < 1e-12);
  assert(Math.abs(down.y - Math.sqrt(3) / 2) < 1e-12);
  for (const turn of [-180, -90, -40, -15, 0, 15, 40, 90, 180])
    for (const input of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0.4, y: 0.6 }]) {
      const world = cameraStick(input, turn);
      assert(Math.abs(Math.hypot(world.x, world.y) - Math.hypot(input.x, input.y)) < 1e-12);
      const back = cameraStick(world, -turn);
      assert(Math.abs(back.x - input.x) < 1e-12 && Math.abs(back.y - input.y) < 1e-12);
    }
});
