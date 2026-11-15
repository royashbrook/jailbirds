import { test, expect } from "./fixtures.js";
import { squabbleAt, untilSim, waitFrames } from "./helpers.js";
import { create } from "../src/engine/sim.ts";
import { LEVELS } from "../src/content/jail.ts";

// the next-goal row in the hud (docs/progression.md, P1.1): a pad to save for, or the next level
// that opens one; hidden, never removed, during an alert or with nothing left, so the jail never jumps
const L = LEVELS[0];
const pad = (id) => L.pads.find((p) => p.id === id);
const row = (page) => page.locator("#goal");
const text = (page) => row(page).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
// read at once, no waiting: a row that is not there at all reads as no box
const box = (page, s) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : { x: 0, y: -1, width: 0, height: 0 };
  }, s);
const shown = (page) => row(page).evaluate((el) => getComputedStyle(el).visibility);

// `still`: a sheet opens at once (the next jail just unlocked) and holds the game still, so wait on frames
async function open(page, w, still = false) {
  await page.addInitScript((raw) => {
    localStorage.removeItem("jailbirds:map");
    if (raw) localStorage.setItem("jailbirds:save", raw);
    else localStorage.removeItem("jailbirds:save");
  }, w ? JSON.stringify(w) : "");
  await page.goto("/");
  if (!still) await untilSim(page, (s) => s.steps > 5, 2, "the game to start");
  await waitFrames(page, 5);
}
// the row as a fresh game lays it out on this page's screen, to hold the other states to
async function freshRow(page, info) {
  const ctx = await page.context().browser().newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const p = await ctx.newPage();
  await open(p, null);
  const b = await box(p, "#goal");
  await ctx.close();
  return b;
}

test("a fresh game shows the cheapest open pad, nothing paid", async ({ page }) => {
  await open(page, null);
  const c = pad("cell3");
  await expect.poll(() => text(page)).toBe(`${c.label} 0/${c.cost}`);
  expect(await shown(page)).toBe("visible");
  await expect(page.locator("#tip")).not.toBeEmpty();
  await expect(page.locator("#tip")).toBeVisible();
});

test("paying into the pad moves the row", async ({ page }) => {
  // three in hand, standing on it: it takes the three and the row says so
  const c = pad("cell3");
  const w = create(LEVELS, 0, 5);
  w.coins = 3;
  Object.assign(w.agents[0], { x: c.at.x, y: c.at.y });
  await open(page, w);
  await untilSim(page, (s) => (s.paid.cell3 ?? 0) === 3, 4, "three paid into the pad");
  await expect.poll(() => text(page)).toBe(`${c.label} 3/${c.cost}`);
  const fill = await page.locator("#goal .fill").evaluate((el) => el.style.width);
  expect(parseFloat(fill)).toBeCloseTo((100 * 3) / c.cost, 1);
});

test("nothing open at this level names the next level and a real pad there", async ({ page }) => {
  const w = create(LEVELS, 0, 5);
  w.bought = ["cell3", "line1"];
  await open(page, w);
  await expect.poll(() => text(page)).toBe(`level 2: ${pad("cell4").label}`);
  expect(await shown(page)).toBe("visible");
  await expect(page.locator("#tip")).not.toBeEmpty();
});

test("an alert hides the row but keeps its place", async ({ page }, info) => {
  const fresh = await freshRow(page, info);
  expect(fresh.height).toBeGreaterThanOrEqual(16);
  const w = create(LEVELS, 0, 5);
  w.ride = { state: "away", x: -100, t: 1e9 };
  // the warden far from the squabble, so it stays on
  Object.assign(w.agents[0], { x: 330, y: 540 });
  const at = L.stations.find((s) => s.id === "c0").at;
  const { others, ...q } = squabbleAt(w, at);
  await open(page, { ...w, ...q, agents: [w.agents[0], ...others] });
  expect((await untilSim(page, (s) => s.steps > 5, 2, "running")).alert).not.toBeNull();
  await waitFrames(page, 3);
  // the footprint first: the same box as a fresh game's row
  const b = await box(page, "#goal");
  expect(b.height, "row height during an alert").toBe(fresh.height);
  expect(b.y, "row top during an alert").toBe(fresh.y);
  await expect.poll(() => shown(page)).toBe("hidden");
  // the goal is still there under it, only not shown
  expect(await text(page)).toBe(`${pad("cell3").label} 0/${pad("cell3").cost}`);
  await expect(page.locator("#tip")).not.toBeEmpty();
  await expect(page.locator("#tip")).toBeVisible();
});

test("with everything bought the row is hidden in the same place", async ({ page }, info) => {
  const fresh = await freshRow(page, info);
  const w = create(LEVELS, 0, 5);
  w.rank = 9;
  w.bought = L.pads.map((p) => p.id);
  await open(page, w, true);
  expect((await page.evaluate(() => window.__jailbirds.state())).bought).toHaveLength(L.pads.length);
  const b = await box(page, "#goal");
  expect(b.height, "row height with nothing left").toBe(fresh.height);
  expect(b.y, "row top with nothing left").toBe(fresh.y);
  await expect.poll(() => shown(page)).toBe("hidden");
  expect(await text(page)).toBe("");
});

// what the row costs the jail on each screen: printed, so the cost is in the log
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 844, height: 390 }, { width: 768, height: 1024 }])
  test(`${size.width}x${size.height}: the row sits above the jail and nothing scrolls sideways`, async ({ page, browserName }) => {
    await page.setViewportSize(size);
    await open(page, null);
    await expect.poll(() => text(page)).not.toBe("");
    const g = await box(page, "#goal"), jail = await box(page, "#jail");
    expect(g.height).toBeGreaterThan(0);
    expect(g.y + g.height).toBeLessThanOrEqual(jail.y);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(size.width);
    const tall = () => page.evaluate(() => document.querySelector("#jail").clientHeight);
    const withRow = await tall();
    // and what it would be with no row at all, for the record only
    await page.addStyleTag({ content: "#goal { display: none !important; }" });
    await expect.poll(tall).toBeGreaterThan(withRow);
    const without = await tall();
    console.log(`[goal] ${browserName} ${size.width}x${size.height}: canvas ${withRow}px with the row, ${without}px without, cost ${without - withRow}px; row ${g.height}px`);
  });

// the narrowest phone with big text and wide side insets: the longest real goal label still ellipsizes,
// and the row and its money stay inside the content box, never past the screen (the page would clip it,
// so a scroll check alone cannot see it)
test("320 wide, large text, wide side insets: the row and its money stay inside the content box", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const w = create(LEVELS, 0, 5);
  w.rank = 5;
  // everything else open at this rank bought, so the riot guard is the goal, paid all but one
  w.bought = L.pads.filter((p) => (p.rank ?? 0) <= 5 && p.id !== "riotguard" && p.id !== "next").map((p) => p.id);
  w.paid = { riotguard: pad("riotguard").cost - 1 };
  w.ride = { state: "away", x: -100, t: 1e9 };
  w.fightIn = 1e9;
  await page.addInitScript(() => {
    const s = document.createElement("style");
    s.textContent = ".play{padding-left:44px!important;padding-right:44px!important}.goal{font-size:20px!important}.goal small{font-size:18px!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
  });
  await open(page, w);
  expect(await text(page)).toBe(`${pad("riotguard").label} ${pad("riotguard").cost - 1}/${pad("riotguard").cost}`);
  const right = 320 - 44;
  const goalBox = await box(page, "#goal");
  const money = await box(page, "#goal small");
  expect(goalBox.x + goalBox.width, "the row inside the content box").toBeLessThanOrEqual(right + 0.5);
  expect(money.x + money.width, "its money inside the content box").toBeLessThanOrEqual(right + 0.5);
});
