import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../src/engine/sim.ts';
import { LEVELS } from '../src/content/jail.ts';
import { pegs } from '../src/skins/pegs.ts';
import { roomTierPieces } from '../src/view/scene.ts';

test('room stages are deterministic shared boxes inside existing furniture footprints', () => {
  for (const [n,l] of LEVELS.entries()) for (const dark of [false,true]) {
    const w=create(LEVELS,n,37), pal=pegs.palette(dark);
    assert.deepEqual(roomTierPieces(l,w,pal),[]);
    const base=l.pads.filter(p=>!/tier[23]$|^(kitchen|canteen|wash)[23]$/.test(p.id)).map(p=>p.id);
    w.bought=[...base,...l.pads.filter(p=>/tier2$|^(kitchen|canteen|wash)2$/.test(p.id)).map(p=>p.id)];
    const before=JSON.stringify({w,l,pal}),middle=roomTierPieces(l,w,pal);
    assert.equal(middle.length,84,'stage2 furnishing inventory');
    assert.deepEqual(roomTierPieces(l,w,pal),middle);
    assert.equal(JSON.stringify({w,l,pal}),before);
    w.bought=l.pads.map(p=>p.id);
    const top=roomTierPieces(l,w,pal);
    assert.equal(top.length,200,'stage3 furnishing inventory');
    for(const p of top){
      assert.equal(p.shape,'box');
      assert.ok([p.x,p.y,p.z,p.sx,p.sy,p.sz].every(Number.isFinite));
      assert.ok(p.sx>0&&p.sy>0&&p.sz>0);
      assert.ok(p.y+p.sy/2<=39);
      assert.ok(p.x-p.sx/2>=20&&p.x+p.sx/2<=700);
      assert.ok(p.z-p.sz/2>=28&&p.z+p.sz/2<=640);
    }
    // A changed cell cannot place its furnishings in another cell or across its doorway.
    for(let i=0;i<8;i++){
      w.bought=[...base,`cell${i+1}tier2`,`cell${i+1}tier3`];
      const room=l.rooms.find(r=>r.id===`c${i}`).rect;
      for(const p of roomTierPieces(l,w,pal)){
        assert.ok(p.x-p.sx/2>room.x&&p.x+p.sx/2<room.x+room.w);
        assert.ok(p.z-p.sz/2>room.y&&p.z+p.sz/2<room.y+room.h);
      }
    }
  }
});
