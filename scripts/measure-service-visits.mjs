import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const repo=resolve(process.argv[2]),mode=process.argv[3],setups=resolve(process.argv[4]);
assert.ok(['base','facilities','rooms'].includes(mode), 'mode is base, facilities or rooms');
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const dirty=!!execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim();
const runtime=Object.fromEntries(['sim.ts','types.ts','geom.ts','rng.ts'].map(p=>[p,createHash('sha256').update(fs.readFileSync(resolve(repo,'src/engine',p))).digest('hex')]));
runtime.content=createHash('sha256').update(fs.readFileSync(resolve(repo,'src/content/jail.ts'))).digest('hex');
const {restore,step,DT}=await import(pathToFileURL(resolve(repo,'src/engine/sim.ts')));
const {LEVELS}=await import(pathToFileURL(resolve(repo,'src/content/jail.ts')));
for(let n=0;n<2;n++)for(const seed of [37,71]){
 const l=LEVELS[n],raw=fs.readFileSync(resolve(setups,`maxed-${l.id}-${seed}.json`),'utf8');
 const w=restore(raw,LEVELS);
 // Controlled comparison, not a natural purchase sequence: same old running setup, rank10 in every arm.
 w.rank=10;
 if(mode!=='base')for(const p of l.pads){
  const facility=/^(kitchen|canteen|wash)[23]$/.test(p.id),cell=/tier[23]$/.test(p.id);
  if(facility||(mode==='rooms'&&cell)){w.bought.push(p.id);w.paid[p.id]=p.cost;}
 }
 const p=w.agents.find(a=>a.kind==='player');Object.assign(p,l.stations.find(s=>s.kind==='safe').pileAt);
 w.ride={state:'away',x:-100,t:1};w.fightIn=l.fights.every;w.boost={x:0,y:0,here:false,t:l.boost.every};
 const visits={table1:0,table2:0,showers:0},messes={puddle:0,poop:0},seen=new Set();
 for(let i=0;i<600/DT;i++){
  const using=w.agents.filter(a=>a.state==='use'&&a.station in visits).map(a=>({id:a.id,station:a.station}));
  step(w,LEVELS,{x:0,y:0});
  for(const a of using)if(w.agents.find(b=>b.id===a.id)?.state==='back')visits[a.station]++;
  for(const m of w.messes)if(!seen.has(m.id)){seen.add(m.id);messes[m.kind]=(messes[m.kind]??0)+1;}
 }
 console.log(JSON.stringify({mode,jail:l.id,seed,source,dirty,runtime,
  projection:'rank10 and selected tier purchases assigned to the old emitted empty-house maxed setup; stationary safe600s',
  visits,messes,released:w.released,rank:w.rank,wallet:w.coins,
  hash:createHash('sha256').update(JSON.stringify(w)).digest('hex')}));
}
