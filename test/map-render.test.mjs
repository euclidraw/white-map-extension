import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_PRINT_PRESETS,
  REGION_PRESETS,
  THEMATIC_PRESETS,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  parseCustomGisInput,
  parseMapCss,
  renderMapSvg,
} from '../dist/plugin.js';

test('all 5 CSAT thematic presets and 12 regions compile to deterministic pure vector SVG', () => {
  for (const tp of THEMATIC_PRESETS) {
    const props = createMapPropsFromThematicPreset(tp.id);
    const a = renderMapSvg(props, { x: 20, y: 30, width: 480, height: 340, rotation: 0 }, tp.id);
    const b = renderMapSvg(props, { x: 20, y: 30, width: 480, height: 340, rotation: 0 }, tp.id);
    assert.equal(a.svg, b.svg, `Deterministic SVG for ${tp.id}`);
    assert.ok(a.svg.startsWith('<g transform="translate(20,30)"'));
    assert.ok(a.svg.includes('data-white-map="true"'));
    assert.doesNotMatch(a.svg, /<foreignObject|<style|var\(--|NaN/);
  }
  for (const r of REGION_PRESETS) {
    const props = createMapPropsForRegion(r.id, 'admin0-highlight');
    props.baseLayers.rivers = true;
    const { svg } = renderMapSvg(props, { x: 0, y: 0, width: 420, height: 320, rotation: 0 }, r.id);
    assert.ok(svg.includes('data-map-layer="land"'), r.id);
    assert.ok(svg.includes('data-map-layer="coastline"'), r.id);
    assert.doesNotMatch(svg, /<foreignObject|NaN/);
  }
});

test('custom --map-* CSS is strictly validated and compiles into SVG attributes', () => {
  const valid = parseMapCss('--map-ocean: #dcdcdc; --map-border-dash: 6 2; --map-coast-width: 1.4px; --map-font: sans-serif;');
  assert.equal(valid.error, undefined);
  assert.equal(valid.values.ocean, '#dcdcdc');

  for (const bad of ['body { color: red }', '--map-ocean: url(x)', '--map-coast-width: 9px', 'a'.repeat(2049)]) {
    assert.ok(parseMapCss(bad).error, `Expected rejection for ${bad.slice(0, 30)}`);
  }

  const props = createMapPropsForRegion('korea', 'admin0-highlight');
  props.customCss = '--map-ocean: #e1e1e1; --map-border-dash: 7 2; --map-coast-width: 1.5px;';
  const { svg } = renderMapSvg(props, undefined, 'css-test');
  assert.ok(svg.includes('fill="#e1e1e1"'));
  assert.ok(svg.includes('stroke-dasharray="7 2"'));
  assert.ok(svg.includes('stroke-width="1.5"'));
});

test('custom GIS parser accepts GeoJSON, Feature, Geometry, and CSV lon/lat tables', () => {
  const csv = parseCustomGisInput('name,lon,lat\n서울,126.98,37.56\n부산,129.07,35.18');
  assert.equal(csv.ok, true);
  assert.equal(csv.kind, 'point');
  assert.equal(csv.count, 2);

  const line = parseCustomGisInput(JSON.stringify({
    type: 'LineString',
    coordinates: [[126.98, 37.56], [129.07, 35.18]],
  }));
  assert.equal(line.ok, true);
  assert.equal(line.kind, 'line');

  const bad = parseCustomGisInput('city,value\n서울,100');
  assert.equal(bad.ok, false);
});

test('all 5 print presets expose distinct configurations', () => {
  assert.equal(MAP_PRINT_PRESETS.length, 5);
  assert.equal(new Set(MAP_PRINT_PRESETS.map(p => p.id)).size, 5);
});
