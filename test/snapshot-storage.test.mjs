import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import plugin, {MAP_ASPECT_ID, createMapPropsForRegion, renderMapSvg, renderMapDom} from '../dist/plugin.js';

test('bake saves only the flag; reopening restores from network without rewriting the document', async () => {
  let props = createMapPropsForRegion('denmark-germany','detail-corridor');
  const bounds = {width:480,height:360};
  const writes=[]; let fetches=0;
  const activate=()=>plugin.activate({world:{getCanonical:(_id,key)=>key===MAP_ASPECT_ID?props:bounds,
    applyCanonicalTransaction:(_caller,ops)=>{writes.push(ops[0].patch);props={...props,...ops[0].patch};}},services:{get:()=>undefined}});
  const fetcher=async url=>{fetches++;if(url.endsWith('/planet'))return {ok:true,json:async()=>({tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']})};
    assert.match(url,/\/\d+\/\d+\/\d+\.pbf$/);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};};
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
    assert.match(host.querySelector('[data-map-resolution]').dataset.mapResolution,/^vector-z\d+$/);
    const credit=host.querySelector('[data-map-field="attribution"]');
    assert.ok(credit.textContent.includes('© OpenStreetMap contributors'));
    assert.equal(credit.parentElement, host.querySelector('[data-white-map]'));
    const {frameX,frameW,frameY,frameH}=renderMapSvg(props,bounds,'m').meta;
    assert.equal(credit.getAttribute('font-size'),'4.5');
    assert.equal(credit.getAttribute('text-anchor'),'end');
    assert.equal(Number(credit.getAttribute('x')),frameX+frameW);
    assert.equal(Number(credit.getAttribute('y'))-4.5,frameY+frameH+1);
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
