import test from 'node:test';
import assert from 'node:assert/strict';
import { create, step, player } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { cameraStick } from '../src/view/camera.ts';
import { pointerOffset } from './helpers.js';

const nativeOffset=(dx,dy,turn,radius)=>{
  const v=pointerOffset(dx,dy,turn,radius);
  return {x:Math.round(195+v.x)-195,y:Math.round(334+v.y)-334};
};

test('fine native offsets are the shortest integer vectors outside the 2.2px deadzone', () => {
  for (let angle = 0; angle < 360; angle++) {
    const a=angle*Math.PI/180, x=Math.cos(a), y=Math.sin(a);
    const v=nativeOffset(x,y,0,.5);
    assert.ok(Number.isInteger(v.x)&&Number.isInteger(v.y));
    assert.equal(v.x*v.x+v.y*v.y,5);
    assert.ok((v.x*x+v.y*y)/Math.sqrt(5)>=2/Math.sqrt(5)-1e-12);
  }
});

test('normal native offsets stay beyond the deadzone and inside the floating ring', () => {
  for (let angle=0;angle<360;angle++) for (const radius of [3,5,20,44]) {
    const a=angle*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a),v=nativeOffset(dx,dy,30,radius);
    const r=Math.hypot(v.x,v.y);
    assert.ok(r>2.2&&r<44,`${angle}/${radius}: ${r}`);
    const c=Math.cos(Math.PI/6),sn=Math.sin(Math.PI/6),d=Math.hypot(dx,dy),old=Math.min(43,Math.max(3,radius));
    assert.deepEqual(v,{x:Math.round(195+((dx*c-dy*sn)/d)*old)-195,y:Math.round(334+((dx*sn+dy*c)/d)*old)-334});
  }
});

test('the captured near-target orbit converges with the actual engine and an 83-step active pulse', () => {
  const w=create(LEVELS,0,17);
  w.ride={state:'away',x:-100,t:1e9};w.fightIn=w.boost.t=1e9;
  // Recorded world point at step696 in failed run43726654392. The largest
  // inferred active pulse is83 ticks; its whole feedback cycle is144 ticks.
  Object.assign(player(w),{x:434.16174751324183,y:289.722912671312});
  const target={x:430,y:290},within=()=>Math.hypot(player(w).x-target.x,player(w).y-target.y)<4;
  for(let cycles=0;cycles<12&&!within();cycles++) {
    const p=player(w),dx=target.x-p.x,dy=target.y-p.y,d=Math.hypot(dx,dy);
    const v=nativeOffset(dx,dy,30,Math.min(1,d/(w.speed*2.4))*44);
    const stick=cameraStick({x:v.x/44,y:v.y/44},30);
    for(let i=0;i<83;i++)step(w,LEVELS,stick);
    for(let i=0;i<61;i++)step(w,LEVELS,{x:0,y:0});
  }
  assert.ok(within(),`still orbiting at ${player(w).x},${player(w).y}`);
  assert.equal(player(w).moving,false);
});
