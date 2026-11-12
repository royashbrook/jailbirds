import type { Stick } from "../engine/types.ts";

export const CAMERA_CONTROLS = [
  { key: "zoom", label: "zoom", min: 0.5, max: 3, step: 0.05 },
  { key: "turn", label: "turn", min: -180, max: 180, step: 1 },
  { key: "tilt", label: "tilt", min: 15, max: 85, step: 1 },
] as const;

export type CameraSettings = Record<(typeof CAMERA_CONTROLS)[number]["key"], number>;
/** close in, a little turned and fairly low, like the games this one is after */
export const DEFAULT_CAMERA: Readonly<CameraSettings> = { zoom: 2, turn: 30, tilt: 35 };

// preferences are separate from the saved jail; a stale or malformed value
// must not put the camera below the floor or make the world disappear.
export function cameraSettings(raw: Partial<CameraSettings>): CameraSettings {
  const out = { ...DEFAULT_CAMERA };
  for (const c of CAMERA_CONTROLS) {
    const value = raw[c.key];
    out[c.key] = typeof value === "number" && Number.isFinite(value)
      ? Math.min(c.max, Math.max(c.min, value))
      : DEFAULT_CAMERA[c.key];
  }
  return out;
}

// moving the view by hand. a drag across the whole height of the screen turns it all
// the way round, and up or down the whole height tilts it half that, the way most 3d
// viewers do. the jail goes the way the finger goes.
/** a finger or mouse moved `dx`, `dy` css pixels on a screen `height` pixels tall */
export function cameraDrag(c: CameraSettings, dx: number, dy: number, height: number): CameraSettings {
  const h = Math.max(1, height);
  const turn = c.turn - (dx * 360) / h;
  return cameraSettings({ ...c, turn: ((((turn + 180) % 360) + 360) % 360) - 180, tilt: c.tilt + (dy * 180) / h });
}
/** two fingers went from `was` apart to `now` apart: the jail grows as they spread */
export function cameraPinch(c: CameraSettings, was: number, now: number): CameraSettings {
  return was > 0 && now > 0 ? cameraSettings({ ...c, zoom: c.zoom * (now / was) }) : c;
}
/** a wheel or trackpad scroll: down (positive) backs away, up comes in. a notch is about a tenth */
export function cameraWheel(c: CameraSettings, deltaY: number): CameraSettings {
  return cameraSettings({ ...c, zoom: c.zoom * Math.exp(-deltaY / 1000) });
}

// the stick follows the screen, not the map's axes, when the view turns.
export function cameraStick(stick: Stick, turn: number): Stick {
  const a = turn * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: stick.x * c + stick.y * s, y: -stick.x * s + stick.y * c };
}
