import { test, expect } from "./fixtures.js";
import { byId, inmates, line, queued, state, untilSim, walkTo } from "./helpers.js";

// the music and the sounds, through a stand-in for web audio: it makes no noise,
// it writes down every context made, every sound started, every suspend and resume.
// what the player does with it is tests/sound.test.mjs; this is the page's wiring.
function fakeAudio() {
  const log = { made: 0, starts: 0, suspends: 0, resumes: 0, state: "none" };
  window.__audio = log;
  const param = (v = 0) => {
    const p = { value: v };
    for (const name of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) p[name] = () => p;
    return p;
  };
  const node = (extra = {}) => ({ connect: (n) => n, disconnect() {}, ...extra });
  const source = (extra) => node({ onended: null, start: () => void log.starts++, stop() {}, ...extra });
  window.AudioContext = class {
    constructor() {
      log.made++;
      this.state = log.state = "suspended";
      this.sampleRate = 44100;
      this.destination = node();
      this.onstatechange = null;
      this.t0 = performance.now();
    }
    get currentTime() {
      return (performance.now() - this.t0) / 1000;
    }
    resume() {
      log.resumes++;
      this.state = log.state = "running";
      return Promise.resolve();
    }
    suspend() {
      log.suspends++;
      this.state = log.state = "suspended";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createGain() {
      return node({ gain: param(1) });
    }
    createDynamicsCompressor() {
      return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    }
    createBiquadFilter() {
      return node({ type: "lowpass", frequency: param(), Q: param() });
    }
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    createBufferSource() {
      return source({ buffer: null, loop: false });
    }
    createOscillator() {
      return source({ type: "sine", frequency: param(440) });
    }
  };
  delete window.webkitAudioContext;
}
const audio = (page) => page.evaluate(() => ({ ...window.__audio }));
const sound = (page) => page.evaluate(() => window.__jailbirds.sound());
const kept = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("jailbirds:sound")));
const keep = (page, value) => page.addInitScript((v) => localStorage.setItem("jailbirds:sound", JSON.stringify(v)), value);
async function tapJail(page) {
  const box = await page.locator("#jail").boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const DESK = { x: 140, y: 584 }, CORRIDOR = { x: 140, y: 540 }, OUT = { x: 228, y: 680 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeAudio);
});

test("music and sounds are on from the start, wait for the first tap, and the tune plays on under a sheet", async ({ page }) => {
  await page.goto("/");
  await untilSim(page, (s) => s.steps > 30, 2, "the game to run a while");
  expect(await audio(page)).toMatchObject({ made: 0, starts: 0 });
  expect(await sound(page)).toMatchObject({ music: true, sfx: true, state: "none", tune: false, steps: 0, pace: 1, trouble: false });
  await tapJail(page);
  await expect.poll(() => sound(page).then((s) => s.tune)).toBe(true);
  expect(await audio(page)).toMatchObject({ made: 1, state: "running" });
  await page.click("#about");
  await expect(page.locator("#music")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#music")).toHaveText("music: on");
  await expect(page.locator("#sounds")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#sounds")).toHaveText("sounds: on");
  // the jail holds still under the sheet, the tune does not
  const { steps } = await sound(page);
  await expect.poll(() => sound(page).then((s) => s.steps)).toBeGreaterThan(steps + 2);
  expect((await audio(page)).made).toBe(1);
});

test("a finger going down does not ask for sound, since no browser would give it; everything else does", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch" })));
  await page.evaluate(() => dispatchEvent(new PointerEvent("pointerdown", { pointerType: "pen" })));
  await page.waitForTimeout(100);
  expect((await audio(page)).made).toBe(0);
  const asks = [
    () => dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse" })),
    () => dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch" })),
    () => dispatchEvent(new Event("touchend")),
    () => dispatchEvent(new MouseEvent("click")),
    () => dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })),
  ];
  for (const ask of asks) {
    await page.reload();
    expect((await audio(page)).made, String(ask)).toBe(0);
    await page.evaluate(ask);
    await expect.poll(() => audio(page), String(ask)).toMatchObject({ made: 1, state: "running" });
  }
});

test("with sounds alone a check-in at the desk is heard and no tune plays; sounds off, and nothing more is", async ({ page }) => {
  await keep(page, { music: false, sfx: true });
  await page.goto("/");
  const s0 = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  const first = queued(s0).map((a) => a.id);
  await walkTo(page, CORRIDOR);
  await walkTo(page, DESK);
  await untilSim(page, (s) => first.every((id) => byId(s, id)?.state === "ready"), 5, "the first three checked in");
  const heard = await sound(page);
  const dressed = inmates(await state(page)).filter((a) => a.tags.includes("uniform")).length;
  expect(heard).toMatchObject({ music: false, sfx: true, state: "running", tune: false, steps: 0 });
  // heard once for each, or less when two came inside a tenth of a second: never more than there were
  expect(heard.cues.checkin).toBeGreaterThanOrEqual(1);
  expect(heard.cues.checkin).toBeLessThanOrEqual(dressed);
  expect((await audio(page)).starts).toBeGreaterThan(0);

  await page.click("#about");
  await page.click("#sounds");
  await expect(page.locator("#sounds")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#sounds")).toHaveText("sounds: off");
  expect(await audio(page)).toMatchObject({ state: "suspended", suspends: 1 });
  const quiet = await sound(page), starts = (await audio(page)).starts;
  await page.click("#close");
  await walkTo(page, OUT);
  await untilSim(page, (s) => line(s).length === 2, 3, "two to follow");
  expect((await sound(page)).cues).toEqual(quiet.cues);
  expect((await audio(page)).starts).toBe(starts);
});

test("both switches off survive a reload and make no audio at all; each one on again is heard", async ({ page }) => {
  await page.goto("/");
  await tapJail(page);
  await expect.poll(() => sound(page).then((s) => s.tune)).toBe(true);
  await page.click("#about");
  await page.click("#music");
  await expect(page.locator("#music")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#music")).toHaveText("music: off");
  expect(await sound(page)).toMatchObject({ music: false, sfx: true, state: "running", tune: false });
  expect(await kept(page)).toEqual({ music: false, sfx: true });
  const { steps } = await sound(page);
  await page.waitForTimeout(400);
  expect((await sound(page)).steps).toBe(steps);
  await page.click("#sounds");
  expect(await audio(page)).toMatchObject({ state: "suspended", suspends: 1 });
  expect(await kept(page)).toEqual({ music: false, sfx: false });

  await page.reload();
  await page.click("#about");
  await expect(page.locator("#music")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#sounds")).toHaveAttribute("aria-checked", "false");
  await page.click("#close");
  await tapJail(page);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  expect(await audio(page)).toMatchObject({ made: 0, starts: 0 });

  // sounds on says so with a coin, and still no tune
  await page.click("#about");
  await page.click("#sounds");
  await expect.poll(() => sound(page).then((s) => s.cues.coin)).toBe(1);
  expect(await sound(page)).toMatchObject({ music: false, sfx: true, state: "running", tune: false, steps: 0 });
  expect(await audio(page)).toMatchObject({ made: 1 });
  expect(await kept(page)).toEqual({ music: false, sfx: true });
  await page.click("#music");
  await expect.poll(() => sound(page).then((s) => s.steps)).toBeGreaterThan(0);
  expect(await sound(page)).toMatchObject({ music: true, tune: true });
  expect(await kept(page)).toEqual({ music: true, sfx: true });
  expect((await audio(page)).made).toBe(1);
});

test("music alone plays the tune and no cue, from a reload on", async ({ page }) => {
  await keep(page, { music: true, sfx: false });
  await page.goto("/");
  await tapJail(page);
  await expect.poll(() => sound(page).then((s) => s.steps)).toBeGreaterThan(2);
  await page.click("#about");
  await expect(page.locator("#music")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#sounds")).toHaveAttribute("aria-checked", "false");
  await page.click("#close");
  // the bus pulls in and three walk to the desk: a ride and more to hear, were sounds on
  await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  expect(await sound(page)).toMatchObject({ music: true, sfx: false, tune: true, cues: {} });
});

test("a hidden page goes quiet at once and picks up on return; so does a page left and come back to", async ({ page }) => {
  await page.goto("/");
  await tapJail(page);
  await expect.poll(() => sound(page).then((s) => s.tune)).toBe(true);
  await setHidden(page, true);
  expect(await audio(page)).toMatchObject({ state: "suspended", suspends: 1 });
  expect((await sound(page)).tune).toBe(false);
  await setHidden(page, false);
  await expect.poll(() => sound(page).then((s) => s.tune)).toBe(true);
  expect((await audio(page)).state).toBe("running");
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  expect(await audio(page)).toMatchObject({ state: "suspended", suspends: 2 });
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => sound(page).then((s) => s.tune)).toBe(true);
  expect(await audio(page)).toMatchObject({ made: 1, state: "running" });
});

test("the tune takes on its alarm while there is a squabble, and drops it once the warden calms it", async ({ page }) => {
  await page.goto("/");
  await untilSim(page, (s) => s.steps > 5, 1, "the game to start");
  expect((await sound(page)).trouble).toBe(false);
  const world = await state(page);
  // the same jail, saved with a squabble right where the warden stands
  const { x, y } = world.agents[0];
  await page.addInitScript((save) => {
    // an old save, on a device with no map yet: it is moved over as the page opens
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", save);
  }, JSON.stringify({ ...world, alert: { x, y, ids: [], held: 0 } }));
  await page.reload();
  await untilSim(page, (s) => s.steps > world.steps + 2 && s.alert !== null, 1, "the squabble to be on");
  expect((await sound(page)).trouble).toBe(true);
  await untilSim(page, (s) => s.alert === null && s.settled > world.settled, 10, "the warden to calm it");
  await expect.poll(() => sound(page).then((s) => s.trouble)).toBe(false);
});

test("the tune hurries while the skates are on", async ({ page }) => {
  await page.goto("/");
  await untilSim(page, (s) => s.steps > 5, 1, "the game to start");
  expect((await sound(page)).pace).toBe(1);
  const world = await state(page);
  // the same jail, saved with a minute of skates still to run
  await page.addInitScript((save) => {
    // an old save, on a device with no map yet: it is moved over as the page opens
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", save);
  }, JSON.stringify({ ...world, boosted: 60 }));
  await page.reload();
  await untilSim(page, (s) => s.steps > world.steps + 5 && s.boosted > 0, 1, "the skates to be on");
  expect((await sound(page)).pace).toBe(1.12);
});
