import { test, expect } from "./fixtures.js";
import { waitFrames, walkTo } from "./helpers.js";

// a price tag stands up off its pad. on a short, wide phone it must never sit on
// top of the warden: measured where the warden's torso lands on screen against
// every visible tag's box, at spawn and standing right on a pad.
async function covering(page) {
  return page.evaluate(() => {
    const p = window.__jailbirds.warden();
    const surface = document.querySelector(".surface").getBoundingClientRect();
    const x = surface.x + p.x, y = surface.y + p.y;
    return [...document.querySelectorAll(".tag:not([hidden])")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2;
      })
      .map((e) => e.textContent);
  });
}

/** pairs of visible tags whose boxes overlap: a sign moved off the warden must not land on another */
async function stacked(page) {
  return page.evaluate(() => {
    const tags = [...document.querySelectorAll(".tag:not([hidden])")].map((e) => ({ text: e.textContent, b: e.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < tags.length; i++)
      for (let j = i + 1; j < tags.length; j++) {
        const a = tags[i].b, b = tags[j].b;
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push(`${tags[i].text} / ${tags[j].text}`);
      }
    return out;
  });
}

for (const scheme of ["light", "dark"])
  for (const size of [{ width: 844, height: 390 }, { width: 932, height: 430 }])
    test(`${size.width}x${size.height} ${scheme}: no price tag covers the warden`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await page.goto("/");
      await waitFrames(page, 10);
      expect(await page.locator(".tag:not([hidden])").count()).toBeGreaterThan(0);
      // the spare signs in the pool take no room on screen
      expect(await page.evaluate(() => [...document.querySelectorAll(".overlay > [hidden]")].filter((e) => e.getClientRects().length).length)).toBe(0);
      expect(await covering(page), "at spawn").toEqual([]);
      expect(await stacked(page), "tags on tags at spawn").toEqual([]);
      // stand right on the longer line pad
      await walkTo(page, { x: 320, y: 590 });
      await waitFrames(page, 4);
      expect(await covering(page), "on a pad").toEqual([]);
      expect(await stacked(page), "tags on tags on a pad").toEqual([]);
    });
