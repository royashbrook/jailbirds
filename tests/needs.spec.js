import { test, expect } from "./fixtures.js";
import { queued, untilSim, waitFrames } from "./helpers.js";

// the "what i want" bubble stays over a head while the warden leads them, so
// it always shows where each one is going until they get there
const HALL = { x: 330, y: 540 };

async function reopen(page, world, warden, others) {
  const save = { ...world, coins: 0, agents: [{ ...world.agents[0], ...warden }, ...others] };
  await page.addInitScript((raw) => localStorage.setItem("jailbirds:save", raw), JSON.stringify(save));
  await page.reload();
}
const shown = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".bubble")].filter((e) => !e.hidden && e.offsetParent !== null).map((e) => e.dataset.need).sort());

test("people in the warden's line keep their bubble: hungry says food, served their time says done", async ({ page }) => {
  await page.goto("/");
  const world = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  const [a, b] = world.agents.slice(1);
  const me = world.agents[0].id;
  const full = { food: 1, wash: 1, toilet: 1 };
  const behind = (k) => ({ state: "follow", leader: me, x: HALL.x - 14 * k, y: HALL.y + 10, path: [], t: k });
  const hungry = { ...a, ...behind(1), house: "c0", slot: 0, served: 0, needs: { ...full, food: 0.05 } };
  const done = { ...b, ...behind(2), house: "c1", slot: 0, served: 999, needs: full };
  await reopen(page, world, { x: HALL.x, y: HALL.y }, [hungry, done]);
  await untilSim(page, (s) => s.steps > 5, 2, "the game to start");
  await waitFrames(page, 4);
  await expect.poll(() => shown(page)).toEqual(["done", "food"]);
});
