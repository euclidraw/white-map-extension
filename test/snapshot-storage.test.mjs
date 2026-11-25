import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import plugin, {MAP_ASPECT_ID, createMapPropsForRegion, renderMapSvg, renderMapDom} from '../dist/plugin.js';

test('bake saves only the flag; reopening restores from network without rewriting the document', async () => {
  let props = createMapPropsForRegion('denmark-germany','detail-corridor');
  const bounds = {width:480,height:360};
  const writes=[]; let fetches=0;
  const activate=()=>plugin.activate({world:{getCanonical:(_id,key)=>key===MAP_ASPECT_ID?props:bounds,
    applyCanonicalTransaction:(_caller,ops)=>{writes.push(ops[0].patch);props={...props,...ops[0].patch};}},services:{get:()=>undefined}});
  const topo=JSON.parse(await readFile(new URL('../node_modules/world-atlas/countries-50m.json',import.meta.url)));
  const fetcher=async url=>{fetches++;return {ok:true,json:async()=>url.includes('countries-10m')?topo:{type:'FeatureCollection',features:[]}}};
  const args={entityId:'m',fetcher};
  const original=globalThis.fetch;
  let runtime=activate();
  try {
    assert.equal((await runtime.api.bakeHighRes(args)).ok,true);
    assert.deepEqual(writes,[{bakedDetail:true}]);
    assert.equal(renderMapSvg(props,bounds,'m').meta.useBaked,true);
    const before=fetches;
    assert.equal((await runtime.api.bakeHighRes(args)).reused,true);
    assert.equal(fetches,before);assert.equal(writes.length,1);
    props=JSON.parse(JSON.stringify(props));runtime.dispose();runtime=activate();
    assert.equal(renderMapSvg(props,bounds,'m').meta.useBaked,false);
    globalThis.fetch=fetcher;
    const doc=new JSDOM('<div id="host"></div>').window.document, host=doc.querySelector('#host');
    renderMapDom(host,props,bounds,'m');
    await new Promise(r=>setTimeout(r,0));
    assert.equal(host.querySelector('[data-map-resolution]').dataset.mapResolution,'10m-baked');
    assert.ok(fetches>before);assert.equal(writes.length,1);
    runtime.api.clearBaked({entityId:'m'});
    assert.deepEqual(writes.at(-1),{bakedDetail:false});
    assert.equal(renderMapSvg(props,bounds,'m').meta.useBaked,false);
  } finally {runtime.dispose();globalThis.fetch=original;}
});

test('migration replaces only legacy bake data, including packed records', async()=>{
  const layer={id:'my-data'};
  const records=[{land:{type:'FeatureCollection',features:[]}}, {format:'white-map/deflate-json-v1',data:'old'},true,false].map(bakedDetail=>({bakedDetail,customLayers:[layer]}));
  const patches=[];
  const runtime=plugin.activate({services:{get:()=>undefined},world:{listEntityIds:()=>['0','1','2','3'],getCanonical:id=>records[id],applyCanonicalTransaction(_,ops){for(const op of ops){patches.push(op.patch);Object.assign(records[op.id],op.patch);}}}});
  try {await Promise.resolve();assert.deepEqual(patches,[{bakedDetail:true},{bakedDetail:true}]);assert.ok(records.every(p=>p.customLayers[0]===layer));} finally {runtime.dispose();}
});
