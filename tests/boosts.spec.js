import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";
import { untilSim, waitFrames } from "./helpers.js";

// the three surprises, drawn: each kind on the floor, the warden riding the unicorn,
// and the fairy in flight. the page is read only, so each starts from a save: an
// old jail with the ride kept away, so nothing else comes and goes while we look
const OLD = JSON.parse(readFileSync(new URL("./fixtures/v0.1.21-save.json", import.meta.url), "utf8"));
const quiet = { ...OLD, ride: { state: "away", x: -100, t: 9999 }, fightIn: 9999 };
const drawn = (page) => page.evaluate(() => window.__jailbirds.drawn());

async function open(page, save) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // the save goes in before the page reads it; a later reopen hands the next one over the same way,
  // after the page going away has saved its own
  await page.addInitScript((first) => {
    const next = sessionStorage.getItem("jb:next") ?? (sessionStorage.getItem("jb:went") ? null : first);
    sessionStorage.setItem("jb:went", "1");
    sessionStorage.removeItem("jb:next");
    // an old save, on a device with no map yet: it is moved over as the page opens
    if (next) {
      localStorage.removeItem("jailbirds:map");
      localStorage.setItem("jailbirds:save", next);
    }
  }, JSON.stringify(save));
  await page.goto("/");
  await waitFrames(page, 6);
  return errors;
}
async function reopen(page, save) {
  await page.evaluate((s) => sessionStorage.setItem("jb:next", s), JSON.stringify(save));
  await page.reload();
  await waitFrames(page, 6);
}

test("each surprise on the floor is drawn, and adds to what is drawn", async ({ page }) => {
  const errors = await open(page, quiet);
  const plain = (await drawn(page)).triangles;
  for (const kind of ["skates", "unicorn", "fairy"]) {
    // one boost lying a little way off the warden, so he does not pick it up
    await reopen(page, { ...quiet, boost: { x: 470, y: 520, here: true, t: 0 }, boostKind: kind });
    const s = await page.evaluate(() => window.__jailbirds.state());
    expect(s.boost.here).toBe(true);
    expect(s.boostKind).toBe(kind);
    expect((await drawn(page)).triangles, kind).toBeGreaterThan(plain);
  }
  expect(errors).toEqual([]);
});

test("the warden rides the unicorn, up on her saddle, and gets down when the ride is over", async ({ page }) => {
  const errors = await open(page, quiet);
  const plain = await drawn(page);
  const standing = await page.evaluate(() => window.__jailbirds.warden());
  await reopen(page, { ...quiet, boosted: 8, mountKind: "unicorn" });
  expect((await page.evaluate(() => window.__jailbirds.state())).mountKind).toBe("unicorn");
  expect((await drawn(page)).triangles).toBeGreaterThan(plain.triangles);
  // up off the floor, and the camera comes up with him: he sits where a standing warden would
  const riding = await page.evaluate(() => window.__jailbirds.warden());
  expect(riding.on).toBe(true);
  expect(Math.abs(riding.y - standing.y)).toBeLessThan(3);
  await untilSim(page, (s) => s.boosted === 0, 10, "the ride to end");
  await waitFrames(page, 3);
  expect((await drawn(page)).triangles).toBe(plain.triangles);
  expect(errors).toEqual([]);
});

test("a phone on its side, zoomed right in and low: the rider stays as far in frame as a standing warden", async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 });
  await page.addInitScript(() => localStorage.setItem("jailbirds:camera", JSON.stringify({ zoom: 3, turn: 180, tilt: 15 })));
  await open(page, quiet);
  const standing = await page.evaluate(() => window.__jailbirds.warden());
  // a ride long enough that a slow machine still looks while he is up there
  await reopen(page, { ...quiet, boosted: 8, mountKind: "unicorn" });
  const off = () => page.evaluate((y) => {
    const j = window.__jailbirds, at = j.warden();
    return { on: at.on, riding: j.state().boosted > 0, off: Math.abs(at.y - y) };
  }, standing.y);
  await expect.poll(async () => { const o = await off(); return o.riding && o.on && o.off < 3; }, { timeout: 4000 }).toBe(true);
  // and when he gets down, the camera comes back down with him
  await untilSim(page, (s) => s.boosted === 0, 10, "the ride to end");
  await expect.poll(async () => { const o = await off(); return o.on && o.off < 3; }, { timeout: 4000 }).toBe(true);
  expect(await page.evaluate(() => window.__jailbirds.camera())).toEqual({ zoom: 3, turn: 180, tilt: 15 });
});

test("the fairy flies to a mess, cleans it and is gone", async ({ page }) => {
  const mess = { id: 50, kind: "puddle", x: 470, y: 520, station: "showers", seat: 0, clean: 0 };
  const fairy = { todo: [], visits: 0, x: 330, y: 540, target: 50, t: 0 };
  const errors = await open(page, { ...quiet, nextId: 51, messes: [mess], fairy });
  const flying = await page.evaluate(() => window.__jailbirds.state());
  expect(flying.fairy.target === 50 || flying.messes.length === 0).toBe(true);
  const s = await untilSim(page, (s) => s.fairy.target === null, 3, "the fairy to finish");
  expect(s.messes).toEqual([]);
  expect(s.fairy.visits).toBe(1);
  await waitFrames(page, 3);
  expect(errors).toEqual([]);
});

test("picking up a surprise says what it was: skates, the unicorn, or the fairy", async ({ page }) => {
  const errors = await open(page, quiet);
  const me = (await page.evaluate(() => window.__jailbirds.state())).agents[0];
  const words = { skates: "skates! zoom!", unicorn: "unicorn ride!", fairy: "here comes the fairy!" };
  for (const kind of ["skates", "unicorn", "fairy"]) {
    // the surprise right under the warden; the fairy needs a mess to come for
    const messes = kind === "fairy" ? [{ id: 50, kind: "puddle", x: 470, y: 520, station: "showers", seat: 0, clean: 0 }] : [];
    await reopen(page, { ...quiet, messes, boost: { x: me.x, y: me.y, here: true, t: 0 }, boostKind: kind });
    await expect(page.locator(".cheer")).toHaveText(words[kind]);
  }
  expect(errors).toEqual([]);
});
