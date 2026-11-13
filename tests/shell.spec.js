import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";

// the shell the house template guarantees: the ethos, the build on screen, an
// update that waits for consent, and a jail that holds still while a sheet is open
const ETHOS =
  "no ads, no lives, no timers, nothing to buy, no accounts, no cookies, nothing sold or shared.";
const state = (page) => page.evaluate(() => window.__jailbirds.state());

test("the page and the about sheet carry the house ethos, word for word", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("meta[name=description]")).toHaveAttribute("content", new RegExp(ETHOS.replaceAll(".", "\\.")));
  await page.click("#about");
  await expect(page.getByRole("heading", { name: "jailbirds", exact: true })).toBeVisible();
  await expect(page.locator(".ethos")).toHaveText(ETHOS);
  await expect(page.locator(".maker")).toContainText("made with love by");
});

test("it is money, not coins: the about sheet, the count and its mark say so", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("meta[name=description]")).toHaveAttribute("content", /collect money/);
  await expect(page.locator("#coins")).toHaveAttribute("aria-label", /^money: \$\d+$/);
  // the mark by the count is a green bill, wider than it is tall, with no round coin in it
  const mark = page.locator("#coins .money-mark");
  await expect(mark.locator("rect")).toHaveCount(1);
  await expect(mark.locator("circle")).toHaveCount(0);
  expect(await mark.locator("rect").evaluate((r) => getComputedStyle(r).fill)).toBe("rgb(108, 192, 112)");
  await page.click("#about");
  await expect(page.locator(".card")).toContainText("drop money, and so do the desks");
  await expect(page.locator(".card")).not.toContainText(/coin/i);
});

test("the build is on screen, and in the about sheet", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#version")).toHaveText(/^v\d+\.\d+\.\d+/);
  const served = await (await page.request.get("/version.json")).json();
  await expect(page.locator("#version")).toHaveText(`v${served.version}`);
  await expect(page.locator("meta[name=build]")).toHaveAttribute("content", served.build);
  await page.click("#about");
  await expect(page.locator(".version")).toHaveText(`version ${served.version}`);
});

test("check for update says so when this is the newest", async ({ page }) => {
  await page.goto("/");
  await page.click("#about");
  await page.getByRole("button", { name: "check for update" }).click();
  await expect(page.locator(".card [role=status]")).toHaveText("you have the newest jailbirds");
  await expect(page.locator(".update")).toHaveCount(0);
});

test.describe("with no service worker in the way of the probe", () => {
  // webkit routes a controlled page's fetches past page.route, so the worker sits this one out
  test.use({ serviceWorkers: "block" });
  test("a newer build waits for a tap before it loads", async ({ page }) => {
    await page.route((url) => url.searchParams.has("update-probe"), (route) =>
      route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="build" content="a-newer-build">' }),
    );
    await page.goto("/");
    await page.click("#about");
    await page.getByRole("button", { name: "check for update" }).click();
    await expect(page.locator(".card [role=status]")).toHaveText("a new version is ready");
    await page.click("#close");
    await expect(page.locator(".update")).toHaveText("new version, tap to load");
    const build = await page.locator("meta[name=build]").getAttribute("content");
    await page.waitForTimeout(500);
    await expect(page.locator("meta[name=build]")).toHaveAttribute("content", build);
  });
});

test("an open sheet holds the jail still", async ({ page }) => {
  await page.goto("/");
  await untilSim(page, (s) => s.steps > 5, 1, "the game to start");
  await page.click("#about");
  const before = (await state(page)).steps;
  // frames keep coming while the sheet is open; the game does not move
  await waitFrames(page, 5);
  expect((await state(page)).steps).toBe(before);
  await page.click("#close");
  await untilSim(page, (s) => s.steps > before, 1, "the game to move again");
});
