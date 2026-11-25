import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {clearVectorTiles, fetchViewport, tilePlan, decodeViewport} from '../src/vector-tiles.js';

function waterTile(cls='ocean'){
  const p=new Pbf();p.writeMessage(3,(_,p)=>{
    p.writeVarintField(15,2);p.writeStringField(1,'water');p.writeVarintField(5,4096);
    p.writeStringField(3,'class');p.writeMessage(4,(_,p)=>p.writeStringField(1,cls),null);
    p.writeMessage(2,(_,p)=>{p.writePackedVarint(2,[0,0]);p.writeVarintField(3,3);
      // Clockwise MVT ring: the full tile square, including the common edge.
      p.writePackedVarint(4,[9,0,0,26,8192,0,0,8192,8191,0,15]);},null);
  },null);return p.finish();
}
test('viewport range wraps at the dateline, prioritizes the centre and bounds work',()=>{
  const p=tilePlan([179,-1,-179,1],4400);
  assert.deepEqual(new Set(p.tiles.map(t=>t.x)),new Set([0,p.n-1]));
  assert.ok(p.tiles.length<=16);
  assert.ok(tilePlan([11,54,12,55],12000).z>tilePlan([11,54,12,55],1800).z);
  const q=tilePlan([-20,10,40,70],40000);
  assert.ok(q.tiles.length<=16);
  assert.equal(tilePlan([-180,-85,180,85],40000),null);
});
test('shared tile edges are not coastlines, including on an all-ocean viewport',()=>{
  const p=tilePlan([11,54,12,55],4400);
  const ocean=decodeViewport(p,p.tiles.map(()=>waterTile()));
  assert.equal(ocean.land.features.length,0);assert.equal(ocean.coast.coordinates.length,0);
  const mixed=decodeViewport(p,p.tiles.map(t=>t.x===p.x0?waterTile():new Uint8Array()));
  assert.ok(mixed.land.features.length);assert.ok(mixed.coast.coordinates.length);
  const meridian=(p.x0+1)/p.n*360-180;
  assert.ok(mixed.coast.coordinates.flat().every(([lon])=>Math.abs(lon-meridian)<1e-8));
});
test('river polygons stay separate from lakes even when the tile has no waterway lines',()=>{
  const p=tilePlan([11,54,12,55],4400);
  for (const [cls,which] of [['river','riverAreas'],['pond','lakes'],['lake','lakes'],['dock',null],['swimming_pool',null]]) {
    const d=decodeViewport(p,p.tiles.map(()=>waterTile(cls)));
    for (const k of ['riverAreas','lakes']) assert.equal(!!d[k].features.length,k===which,cls+' '+k);
    assert.equal(d.rivers.coordinates.length,0);
  }
});
test('panning only downloads uncovered tiles; failed tiles can be retried',async()=>{
  clearVectorTiles();const requests=[];let fail=true;
  const fetcher=async url=>{
    if(url.endsWith('/planet'))return {ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']})};
    requests.push(url);if(fail)return {ok:false,status:503};return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};
  };
  const a=tilePlan([11,54,12,55],4400), b=tilePlan([12,54,15,55],4400);
  try{await assert.rejects(fetchViewport(a,fetcher)); fail=false;requests.length=0;
    await fetchViewport(a,fetcher);const count=requests.length;assert.equal(count,a.tiles.length);
    await fetchViewport(b,fetcher);
    const shared=new Set(a.tiles.map(t=>`${t.x}/${t.y}`));assert.equal(requests.length-count,b.tiles.filter(t=>!shared.has(`${t.x}/${t.y}`)).length);
  }finally{clearVectorTiles();}
});
