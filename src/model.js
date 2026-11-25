import { feature as topoFeature } from 'topojson-client';
import { getRegionPreset } from './catalog.js';
import { getThematicPreset } from './data/gis-presets.js';
import { MAP_PRINT_PRESETS, resolveMapStyle } from './print-style.js';

export const DEFAULT_MAP_WIDTH = 480;
export const DEFAULT_MAP_HEIGHT = 360;
export const MIN_MAP_WIDTH = 200;
export const MIN_MAP_HEIGHT = 160;

export const DEFAULT_BASE_LAYERS = Object.freeze({
  coastline: true,
  borders: true,
  admin1: false,
  rivers: false,
  lakes: true,
  graticule: 'equator-left',
});

export const MAP_DEFAULTS = Object.freeze({
  title: '',
  regionPreset: 'east-asia-oceania',
  projection: 'mercator',
  viewport: { centerLon: 121, centerLat: 11, scale: 265, rotateLon: 0 },
  stylePreset: 'admin0-highlight',
  customCss: '',
  baseLayers: { ...DEFAULT_BASE_LAYERS },
  highlights: [],
  customLayers: [],
  annotations: [],
  inset: { enabled: false, region: 'world', corner: 'bl', offset: { x: 0, y: 0 } },
  legend: { enabled: false, corner: 'bl', offset: { x: 0, y: 0 }, items: [] },
  bakedDetail: null,
});

function isRecord(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeOffset(offset) {
  return {
    x: Number.isFinite(offset?.x) ? Math.round(offset.x) : 0,
    y: Number.isFinite(offset?.y) ? Math.round(offset.y) : 0,
  };
}

export function createMapPropsFromThematicPreset(thematicId) {
  const t = getThematicPreset(thematicId);
  if (!t) return createMapPropsForRegion('east-asia-oceania', 'admin0-highlight');
  const region = getRegionPreset(t.regionPreset);
  return {
    ...MAP_DEFAULTS,
    title: '',
    regionPreset: region.id,
    projection: region.projection,
    viewport: { ...region.viewport },
    stylePreset: t.stylePreset,
    customCss: '',
    baseLayers: { ...DEFAULT_BASE_LAYERS, ...t.baseLayers },
    highlights: structuredClone(t.highlights ?? []),
    customLayers: structuredClone(t.customLayers ?? []),
    annotations: structuredClone(t.annotations ?? []),
    inset: { enabled: false, region: region.insetRegion || 'world', corner: 'bl', offset: { x: 0, y: 0 }, ...(t.inset ?? {}) },
    legend: { enabled: false, corner: 'bl', offset: { x: 0, y: 0 }, items: [], ...(t.legend ?? {}) },
    bakedDetail: null,
  };
}

export function createMapPropsForRegion(regionId = 'east-asia-oceania', stylePresetId = 'admin0-highlight') {
  const region = getRegionPreset(regionId);
  const preset = MAP_PRINT_PRESETS.find(p => p.id === stylePresetId) ?? MAP_PRINT_PRESETS[4];
  return {
    ...MAP_DEFAULTS,
    title: '',
    regionPreset: region.id,
    projection: region.projection,
    viewport: { ...region.viewport },
    stylePreset: preset.id,
    customCss: '',
    baseLayers: { ...DEFAULT_BASE_LAYERS, ...(preset.defaultLayers ?? {}) },
    highlights: [],
    customLayers: [],
    annotations: [],
    inset: { enabled: preset.id === 'detail-corridor', region: region.insetRegion || 'world', corner: 'bl', offset: { x: 0, y: 0 } },
    legend: { enabled: false, corner: 'bl', offset: { x: 0, y: 0 }, items: [] },
    bakedDetail: null,
  };
}

export function resolveMapSpec(rawProps = {}) {
  const region = getRegionPreset(rawProps.regionPreset);
  const style = resolveMapStyle(rawProps.stylePreset || 'admin0-highlight', rawProps.customCss || '');
  const vp = isRecord(rawProps.viewport) ? rawProps.viewport : region.viewport;
  const projection = ['mercator', 'naturalEarth1', 'conicEqualArea', 'equirectangular'].includes(rawProps.projection)
    ? rawProps.projection
    : region.projection;

  const viewport = {
    centerLon: Number.isFinite(vp.centerLon) ? vp.centerLon : region.viewport.centerLon,
    centerLat: Math.max(-82, Math.min(82, Number.isFinite(vp.centerLat) ? vp.centerLat : region.viewport.centerLat)),
    scale: Math.max(30, Math.min(40000, Number.isFinite(vp.scale) ? vp.scale : region.viewport.scale)),
    rotateLon: Number.isFinite(vp.rotateLon) ? vp.rotateLon : (region.viewport.rotateLon ?? 0),
  };

  const baseLayers = {
    ...DEFAULT_BASE_LAYERS,
    ...(isRecord(rawProps.baseLayers) ? rawProps.baseLayers : {}),
  };

  const highlights = Array.isArray(rawProps.highlights)
    ? rawProps.highlights
        .filter(h => isRecord(h) && Array.isArray(h.codes) && h.codes.length > 0)
        .map(h => ({
          level: h.level === 'admin1' ? 'admin1' : 'admin0',
          codes: h.codes.map(c => String(c).trim()).filter(Boolean),
          fill: typeof h.fill === 'string' && h.fill ? h.fill : style.highlight,
          pattern: ['none', 'hatch', 'crosshatch', 'stipple'].includes(h.pattern) ? h.pattern : 'none',
          legendLabel: typeof h.legendLabel === 'string' ? h.legendLabel : '',
        }))
    : [];

  const customLayers = Array.isArray(rawProps.customLayers)
    ? rawProps.customLayers.filter(l => isRecord(l) && l.geojson)
    : [];

  const annotations = Array.isArray(rawProps.annotations)
    ? rawProps.annotations
        .filter(a => isRecord(a) && Number.isFinite(a.lon) && Number.isFinite(a.lat) && typeof a.text === 'string' && a.text.trim())
        .map((a, idx) => ({
          id: typeof a.id === 'string' && a.id ? a.id : `ann-${idx}`,
          lon: a.lon,
          lat: a.lat,
          text: a.text,
          dx: Number.isFinite(a.dx) ? a.dx : 0,
          dy: Number.isFinite(a.dy) ? a.dy : 0,
          leaderLine: Boolean(a.leaderLine),
          halo: a.halo !== false,
        }))
    : [];

  const insetRaw = isRecord(rawProps.inset) ? rawProps.inset : {};
  const inset = {
    enabled: Boolean(insetRaw.enabled),
    region: ['world', 'europe', 'east-asia'].includes(insetRaw.region) ? insetRaw.region : (region.insetRegion || 'world'),
    corner: ['bl', 'br', 'tl', 'tr'].includes(insetRaw.corner) ? insetRaw.corner : 'bl',
    offset: normalizeOffset(insetRaw.offset),
  };

  const legendRaw = isRecord(rawProps.legend) ? rawProps.legend : {};
  const autoLegendItems = [];
  for (const h of highlights) {
    if (h.legendLabel) {
      autoLegendItems.push({ kind: 'polygon', label: h.legendLabel, fill: h.fill, pattern: h.pattern });
    }
  }
  for (const layer of customLayers) {
    if (layer.visible === false || !layer.name) continue;
    if (layer.kind === 'point' && !layer.showInLegend) continue;
    autoLegendItems.push({
      kind: layer.kind || 'polygon',
      label: layer.name,
      fill: layer.style?.fill || style.highlight,
      pattern: layer.style?.pattern || 'none',
      stroke: layer.style?.stroke || style.ink,
      strokeWidth: layer.style?.strokeWidth ?? 1.4,
      dash: layer.style?.dash || 'none',
      doubleLine: Boolean(layer.style?.doubleLine),
      marker: layer.style?.marker || 'dot',
    });
  }
  const explicitItems = Array.isArray(legendRaw.items) && legendRaw.items.length > 0 ? legendRaw.items : autoLegendItems;
  const legend = {
    enabled: legendRaw.enabled !== undefined ? Boolean(legendRaw.enabled) : explicitItems.length > 0,
    corner: ['bl', 'br', 'tl', 'tr'].includes(legendRaw.corner) ? legendRaw.corner : 'bl',
    offset: normalizeOffset(legendRaw.offset),
    items: explicitItems,
  };

  return {
    title: typeof rawProps.title === 'string' ? rawProps.title : '',
    regionPreset: region.id,
    region,
    projection,
    viewport,
    stylePreset: style.preset.id,
    customCss: typeof rawProps.customCss === 'string' ? rawProps.customCss : '',
    style,
    baseLayers,
    highlights,
    customLayers,
    annotations,
    inset,
    legend,
    bakedDetail: isRecord(rawProps.bakedDetail) && rawProps.bakedDetail.land ? rawProps.bakedDetail : null,
  };
}

export function deriveMapGeometry(_props, id, view) {
  const transform = view?.getCanonical?.(id, 'core.transform') ?? { x: 0, y: 0, rotation: 0 };
  const bounds = view?.getCanonical?.(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
  return {
    x: Number.isFinite(transform.x) ? transform.x : 0,
    y: Number.isFinite(transform.y) ? transform.y : 0,
    rotation: Number.isFinite(transform.rotation) ? transform.rotation : 0,
    width: Number.isFinite(bounds.width) && bounds.width > 0 ? Math.max(MIN_MAP_WIDTH, Math.round(bounds.width)) : DEFAULT_MAP_WIDTH,
    height: Number.isFinite(bounds.height) && bounds.height > 0 ? Math.max(MIN_MAP_HEIGHT, Math.round(bounds.height)) : DEFAULT_MAP_HEIGHT,
  };
}

/**
 * Parses user-supplied GeoJSON, TopoJSON, or CSV (name,lon,lat) into a normalized GeoJSON FeatureCollection + inferred layer kind.
 */
export function parseCustomGisInput(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'GIS 데이터(GeoJSON, TopoJSON 또는 CSV)를 입력하세요.' };
  }
  const text = raw.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      let fc = null;
      if (parsed.type === 'Topology' && isRecord(parsed.objects)) {
        const firstKey = Object.keys(parsed.objects)[0];
        if (!firstKey) return { ok: false, error: 'TopoJSON에 objects 항목이 없습니다.' };
        const decoded = topoFeature(parsed, parsed.objects[firstKey]);
        fc = decoded.type === 'FeatureCollection' ? decoded : { type: 'FeatureCollection', features: [decoded] };
      } else if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        fc = parsed;
      } else if (parsed.type === 'Feature' && parsed.geometry) {
        fc = { type: 'FeatureCollection', features: [parsed] };
      } else if (parsed.type && parsed.coordinates) {
        fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: parsed }] };
      } else {
        return { ok: false, error: '지원하지 않는 JSON 구조입니다. GeoJSON 또는 TopoJSON을 입력하세요.' };
      }
      if (!fc.features.length) return { ok: false, error: '피처(features)가 비어 있습니다.' };
      const gType = fc.features[0]?.geometry?.type || '';
      const kind = /Point/i.test(gType) ? 'point' : /Line/i.test(gType) ? 'line' : 'polygon';
      return { ok: true, geojson: fc, kind, count: fc.features.length };
    } catch (error) {
      return { ok: false, error: `JSON 파싱 오류: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { ok: false, error: 'CSV는 헤더와 최소 1개 이상의 데이터 행이 필요합니다 (예: name,lon,lat).' };
  }
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const lonIdx = headers.findIndex(h => ['lon', 'lng', 'longitude', '경도', 'x'].includes(h));
  const latIdx = headers.findIndex(h => ['lat', 'latitude', '위도', 'y'].includes(h));
  const nameIdx = headers.findIndex(h => ['name', 'label', 'city', '이름', '지명'].includes(h));
  if (lonIdx < 0 || latIdx < 0) {
    return { ok: false, error: 'CSV 헤더에 경도(lon/lng)와 위도(lat) 열이 필요합니다.' };
  }
  const features = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const lon = Number(cols[lonIdx]);
    const lat = Number(cols[latIdx]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    features.push({
      type: 'Feature',
      properties: { name: nameIdx >= 0 ? cols[nameIdx] || '' : `지점 ${i}` },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  if (!features.length) {
    return { ok: false, error: '유효한 경위도 좌표를 찾지 못했습니다.' };
  }
  return { ok: true, geojson: { type: 'FeatureCollection', features }, kind: 'point', count: features.length };
}
