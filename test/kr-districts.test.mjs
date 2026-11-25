import test from 'node:test';
import assert from 'node:assert/strict';
import {geoArea,geoContains} from 'd3-geo';
import {createMapPropsForRegion, getOfflineBaseGis, renderMapSvg} from '../dist/plugin.js';

test('Korean district geometry has unique codes and correctly wound mainland and island polygons',()=>{
  const {features}=getOfflineBaseGis().krDistricts;
  assert.equal(features.length,256);
  assert.equal(new Set(features.map(f=>f.properties.code)).size,256);
  assert.ok(features.every(f=>/^\d{5}$/.test(f.properties.code) && geoArea(f)>0 && geoArea(f)<1));
  for(const [pt,code] of [[[126.978,37.572],'11110'],[[126.531,33.499],'50110'],[[130.905,37.486],'47940'],[[127,39],null]]){
    assert.deepEqual(features.filter(f=>geoContains(f,pt)).map(f=>f.properties.code),code?[code]:[]);
  }
});

test('province and district tiers include Korean coastal islands without replacing the basemap',()=>{
  const base=getOfflineBaseGis();
  assert.equal(base.krProvinces.features.length,16);
  for(const [pt,sido] of [[[126.978,37.572],'11'],[[126.531,33.499],'50'],[[130.905,37.486],'47']]){
    assert.deepEqual(base.krProvinces.features.filter(f=>geoContains(f,pt)).map(f=>f.properties.code),[sido]);
  }
  const p=createMapPropsForRegion('korea');
  const both=renderMapSvg({...p,showKrProvinces:true,showKrDistricts:true,highlights:[{level:'kr-sido',codes:['11']},{level:'kr-sgg',codes:['11110']}]}).svg;
  for(const tag of ['data-map-layer="kr-sido"','data-map-layer="kr-sgg"','data-map-highlight="11"','data-map-highlight="11110"'])assert.ok(both.includes(tag));
  const paths = svg => ['land','coastline'].map(layer => svg.match(new RegExp('data-map-layer="'+layer+'" d="([^"]+)"'))[1]);
  const original = paths(renderMapSvg(p).svg);
  for (const flags of [{showKrProvinces:true},{showKrDistricts:true},{showKrProvinces:true,showKrDistricts:true},{highlights:[{level:'kr-sgg',codes:['11110']}]}]) {
    assert.deepEqual(paths(renderMapSvg({...p,...flags}).svg), original);
  }
  const provinceOnly=renderMapSvg({...p,showKrProvinces:true}).svg;
  assert.match(provinceOnly,/data-map-layer="kr-sido"/);
  assert.doesNotMatch(provinceOnly,/data-map-layer="kr-sgg"/);
  assert.doesNotMatch(renderMapSvg({...p,showKrDistricts:true}).svg,/data-map-layer="kr-sido"/);
});

test('district outlines and multi-district highlights render independently and store only codes',()=>{
  const p=createMapPropsForRegion('korea');
  assert.doesNotMatch(renderMapSvg(p).svg,/data-map-layer="kr-sgg"/);
  p.showKrDistricts=true;
  p.highlights=[{level:'kr-sgg',codes:['11110','11680'],pattern:'hatch',legendLabel:'서울 두 구'}];
  p.showLegend=true;
  const {svg}=renderMapSvg(p);
  assert.match(svg,/data-map-layer="kr-sgg"/);
  for(const c of p.highlights[0].codes)assert.ok(svg.includes('data-map-highlight="'+c+'"'));
  assert.match(svg,/서울 두 구/);assert.match(svg,/SGIS/);
  assert.doesNotMatch(JSON.stringify(p),/MultiPolygon/);
  const noLines=renderMapSvg({...p,showKrDistricts:false}).svg;
  assert.doesNotMatch(noLines,/data-map-layer="kr-sgg"/);assert.match(noLines,/data-map-highlight="11110"/);
});
