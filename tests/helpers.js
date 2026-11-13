// helpers that wait on the game, not the wall clock. a hosted runner with no gpu
// draws slowly and the game caps each frame at a quarter second, so game time
// can run at a third of wall time there: deadlines here are in game seconds.
export const state = (page) => page.evaluate(() => window.__jailbirds.state());
export const me = async (page) => (await state(page)).agents[0];
export const inmates = (s) => s.agents.filter((a) => a.kind === "agent");
export const byId = (s, id) => s.agents.find((a) => a.id === id);
export const queued = (s) => inmates(s).filter((a) => a.state === "queue");
export const line = (s) => s.agents.filter((a) => a.leader === s.agents[0].id && a.state === "follow");

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

/** walk the warden to a point in a straight line with the thumb stick, pushing less
 * the closer it gets, so one slow frame can never carry it past the spot. `stop` ends
 * the walk early once the game says so (something that may hold the jail still on the way) */
export async function walkTo(page, to, near = 4, stop = () => false) {
  const box = await page.locator("#jail").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const turn = await page.evaluate(() => window.__jailbirds.camera().turn);
  const angle = turn * Math.PI / 180, c = Math.cos(angle), sn = Math.sin(angle);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  try {
    let start = null;
    for (;;) {
      const s = await state(page), p = s.agents[0];
      const dx = to.x - p.x, dy = to.y - p.y, d = Math.hypot(dx, dy);
      if (d < near || stop(s)) return p;
      start ??= s.steps;
      if (s.steps - start > 60 * 30) throw new Error(`the warden never reached ${to.x},${to.y}: stuck at ${Math.round(p.x)},${Math.round(p.y)}`);
      // a frame is at most a quarter second: cover at most half the gap in one
      const push = Math.min(1, d / (s.speed * 0.25 * 2));
      const r = Math.max(4, push * 44);
      // the target is in world space; the thumb gesture is in screen space
      await page.mouse.move(cx + ((dx * c - dy * sn) / d) * r, cy + ((dx * sn + dy * c) / d) * r);
      await page.waitForTimeout(30);
    }
  } finally {
    await page.mouse.up();
  }
}
