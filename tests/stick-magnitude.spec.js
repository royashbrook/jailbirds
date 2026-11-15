import { test, expect } from './fixtures.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { cameraStick } from '../src/view/camera.ts';
import { pointerOffset, state, waitSim } from './helpers.js';

test.use({ viewport: { width: 390, height: 664 } });

test('every fine native vector really clears the engine deadzone', async ({ page, browserName }) => {
  const w=create(LEVELS,0,17);
  w.ride={state:'away',x:-100,t:1e9};w.fightIn=w.boost.t=1e9;
  // Clear ground, away from walls, boosts and purchase pads. Opposite pairs
  // keep the measurement near this point without changing the running world.
  Object.assign(w.agents[0],{x:800,y:700});
  await page.addInitScript(raw=>localStorage.setItem('jailbirds:save',raw),JSON.stringify(w));
  await page.goto('/');
  const box=await page.locator('#jail').boundingBox();
  const cx=Math.round(box.x+box.width/2),cy=Math.round(box.y+box.height/2);
  const turn=await page.evaluate(()=>window.__jailbirds.camera().turn),samples=[];
  await page.mouse.move(cx,cy);await page.mouse.down();
  try {
    for(const [x,y] of [[2,1],[-2,-1],[2,-1],[-2,1],[1,2],[-1,-2],[1,-2],[-1,2]]) {
      const world=cameraStick({x,y},turn),offset=pointerOffset(world.x,world.y,turn,.5);
      expect(offset).toEqual({x,y});
      await page.mouse.move(cx+offset.x,cy+offset.y);
      // Both snapshots are taken after native delivery and while still held.
      // Neutral command/reply time is not included in the speed inference.
      const from=await state(page);await waitSim(page,.2);const to=await state(page);
      const a=from.agents[0],b=to.agents[0],seconds=(to.steps-from.steps)/60;
      const magnitude=Math.hypot(b.x-a.x,b.y-a.y)/(seconds*from.speed);
      expect(seconds).toBeGreaterThan(0);
      expect(b.moving).toBe(true);
      expect(magnitude,`${x},${y} must not fall into the 0.05 deadzone`).toBeGreaterThan(.05);
      expect(magnitude).toBeCloseTo(Math.sqrt(5)/44,5);
      samples.push({x,y,magnitude});
      await page.mouse.move(cx,cy);
    }
  } finally {
    await page.mouse.up();
  }
  console.log('[native-stick]',browserName,JSON.stringify(samples));
});
