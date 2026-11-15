import { test, expect } from './fixtures.js';
import { waitFrames, untilSim } from './helpers.js';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { pegs } from '../src/skins/pegs.ts';
import { roomTierPieces } from '../src/view/scene.ts';

const roomPad=p=>/tier[23]$|^(kitchen|canteen|wash)[23]$/.test(p.id);
async function seed(page,w){
  await page.addInitScript(raw=>{
    if(sessionStorage.getItem('room-tiers:seeded'))return;
    sessionStorage.setItem('room-tiers:seeded','yes');
    localStorage.removeItem('jailbirds:map');localStorage.setItem('jailbirds:save',raw);
  },JSON.stringify(w));
  await page.goto('/');
  await waitFrames(page,20);
  const later=page.getByRole('button',{name:'later',exact:true});
  if(await later.isVisible())await later.click();
  await expect.poll(()=>page.evaluate(()=>window.__jailbirds.drawn().frames)).toBeGreaterThan(5);
}

test('room furnishings are really drawn at each stage, with bounded resource cost',async({browser,browserName},info)=>{
  const l=LEVELS[0],records=[];
  for(const stage of [1,2,3]){
    const ctx=await browser.newContext({...info.project.use,baseURL:info.project.use.baseURL});
    try{
      const page=await ctx.newPage(),w=create(LEVELS,0,37);
      w.rank=10;w.ride.t=w.fightIn=w.boost.t=1e9;
      w.bought=l.pads.filter(p=>!roomPad(p)||(stage>=2&&p.id.endsWith('2'))||(stage===3&&p.id.endsWith('3'))).map(p=>p.id);
      Object.assign(w.agents[0],{x:330,y:540});
      await seed(page,w);
      const actual=await page.evaluate(()=>window.__jailbirds.drawn());
      const expected=roomTierPieces(l,w,pegs.palette(false)).length;
      expect(actual.tiers).toBe(expected);
      records.push({stage,boxes:actual.tiers,calls:actual.calls,triangles:actual.triangles,geometries:actual.geometries,textures:actual.textures});
      await page.screenshot({path:info.outputPath(`room-stage-${stage}-${browserName}.png`)});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }finally{await ctx.close();}
  }
  expect(records[0].boxes).toBe(0);
  expect(records[2].boxes).toBeGreaterThan(records[1].boxes);
  expect(records[2].calls).toBeLessThanOrEqual(records[0].calls+4);
  expect(records[2].geometries).toBeLessThanOrEqual(records[0].geometries);
  expect(records[2].triangles-records[0].triangles).toBeLessThanOrEqual(3000);
  console.log('[room-tiers]',browserName,JSON.stringify(records));
});

test('a real room payment changes its capability and reload keeps the purchase',async({page})=>{
  const l=LEVELS[0],p=l.pads.find(p=>p.id==='cell1tier2'),w=create(LEVELS,0,37);
  w.rank=4;w.coins=p.cost;w.ride.t=w.fightIn=w.boost.t=1e9;
  Object.assign(w.agents[0],p.at);
  await seed(page,w);
  const bought=await untilSim(page,s=>s.bought.includes(p.id),5,'cell furnishing purchase');
  expect(bought.coins).toBe(0);
  expect(bought.paid[p.id]).toBe(p.cost);
  expect(await page.evaluate(()=>window.__jailbirds.drawn().tiers)).toBeGreaterThan(0);
  await page.reload();
  await waitFrames(page,10);
  expect((await page.evaluate(()=>window.__jailbirds.state())).bought).toContain(p.id);
  expect(await page.evaluate(()=>window.__jailbirds.drawn().tiers)).toBeGreaterThan(0);
});
