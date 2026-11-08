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

for (const scheme of ["light", "dark"])
  for (const size of [{ width: 844, height: 390 }, { width: 932, height: 430 }])
    test(`${size.width}x${size.height} ${scheme}: no price tag covers the warden`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await page.goto("/");
      await waitFrames(page, 10);
      expect(await page.locator(".tag:not([hidden])").count()).toBeGreaterThan(0);
      expect(await covering(page), "at spawn").toEqual([]);
      // stand right on the longer line pad
      await walkTo(page, { x: 320, y: 590 });
      await waitFrames(page, 4);
      expect(await covering(page), "on a pad").toEqual([]);
    });
