import type { Stick } from "../engine/types.ts";

export const CAMERA_CONTROLS = [
  { key: "zoom", label: "zoom", min: 0.75, max: 1.75, step: 0.05 },
  { key: "turn", label: "turn", min: -40, max: 40, step: 1 },
  { key: "tilt", label: "tilt", min: 40, max: 70, step: 1 },
] as const;

export type CameraSettings = Record<(typeof CAMERA_CONTROLS)[number]["key"], number>;
export const DEFAULT_CAMERA: Readonly<CameraSettings> = { zoom: 1, turn: 15, tilt: 50 };

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

// the stick follows the screen, not the map's axes, when the view turns.
export function cameraStick(stick: Stick, turn: number): Stick {
  const a = turn * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: stick.x * c + stick.y * s, y: -stick.x * s + stick.y * c };
}
