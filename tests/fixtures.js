import { test as base, expect } from "@playwright/test";

// a hosted ci runner has no gpu, so frames come slowly. two ways to get that here:
//   SLOW_FRAMES=ms  every animation frame waits ms first (both engines)
//   THROTTLE=n      devtools cpu throttling, n times slower (chromium only)
// the specs wait on what the game has done, never on how long the wall clock took.
export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    const slow = Number(process.env.SLOW_FRAMES || 0);
    if (slow > 0)
      await page.addInitScript((ms) => {
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), ms);
      }, slow);
    const rate = Number(process.env.THROTTLE || 0);
    if (rate > 1 && browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    }
    await use(page);
  },
});
export { expect };
