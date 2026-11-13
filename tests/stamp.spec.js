import { test, expect } from "./fixtures.js";
import { queued, untilSim } from "./helpers.js";

// the way out at the release desk, on the page: someone set free walks up to the desk, the big
// stamp lifts off its ink pad, comes down on their papers and leaves a red mark, and goes back.
// the page writes down where the drawn stamp is every frame, through the read-only window onto
// the game, and the test reads that, never racing the clock
const STAMP = { x: 600, y: 704 };
/** where the stamp comes down: three quarters along the release desk (the desk is 540 to 660) */
const PAPERS = 630;

function record() {
  const log = (window.__stamp = []);
  const look = () => {
    const j = window.__jailbirds;
    const s = j?.drawn().stamp;
    if (s && log.length < 4000) log.push({ steps: j.state().steps, ...s });
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

test("a release shows the stamp lift, come down on their papers with a red mark, and go back", async ({ page }) => {
  await page.addInitScript(record);
  await page.goto("/");
  const world = await untilSim(page, (s) => queued(s).length === 3, 20, "the first bus to queue up");
  // one who has served their time, in line just behind the warden at the release desk
  const [done, ...rest] = world.agents.slice(1);
  const led = { ...done, state: "follow", leader: world.agents[0].id, house: "c0", slot: 0, served: 999, x: STAMP.x - 30, y: STAMP.y, path: [] };
  const save = { ...world, agents: [{ ...world.agents[0], ...STAMP }, led, ...rest] };
  await page.addInitScript((raw) => {
    // an old save, on a device with no map yet: it is moved over as the page opens
    localStorage.removeItem("jailbirds:map");
    localStorage.setItem("jailbirds:save", raw);
  }, JSON.stringify(save));
  await page.reload();
  await untilSim(page, (s) => s.released === 1, 3, "the release");
  await untilSim(page, (s) => !s.agents.some((a) => a.id === led.id), 20, "them to walk out");

  // from the first frame drawn: until then the stamp has not been put anywhere
  const log = (await page.evaluate(() => window.__stamp)).filter((s) => s.x !== 0);
  expect(log.length).toBeGreaterThan(10);
  // before anyone stands at the desk it waits on its pad, with no papers out
  const restY = log[0].y;
  expect(log[0]).toMatchObject({ sheet: false, mark: false });
  expect(log[0].x).toBeLessThan(PAPERS - 20);
  // it goes up, then comes down on the papers, which then carry the mark
  const up = log.findIndex((s) => s.y > restY + 8);
  expect(up).toBeGreaterThan(0);
  const down = log.findIndex((s, i) => i > up && s.mark && Math.abs(s.y - restY) < 0.5 && Math.abs(s.x - PAPERS) < 1);
  expect(down).toBeGreaterThan(up);
  expect(log.slice(0, down).some((s) => s.mark)).toBe(false);
  // and back on its pad once they have gone, the papers put away
  const last = log[log.length - 1];
  expect(last).toMatchObject({ sheet: false, mark: false });
  expect(Math.abs(last.y - restY)).toBeLessThan(0.5);
  expect(last.x).toBeLessThan(PAPERS - 20);
  // nothing paid twice for it
  const after = await page.evaluate(() => window.__jailbirds.state());
  expect(after.released).toBe(1);
  expect(after.piles.stamp).toBe((world.piles.stamp ?? 0) + 10);
});
