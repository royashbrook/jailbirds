// helpers that wait on the game, not the wall clock. a hosted runner with no gpu
// draws slowly and the game caps each frame at a quarter second, so game time
// can run at a third of wall time there: deadlines here are in game seconds.
export const state = (page) => page.evaluate(() => window.__jailbirds.state());
export const me = async (page) => (await state(page)).agents[0];
export const inmates = (s) => s.agents.filter((a) => a.kind === "agent");
export const byId = (s, id) => s.agents.find((a) => a.id === id);
export const queued = (s) => inmates(s).filter((a) => a.state === "queue");
export const line = (s) => s.agents.filter((a) => a.leader === s.agents[0].id && a.state === "follow");

/** a squabble at `at` the way an old save holds one: two residents of the first cell squabbling, and
 * the alert naming them. a saved squabble that names nobody squabbling is dropped as it loads, so a
 * test that wants one on screen seeds both. gives the save's new nextId, alert and everyone but the
 * player */
export function squabbleAt(world, at) {
  const id = world.nextId;
  const fighter = (slot) => ({
    id: id + slot, kind: "agent", x: 67, y: 184, face: 1, moving: false, walk: 0, look: slot, tags: ["uniform"], state: "fight",
    leader: -1, house: "c0", slot, station: "", seat: -1, needs: { food: 1, wash: 1, toilet: 1 }, unrest: 0, served: 0,
    rest: 0, t: 0, carry: 0, cash: 0, path: [], trail: [],
  });
  return {
    nextId: id + 2,
    alert: { x: at.x, y: at.y, ids: [id, id + 1], held: 0 },
    others: [...world.agents.slice(1).filter((a) => a.house !== "c0"), fighter(0), fighter(1)],
  };
}

/** poll until the game says yes; fail once `seconds` of game time pass without it */
export async function untilSim(page, ok, seconds, what) {
  let start = null;
  for (;;) {
    const s = await state(page);
    if (ok(s)) return s;
    start ??= s.steps;
    if (s.steps - start > seconds * 60) throw new Error(`after ${seconds}s of game time, still waiting for ${what}`);
    await page.waitForTimeout(50);
  }
}
/** let this much game time pass */
export const waitSim = async (page, seconds) => {
  const from = (await state(page)).steps;
  return untilSim(page, (s) => s.steps >= from + seconds * 60, seconds + 1, `${seconds}s of game time`);
};
/** let this many frames be drawn */
export async function waitFrames(page, n) {
  const frames = () => page.evaluate(() => window.__jailbirds.drawn().frames);
  const from = await frames();
  while ((await frames()) < from + n) await page.waitForTimeout(30);
}

export function pointerOffset(dx, dy, turn, radius) {
  const d = Math.hypot(dx, dy), angle = turn * Math.PI / 180;
  const c = Math.cos(angle), sn = Math.sin(angle);
  const x = (dx * c - dy * sn) / d, y = (dx * sn + dy * c) / d;
  if (radius < 3) {
    // WebKit uses integer pixels. (2,1) is the shortest integer vector beyond
    // the 2.2px deadzone; a rounded 3px floor can keep stepping over the target.
    const sx = x < 0 ? -1 : 1, sy = y < 0 ? -1 : 1;
    return Math.abs(x) >= Math.abs(y) ? { x: sx * 2, y: sy } : { x: sx, y: sy * 2 };
  }
  // Leave rounding room below 44px: crossing the ring drags its base.
  const r = Math.min(43, radius);
  return { x: x * r, y: y * r };
}

/** seconds to hold this pulse longer, or 0. on a slow runner the shortest pulse can move further than
 * the arrival window is wide, so the warden hops across the target for ever (run 45067458177: 425.3,
 * 434.4, 425.3). when a floor pulse has just crossed it, going past by as far as he is from it now means
 * the next plain pulse, the same length back, lands on it */
export function orbitHold(last, p, to, radius, unitsPerSecond) {
  if (!last || radius >= 3) return 0;
  const crossed = (to.x - last.x) * (to.x - p.x) + (to.y - last.y) * (to.y - p.y) < 0;
  return crossed ? Math.hypot(to.x - p.x, to.y - p.y) / unitsPerSecond : 0;
}

/** walk the warden to a point in a straight line with the thumb stick, pushing less
 * the closer it gets. neutralize before reading: a delayed reply is an old position,
 * not permission to keep driving while it reaches us. `stop` ends
 * the walk early once the game says so (something that may hold the jail still on the way) */
export async function walkTo(page, to, near = 4, stop = () => false) {
  const box = await page.locator("#jail").boundingBox();
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const turn = await page.evaluate(() => window.__jailbirds.camera().turn);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  try {
    let start = null, previousStep = null, last = null;
    for (;;) {
      await page.mouse.move(cx, cy);
      const s = await state(page), p = s.agents[0];
      const dx = to.x - p.x, dy = to.y - p.y, d = Math.hypot(dx, dy);
      if (d < near || stop(s)) return p;
      start ??= s.steps;
      if (s.steps - start > 60 * 30) throw new Error(`the warden never reached ${to.x},${to.y}: stuck at ${Math.round(p.x)},${Math.round(p.y)}`);
      // Native command/reply latency can hold a pulse for over a game second. Estimate
      // the next pulse from the previous full cycle; fast feedback keeps the old horizon.
      const seconds = previousStep === null ? 0.5 : Math.max(0.5, (s.steps - previousStep) / 60);
      previousStep = s.steps;
      const push = Math.min(1, d / (s.speed * seconds));
      // the target is in world space; the thumb gesture is in screen space
      const offset = pointerOffset(dx, dy, turn, push * 44);
      await page.mouse.move(Math.round(cx + offset.x), Math.round(cy + offset.y));
      await waitFrames(page, 1);
      const hold = orbitHold(last, p, to, push * 44, (s.speed * Math.hypot(offset.x, offset.y)) / 44);
      if (hold) await page.waitForTimeout(hold * 1000);
      // a held pulse is followed by a plain one, which is the one that lands
      last = hold ? null : p;
    }
  } finally {
    await page.mouse.up();
  }
}
