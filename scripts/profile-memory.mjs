// Reproducible isolated renderer/baker benchmark; not the whole Alid browser process.
// pnpm build && node --expose-gc scripts/profile-memory.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
if (!global.gc) throw Error('Use node --expose-gc');
const mib = n => Math.round(n / 1048576 * 10) / 10;
function report(stage) {
  global.gc(); global.gc();
  console.log(stage, {heapMiB: mib(process.memoryUsage().heapUsed), peakRssMiB: mib(process.resourceUsage().maxRSS * 1024)});
}
report('start');
const {createMapPropsForRegion, renderMapSvg, bakeHighResSnapshot} = await import('../dist/plugin.js');
report('import');
const props = createMapPropsForRegion('denmark-germany', 'detail-corridor');
const geom = {x:0,y:0,width:480,height:360,rotation:0};
let view = renderMapSvg(props, geom);
report('one offline frame');
for (let i=0; i<30; i++) view = renderMapSvg({...props, centerLon:props.centerLon + i/100},geom);
report('30 pan previews');
// Use the actual pinned 10m atlas, without the network or variability of HTTP caches.
const url = new URL('../node_modules/world-atlas/countries-10m.json', import.meta.url);
globalThis.fetch = async () => ({ok:true, json: async () => JSON.parse(await readFile(url,'utf8'))});
const detail = await bakeHighResSnapshot({scale:props.scale, bbox:view.meta.bbox});
assert.ok(detail.land.features.length);
props.bakedDetail = true;
report('bake complete (local snapshot retained)');
console.log('detail JSON bytes (not persisted)', Buffer.byteLength(JSON.stringify(detail)));
