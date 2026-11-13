import { test, expect } from "./fixtures.js";
import { state, waitSim } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the map, driven like a player: an old save at level 6 with the warden standing on the next jail
// pad, so the first thing that happens is the pad being paid. nothing else comes or goes
const NEXT = LEVELS[0].pads.find((p) => p.id === "next");
const map = (page) => page.evaluate(() => window.__jailbirds.map());
function oldSave() {
  const w = create(LEVELS, 0, 321);
  Object.assign(w, { rank: 6, coins: 260, ride: { state: "away", x: -100, t: 9999 }, fightIn: 9999, boost: { x: 0, y: 0, here: false, t: 9999 } });
  Object.assign(w.agents[0], { x: NEXT.at.x, y: NEXT.at.y });
  return JSON.stringify(w);
}
function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("the next jail pad opens desert rock: later, go there, come back, and a reload keeps it all", async ({ page }) => {
  const errors = watch(page);
  const raw = oldSave();
  // seeded once, before the game opens, the way an old device has it
  await page.goto("/manifest.json");
  await page.evaluate((v) => localStorage.setItem("jailbirds:save", v), raw);
  await page.goto("/");

  // paid once, she is told, and she is still in pine hill
  await expect(page.locator("#unlocked-title")).toHaveText("new jail unlocked!");
  await expect(page.locator(".card")).toContainText("desert rock is on the map now.");
  const paid = await state(page);
  expect(paid.coins).toBe(60);
  expect(paid.level).toBe(0);
  expect(paid.bought.filter((id) => id === "next")).toEqual(["next"]);
  expect(await map(page)).toEqual({ active: "jail1", unlocked: ["jail1", "jail2"] });

  // later: she plays on where she stands, and nothing more is taken
  await page.click("#later");
  await expect(page.locator("dialog")).toHaveCount(0);
  await waitSim(page, 1);
  expect((await state(page)).coins).toBe(60);
  await expect(page.locator("#place")).toHaveText("pine hill");

  // the map: here, open, and two places coming later
  await page.click("#map");
  await expect(page.locator('[data-jail="jail1"]')).toContainText("you are here");
  await expect(page.locator('[data-jail="jail2"] .go')).toBeVisible();
  for (const id of ["jail3", "jail4"]) {
    await expect(page.locator(`[data-jail="${id}"]`)).toHaveAttribute("data-state", "later");
    await expect(page.locator(`[data-jail="${id}"]`)).toContainText("coming later");
    await expect(page.locator(`[data-jail="${id}"] button`)).toHaveCount(0);
  }
  await page.click('[data-jail="jail2"] .go');
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.locator("#place")).toHaveText("desert rock");
  const there = await waitSim(page, 0.5);
  expect(there.level).toBe(1);
  expect(there.coins).toBe(0);
  await expect(page.locator("#level-up")).toHaveCount(0);
  await expect(page.locator("#coins b")).toHaveText("0");

  // and back: pine hill as she left it
  await page.click("#map");
  await expect(page.locator('[data-jail="jail2"]')).toContainText("you are here");
  await page.click('[data-jail="jail1"] .go');
  await expect(page.locator("#place")).toHaveText("pine hill");
  const back = await state(page);
  expect(back.level).toBe(0);
  expect(back.coins).toBe(60);
  expect(back.steps).toBeGreaterThanOrEqual(paid.steps);

  // a reload keeps the map, and the old save was never touched
  await page.reload();
  await expect(page.locator("#place")).toHaveText("pine hill");
  expect(await map(page)).toEqual({ active: "jail1", unlocked: ["jail1", "jail2"] });
  expect((await state(page)).coins).toBe(60);
  await expect(page.locator("#unlocked-title")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("jailbirds:save"))).toBe(raw);
  expect(errors).toEqual([]);
});

test("a browser that will not save: she plays on, is told, and is not sent off to another jail", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript((raw) => {
    localStorage.setItem("jailbirds:save", raw);
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  }, oldSave());
  await page.goto("/");
  await expect(page.locator("#unlocked-title")).toBeVisible();
  await page.click("#go-now");
  await expect(page.locator(".card .warn")).toHaveText("can't go yet: this browser is not saving your jail");
  expect(await map(page)).toEqual({ active: "jail1", unlocked: ["jail1", "jail2"] });
  await page.click("#later");
  await expect(page.locator("#tip .warn")).toHaveText("this browser is not saving your jail");
  await expect(page.locator("#place")).toHaveText("pine hill");
  const s = await waitSim(page, 0.5);
  expect(s.coins).toBe(60);
  expect(errors).toEqual([]);
});
