import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMERA_CONTROLS, DEFAULT_CAMERA, cameraSettings, cameraStick } from "../src/view/camera.ts";

test("camera preferences are finite and bounded without changing their defaults", () => {
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
  assert.equal(DEFAULT_CAMERA.zoom, 1);
});

test("a turned camera maps screen right and down onto the ground", () => {
  const right = cameraStick({ x: 1, y: 0 }, 30);
  const down = cameraStick({ x: 0, y: 1 }, 30);
  assert(Math.abs(right.x - Math.sqrt(3) / 2) < 1e-12);
  assert(Math.abs(right.y + 0.5) < 1e-12);
  assert(Math.abs(down.x - 0.5) < 1e-12);
  assert(Math.abs(down.y - Math.sqrt(3) / 2) < 1e-12);
  for (const turn of [-40, -15, 0, 15, 40])
    for (const input of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0.4, y: 0.6 }]) {
      const world = cameraStick(input, turn);
      assert(Math.abs(Math.hypot(world.x, world.y) - Math.hypot(input.x, input.y)) < 1e-12);
      const back = cameraStick(world, -turn);
      assert(Math.abs(back.x - input.x) < 1e-12 && Math.abs(back.y - input.y) < 1e-12);
    }
});
