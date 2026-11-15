import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create, step, player, restore, DT, route, isOpen } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { walls, dist } from '../src/engine/geom.ts';

const still={x:0,y:0};
const lv=w=>LEVELS[w.level];
const station=(w,id)=>lv(w).stations.find(s=>s.id===id);
const wait=(w,n)=>{for(let i=0;i<Math.round(n/DT);i++) step(w,LEVELS,still);};
const saved=JSON.parse(readFileSync(new URL('./fixtures/v0.1.155-maxed-pine-hill.json',import.meta.url)));
const sample=saved.agents.find(a=>a.kind==='agent');
function quiet(n=0){const w=create(LEVELS,n,37);w.ride.t=w.fightIn=w.boost.t=1e9;return w;}
function resident(w,changes={}){
 const h=station(w,'c0');
 const a={...structuredClone(sample),id:w.nextId++,x:h.seats[0].at.x,y:h.seats[0].at.y,state:'home',house:'c0',slot:0,
  leader:-1,station:'',seat:-1,path:[],trail:[],needs:{food:1,wash:1,toilet:1},unrest:0,served:20,hurt:0,rest:0,t:0,carry:0,cash:0,...changes};
 w.agents.push(a);return a;
}
const elapsedUse=(w,a,seconds)=>{let n=0;while(a.state==='use'&&n*DT<seconds){step(w,LEVELS,still);n++;}return n*DT;};

for(let level=0;level<2;level++){
 test(`jail${level+1}: 22 room purchases with stable prerequisites`,()=>{
  const l=LEVELS[level],p=l.pads.filter(p=>/tier[23]$|^(kitchen|canteen|wash)[23]$/.test(p.id));
  assert.equal(p.length,22);
  assert.equal(p.reduce((s,p)=>s+p.cost,0),1800*(level+1));
  for(let i=0;i<8;i++){
   const id=`cell${i+1}tier`,a=l.pads.find(p=>p.id===id+'2'),b=l.pads.find(p=>p.id===id+'3');
   assert.equal(a.after,i>=2?`cell${i+1}`:undefined);assert.equal(b.after,a.id);
   assert.equal(a.rank,4);assert.equal(b.rank,7);
  }
 });
 for(const [pads,rate] of [[[],1],[['cell1tier2'],1.15],[['cell1tier2','cell1tier3'],1.3]]){
  for(const hurt of [0,20]) test(`jail${level+1}: home served ${rate}x with bump ${hurt}`,()=>{
   const w=quiet(level);w.bought=[...pads];const a=resident(w,{hurt});
   wait(w,1);
   assert.ok(Math.abs(a.served-(20+rate))<1e-8);
   assert.ok(Math.abs(a.hurt-Math.max(0,hurt-1))<1e-8);
   assert.equal(w.coins,0);
  });
 }
 test(`jail${level+1}: cell upgrades leave care at 1x`,()=>{
  const w=quiet(level);w.bought=['hospital','cell1tier2','cell1tier3'];
  const s=station(w,'hospital'),a=resident(w,{state:'use',station:'hospital',seat:0,x:s.seats[0].at.x,y:s.seats[0].at.y,hurt:20});
  const back=restore(JSON.stringify(w),LEVELS),r=back.agents.find(x=>x.id===a.id);
  assert.equal(r.served,20);
  wait(back,1);assert.ok(Math.abs(r.served-21)<1e-8);assert.ok(Math.abs(r.hurt-17.5)<1e-8);
 });
 test(`jail${level+1}: buying comfier beds changes future increments, not past service`,()=>{
  const w=quiet(level),pad=lv(w).pads.find(p=>p.id==='cell1tier2'),a=resident(w);
  w.rank=4;w.coins=pad.cost;Object.assign(player(w),pad.at);
  let ticks=0;
  while(!w.bought.includes(pad.id)&&ticks++<180){
   const before=a.served;step(w,LEVELS,still);
   // The engine takes payment before advancing residents in this same step.
   const rate=w.bought.includes(pad.id)?1.15:1;
   assert.ok(Math.abs(a.served-before-rate*DT)<1e-8,'only this step of service changes, no retroactive jump');
  }
  assert.ok(w.bought.includes(pad.id));
  const before=a.served;step(w,LEVELS,still);
  assert.ok(Math.abs(a.served-before-1.15*DT)<1e-8,'new rate on future work');
 });
 test(`jail${level+1}: each paid room stage survives a partial-save purchase without paying its successor`,()=>{
  const l=LEVELS[level],tier=p=>/tier[23]$|^(kitchen|canteen|wash)[23]$/.test(p.id);
  for(const p of l.pads.filter(tier)){
   const w=quiet(level);w.rank=10;w.coins=1;
   w.bought=l.pads.filter(p=>!tier(p)).map(p=>p.id);
   if(p.after&&!w.bought.includes(p.after))w.bought.push(p.after);
   w.paid[p.id]=p.cost-1;
   const back=restore(JSON.stringify(w),LEVELS);
   assert.equal(back.paid[p.id],p.cost-1);
   Object.assign(player(back),p.at);wait(back,2);
   assert.equal(back.coins,0,p.id);assert.ok(back.bought.includes(p.id),p.id);
   assert.equal(back.paid[p.id],p.cost);
   const successor=l.pads.find(q=>q.after===p.id);
   if(successor)assert.ok(!back.bought.includes(successor.id));
   assert.ok(restore(JSON.stringify(back),LEVELS).bought.includes(p.id));
  }
 });
 test(`jail${level+1}: furnishing cell one never accelerates cell two`,()=>{
  const w=quiet(level);w.bought=['cell1tier2','cell1tier3'];
  const h=station(w,'c1'),a=resident(w,{house:'c1',x:h.seats[0].at.x,y:h.seats[0].at.y});
  wait(w,1);assert.ok(Math.abs(a.served-21)<1e-8);
 });
 test(`jail${level+1}: cell tiers do not serve someone walking or following`,()=>{
  for(const state of ['follow','go']){
   const w=quiet(level);w.bought=['cell1tier2','cell1tier3'];
   const a=resident(w,{state,leader:player(w).id,station:'showers',seat:0,path:[{x:545,y:600}]});
   wait(w,1);assert.equal(a.served,20);
  }
 });
 for(const [pads,every] of [[[],.3],[['kitchen2'],.24],[['kitchen2','kitchen3'],.18]]) test(`jail${level+1}: tray fill every ${every}s`,()=>{
  const w=quiet(level);w.bought=[...pads];const s=station(w,'stove');Object.assign(player(w),s.at);
  let ticks=0;while(player(w).carry<1&&ticks<60){step(w,LEVELS,still);ticks++;}
  assert.ok(ticks*DT>=every-1e-8&&ticks*DT<=every+DT+1e-8,`fill took ${ticks*DT}`);
 });
 for(const [pads,every] of [[[],.3],[['kitchen2'],.24],[['kitchen2','kitchen3'],.18]]) test(`jail${level+1}: hired cook fills at the same ${every}s stove rate`,()=>{
  const w=quiet(level),st=station(w,'stove');w.bought=['cook',...pads];
  const cook={...structuredClone(saved.agents.find(a=>a.kind==='carrier')),id:w.nextId++,x:st.at.x,y:st.at.y,carry:0,path:[],trail:[]};
  w.agents.push(cook);
  let ticks=0;while(cook.carry<1&&ticks<60){step(w,LEVELS,still);ticks++;}
  assert.equal(cook.carry,1);
  assert.ok(ticks*DT>=every-1e-8&&ticks*DT<=every+DT+1e-8,`cook fill took ${ticks*DT}`);
 });
 for(const [id,prefix,base,two,three] of [['table1','canteen',1.5,1.2,.9],['table2','canteen',1.5,1.2,.9],['showers','wash',2.5,2,1.5]]){
  for(const [pads,duration] of [[[],base],[[prefix+'2'],two],[[prefix+'2',prefix+'3'],three]]) test(`jail${level+1}: ${id} use ${duration}s frees the same seat`,()=>{
   const w=quiet(level);w.bought=['table2','shower2','shower3',...pads];const s=station(w,id);
   const a=resident(w,{state:'use',station:id,seat:0,x:s.seats[0].at.x,y:s.seats[0].at.y,carry:id==='showers'?0:1});
   const used=elapsedUse(w,a,4);
   assert.ok(used>=duration-1e-8&&used<=duration+DT+1e-8,`use took ${used}`);
   assert.equal(a.state,'back');assert.equal(a.station,'');assert.equal(a.seat,-1);
  });
 }
 test(`jail${level+1}: every room payment point is reached without crossing a wall`,()=>{
  const l=LEVELS[level],targets=l.pads.filter(p=>/tier2$|^(kitchen|canteen|wash)2$/.test(p.id));
  assert.equal(targets.length,11);
  for(const target of targets){
   const w=quiet(level);w.bought=l.pads.filter(p=>!targets.includes(p)).map(p=>p.id);
   const p=player(w),ws=walls(l,r=>isOpen(w,r.locked)),path=route(w,l,p,target.at);
   for(let i=0;i<3600&&path.length;i++){
    while(path.length&&dist(p,path[0])<.1)path.shift();if(!path.length)break;
    const t=path[0],d=Math.max(dist(p,t),w.speed*DT);step(w,LEVELS,{x:(t.x-p.x)/d,y:(t.y-p.y)/d});
    for(const r of ws)assert.ok(Math.hypot(p.x-Math.max(r.x,Math.min(p.x,r.x+r.w)),p.y-Math.max(r.y,Math.min(p.y,r.y+r.h)))>=10-1e-6);
   }
   assert.ok(dist(p,target.at)<.1,target.id);
  }
 });
 test(`jail${level+1}: closest manual calming points never pay the middle cell pads`,()=>{
  const l=LEVELS[level];
  for(const id of ['cell4tier2','cell5tier2']){
   const target=l.pads.find(p=>p.id===id);assert.ok(target);
   const w=quiet(level);w.rank=10;w.coins=100;w.bought=l.pads.filter(p=>p.id!==id&&!p.id.endsWith('tier3')).map(p=>p.id);
   const d=dist(target.at,l.riot.at);
   for(const [house,slot] of [['c0',0],['c0',1],['c1',0]]){
    const h=station(w,house);
    resident(w,{house,slot,x:h.seats[slot].at.x,y:h.seats[slot].at.y,unrest:.9,rest:10});
   }
   w.fightIn=0;step(w,LEVELS,still);assert.equal(w.alert?.kind,'riot');
   // Stay just inside reach so a rounding bit at exactly40 cannot turn a calming probe into an idle one.
   Object.assign(player(w),{x:l.riot.at.x+(target.at.x-l.riot.at.x)*39.99/d,y:l.riot.at.y+(target.at.y-l.riot.at.y)*39.99/d});
   wait(w,9);assert.equal(w.settled,1);assert.equal(w.alert,null);
   assert.ok(w.coins>=100);assert.equal(w.paid[id]??0,0);assert.ok(!w.bought.includes(id));
  }
 });
 for(let cell=0;cell<8;cell++) test(`jail${level+1}: calming cell${cell+1}'s squabble never pays its furnishing pad`,()=>{
  const l=LEVELS[level],w=quiet(level),h=station(w,`c${cell}`);
  const id=`cell${cell+1}tier2`,target=l.pads.find(p=>p.id===id);
  w.rank=10;w.coins=500;
  w.bought=l.pads.filter(p=>!/tier[23]$|^(kitchen|canteen|wash)[23]$/.test(p.id)).map(p=>p.id);
  const pair=[0,1].map(slot=>resident(w,{house:h.id,slot,state:'fight',x:h.at.x+slot*8,y:h.at.y}));
  w.alert={kind:'squabble',x:h.at.x,y:h.at.y,ids:pair.map(a=>a.id),held:0,warn:0};
  const d=dist(target.at,h.at);
  // Vertical integer edges are exact: increasing PAD_R24 to25 must not hide
  // a tangent payment behind the 0.01 inset used for irrational diagonal edges.
  const reach=target.at.x===h.at.x?40:39.99;
  Object.assign(player(w),{x:h.at.x+(target.at.x-h.at.x)*reach/d,y:h.at.y+(target.at.y-h.at.y)*reach/d});
  wait(w,l.fights.settle+.3);
  assert.equal(w.settled,1);assert.equal(w.alert,null);
  assert.equal(w.paid[id]??0,0,id);assert.ok(!w.bought.includes(id),id);
  assert.ok(w.coins>=500,'calming reward kept, no payment taken');
 });
}
