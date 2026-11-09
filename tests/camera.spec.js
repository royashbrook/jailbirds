import { test, expect } from "./fixtures.js";
import { state, untilSim, waitFrames, waitSim } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

const defaults = { zoom: 1, turn: 15, tilt: 50 };
const settings = page => page.evaluate(() => window.__jailbirds.camera());
const eye = page => page.evaluate(() => window.__jailbirds.drawn().eye);
const open = async page => { await page.click("#camera"); await expect(page.locator("dialog")).toBeVisible(); };

test("live camera preview pauses the jail, persists separately and resets", async ({ page }) => {
  const legacy = create(LEVELS, 0, 321);
  legacy.coins = 37;
  legacy.rank = 3;
  const raw = JSON.stringify(legacy);
  // seed once on the same origin without loading the app. an init script
  // would overwrite progress on reload and hide a broken preservation path.
  await page.goto("/manifest.json");
  await page.evaluate(value => localStorage.setItem("jailbirds:save", value), raw);
  await page.goto("/");
  await waitFrames(page, 5);
  await open(page);
  const paused = await state(page);
  const saved = await page.evaluate(() => localStorage.getItem("jailbirds:save"));
  const before = await eye(page);
  await page.locator("#camera-zoom").press("End");
  await waitFrames(page, 3);
  const zoomed = await eye(page);
  expect(zoomed).not.toEqual(before);
  await page.locator("#camera-turn").press("Home");
  await waitFrames(page, 3);
  const turned = await eye(page);
  expect(turned).not.toEqual(zoomed);
  await page.locator("#camera-tilt").press("End");
  await waitFrames(page, 3);
  expect(await eye(page)).not.toEqual(turned);
  expect(await state(page)).toEqual(paused);
  expect(await page.evaluate(() => localStorage.getItem("jailbirds:save"))).toBe(saved);
  const desired = { zoom: 3, turn: -180, tilt: 85 };
  expect(await settings(page)).toEqual(desired);
  await page.click("#close");
  await page.reload();
  await waitFrames(page, 3);
  expect(await settings(page)).toEqual(desired);
  expect((await state(page)).coins).toBe(37);
  expect((await state(page)).rank).toBe(3);
  await open(page);
  const resetState = await state(page);
  await page.click("#reset-camera");
  await waitFrames(page, 3);
  expect(await settings(page)).toEqual(defaults);
  expect(await state(page)).toEqual(resetState);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("jailbirds:camera")))).toEqual(defaults);
});

test("invalid saved camera values recover without touching progress", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jailbirds:camera", '{"zoom":"1000","turn":999,"tilt":null}'));
  await page.goto("/");
  await waitFrames(page, 3);
  expect(await settings(page)).toEqual({ zoom: 1, turn: 180, tilt: 50 });
  expect(await page.locator(".nogl").count()).toBe(0);
});

test("refused camera writes are visible and leave the old preference intact", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("jailbirds:camera", JSON.stringify({ zoom: 1, turn: 15, tilt: 50 }));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "jailbirds:camera") throw new DOMException("full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/");
  await open(page);
  await page.locator("#camera-zoom").press("End");
  await expect(page.locator(".camera-note")).toContainText("not saving your view");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("jailbirds:camera")))).toEqual(defaults);
  expect(await page.locator("#tip").textContent()).not.toContain("not saving your jail");
});

test("touch adjusts the camera slider without walking the warden", async ({ page }) => {
  await page.goto("/");
  await waitFrames(page, 4);
  await open(page);
  const paused = await state(page);
  const before = (await settings(page)).zoom;
  const slider = await page.locator("#camera-zoom").boundingBox();
  await page.touchscreen.tap(slider.x + slider.width - 10, slider.y + slider.height / 2);
  await waitFrames(page, 3);
  expect((await settings(page)).zoom).toBeGreaterThan(before);
  expect(await state(page)).toEqual(paused);
});

for (const turn of [-180, -90, 0, 90, 180])
  test(`screen-right movement follows the rendered camera at ${turn} degrees`, async ({ page }) => {
    await page.goto("/");
    await open(page);
    await page.locator("#camera-turn").evaluate((e, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, turn);
    await waitFrames(page, 2);
    const right = await page.evaluate(() => {
      const { eye, target } = window.__jailbirds.drawn();
      const x = eye[2] - target[2], y = target[0] - eye[0];
      const length = Math.hypot(x, y);
      return { x: x / length, y: y / length };
    });
    await page.click("#close");
    const start = (await state(page)).agents[0];
    await page.keyboard.down("ArrowRight");
    await untilSim(page, s => Math.hypot(s.agents[0].x - start.x, s.agents[0].y - start.y) > 15, 3, "screen-right movement");
    await page.keyboard.up("ArrowRight");
    const end = (await waitSim(page, 0.1)).agents[0];
    const dx = end.x - start.x, dy = end.y - start.y;
    expect(dx * right.x + dy * right.y).toBeGreaterThan(10);
    expect(Math.abs(dx * -right.y + dy * right.x)).toBeLessThan(2);
  });

for (const viewport of [
  { width: 320, height: 568 }, { width: 430, height: 932 },
  { width: 844, height: 390 }, { width: 932, height: 430 },
  { width: 1024, height: 1366 }, { width: 1366, height: 1024 },
])
  test(`${viewport.width}x${viewport.height}: camera controls leave a live preview visible`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitFrames(page, 4);
    await open(page);
    for (const end of ["Home", "End"])
      for (const id of ["zoom", "turn", "tilt"]) {
        await page.locator(`#camera-${id}`).press(end);
        await waitFrames(page, 2);
        const m = await page.evaluate(() => {
          const surface = document.querySelector(".surface").getBoundingClientRect();
          const card = document.querySelector(".camera-card").getBoundingClientRect();
          const p = window.__jailbirds.warden();
          const x = surface.x + p.x, y = surface.y + p.y;
          return {
            inside: p.on && x >= surface.x && x <= surface.right && y >= surface.y && y <= surface.bottom,
            covered: x >= card.x && x <= card.right && y >= card.y && y <= card.bottom,
            card: card.toJSON(), scroll: document.documentElement.scrollWidth,
            controls: [...document.querySelectorAll('.camera-card input, .camera-card button')].map(e => e.getBoundingClientRect().toJSON()),
          };
        });
        expect(m.inside).toBe(true);
        expect(m.covered).toBe(false);
        expect(m.scroll).toBe(viewport.width);
        expect(m.card.x).toBeGreaterThanOrEqual(0);
        expect(m.card.right).toBeLessThanOrEqual(viewport.width);
        expect(m.card.y).toBeGreaterThanOrEqual(0);
        expect(m.card.bottom).toBeLessThanOrEqual(viewport.height);
        for (const c of m.controls) {
          expect(Math.min(c.width, c.height)).toBeGreaterThanOrEqual(44);
          expect(c.x >= m.card.x && c.right <= m.card.right && c.y >= m.card.y && c.bottom <= m.card.bottom).toBe(true);
        }
      }
  });
