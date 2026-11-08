import { test, expect } from "@playwright/test";

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

test("the build is on screen, and in the about sheet", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".corner")).toHaveText(/^v\d+\.\d+\.\d+/);
  const served = await (await page.request.get("/version.json")).json();
  await expect(page.locator(".corner")).toHaveText(`v${served.version}`);
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
  await expect.poll(() => state(page).then((s) => s.steps)).toBeGreaterThan(5);
  await page.click("#about");
  const before = (await state(page)).steps;
  await page.waitForTimeout(500);
  expect((await state(page)).steps).toBe(before);
  await page.click("#close");
  await expect.poll(() => state(page).then((s) => s.steps)).toBeGreaterThan(before);
});
