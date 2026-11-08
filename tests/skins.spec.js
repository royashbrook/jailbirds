import { test, expect } from "@playwright/test";

// two skins over one game: switching the look changes what is drawn and the
// words, never the game. the pick is remembered.
const state = (page) => page.evaluate(() => window.__jailbirds.state());
const pixels = (page) => page.evaluate(() => {
  const c = document.querySelector("#jail");
  return c.toDataURL();
});

test("birds by default; peg people from settings, same game underneath, remembered", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).agents.length, { timeout: 8000 }).toBe(4);
  expect(await page.evaluate(() => window.__jailbirds.skin())).toBe("birds");
  await page.click("#about");
  await expect(page.locator(".card")).toContainText("new birds come by bus");
  await page.click("#close");

  await page.click("#nav-settings");
  await expect(page.locator(".sheet h2")).toHaveText("settings");
  await expect(page.locator("#skin-birds")).toHaveAttribute("aria-pressed", "true");
  // the sheet holds the world still: grab it, a frame of birds, then switch
  const held = await state(page);
  const birds = await pixels(page);
  await page.click("#skin-pegs");
  await expect(page.locator("#skin-pegs")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__jailbirds.skin())).toBe("pegs");
  // a frame later the same still world is drawn another way
  await expect.poll(() => pixels(page)).not.toBe(birds);
  expect(await state(page)).toEqual(held);

  await page.click("#close");
  await page.click("#about");
  await expect(page.locator(".card")).toContainText("new inmates come by bus");
  await page.click("#close");
  await page.reload();
  expect(await page.evaluate(() => window.__jailbirds.skin())).toBe("pegs");
  expect((await state(page)).agents.length).toBe(held.agents.length);
});
