import { test as base, expect } from "@playwright/test";

// browser tests are quiet, in every engine: webkit on a mac plays to the real speakers. each page gets
// this before its own scripts: a live AudioContext hands out a silent gain as its destination, joined to
// the real one, so the game's sound still runs and the speakers get zeros. tests only, never the game
export function quiet() {
  if (window.__quiet || typeof AudioContext === "undefined") return;
  const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination").get;
  const silent = new WeakMap(), outputs = new WeakSet();
  window.__quiet = { loud: 0, through: 0 };
  Object.defineProperty(AudioContext.prototype, "destination", {
    configurable: true,
    get() {
      let gain = silent.get(this);
      if (!gain) {
        gain = this.createGain();
        gain.gain.value = 0;
        silent.set(this, gain);
        outputs.add(gain);
        gain.connect(real.call(this));
      }
      return gain;
    },
  });
  // what reaches the silent gains, and anything that still reaches the speakers some other way, is
  // counted, so a test can show a page played and made no sound
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (outputs.has(target)) window.__quiet.through++;
    if (target instanceof AudioDestinationNode && target.context instanceof AudioContext && !outputs.has(this)) window.__quiet.loud++;
    return connect.call(this, target, ...rest);
  };
}

// a hosted ci runner has no gpu, so frames come slowly. two ways to get that here:
//   SLOW_FRAMES=ms  every animation frame waits ms first (both engines)
//   THROTTLE=n      devtools cpu throttling, n times slower (chromium only)
// the specs wait on what the game has done, never on how long the wall clock took.
export const test = base.extend({
  // pages from the default context
  context: async ({ context }, use) => {
    await context.addInitScript(quiet);
    await use(context);
  },
  // and contexts a test makes itself
  browser: [
    async ({ browser }, use) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const context = await newContext(...args);
        await context.addInitScript(quiet);
        return context;
      };
      await use(browser);
    },
    { scope: "worker" },
  ],
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
