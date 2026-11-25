import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bakeHighResSnapshot, createMapPropsForRegion, renderMapSvg } from '../dist/plugin.js';

test('bakeHighResSnapshot clips & simplifies CDN TopoJSON/GeoJSON to viewport bbox and renders deterministically offline', async () => {
  const sampleWorld = JSON.parse(await readFile(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url), 'utf8'));
  const sampleRivers = JSON.parse(await readFile(new URL('../src/data/rivers.json', import.meta.url), 'utf8'));
  const sampleLakes = JSON.parse(await readFile(new URL('../src/data/lakes.json', import.meta.url), 'utf8'));
  const sampleAdmin1 = JSON.parse(await readFile(new URL('../src/data/admin1.json', import.meta.url), 'utf8'));

  const fetchedUrls = [];
  const mockFetch = async url => {
    fetchedUrls.push(url);
    const body = url.includes('countries-10m') ? sampleWorld
      : url.includes('rivers') ? sampleRivers
      : url.includes('lakes') ? sampleLakes
      : sampleAdmin1;
    return { ok: true, status: 200, json: async () => body };
  };

  const props = createMapPropsForRegion('denmark-germany', 'detail-corridor');
  props.baseLayers.rivers = true;
  props.baseLayers.lakes = true;
  props.baseLayers.admin1 = true;

  const first = renderMapSvg(props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'dk-bake');
  assert.equal(first.meta.useBaked, false);

  const baked = await bakeHighResSnapshot({
    bbox: first.meta.bbox,
    layers: props.baseLayers,
    scale: props.viewport.scale,
    fetcher: mockFetch,
  });

  assert.equal(fetchedUrls.length, 4);
  assert.equal(baked.source, 'natural-earth-10m');
  assert.ok(baked.land.features.length > 0);
  // Clipping keeps the baked snapshot much smaller than the full world TopoJSON
  assert.ok(JSON.stringify(baked).length < 180_000);

  const bakedProps = { ...props, bakedDetail: baked };
  const after = renderMapSvg(bakedProps, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'dk-bake');
  assert.equal(after.meta.useBaked, true);
  assert.ok(after.svg.includes('data-map-resolution="10m-baked"'));
  assert.doesNotMatch(after.svg, /NaN|<foreignObject/);
});
