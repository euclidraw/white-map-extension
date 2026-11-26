import {
  geoConicEqualArea,
  geoContains,
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  geoPath,
} from 'd3-geo';
import { feature, mesh } from 'topojson-client';
// Keep the packed assets as strings until a visible layer actually needs them.
import worldText from 'world-atlas/countries-50m.json?raw';
import { decodeKrDistricts, decodeKrProvinces, decodeKrLines } from './kr-districts.js';
import adminText from './data/admin1.json?raw';
import lakeText from './data/lakes.json?raw';
import riverText from './data/rivers.json?raw';
import { COUNTRY_NAMES_KO } from './catalog.js';

let cache = {};
const topology = () => cache.topology ??= JSON.parse(worldText);
const offline = {
  get land() { const t = topology(); return cache.land ??= feature(t, t.objects.land); },
  get borders() { const t = topology(); return cache.borders ??= mesh(t, t.objects.countries, (a,b) => a !== b); },
  get countries() {
    if (!cache.countries) {
      const t = topology(), fc = feature(t, t.objects.countries);
      for (const f of fc.features) {
        const code = String(f.id ?? '').padStart(3,'0');
        f.properties = { ...f.properties, code, nameKo: COUNTRY_NAMES_KO[code] || f.properties?.name || code };
      }
      cache.countries = fc;
    }
    return cache.countries;
  },
  get rivers() { return cache.rivers ??= JSON.parse(riverText); },
  get lakes() { return cache.lakes ??= JSON.parse(lakeText); },
  get krProvinces() { return cache.krProvinces ??= decodeKrProvinces(); },
  get krProvinceLines() { return cache.krProvinceLines ??= decodeKrLines(true); },
  get krDistrictLines() { return cache.krDistrictLines ??= decodeKrLines(false); },
  get krDistricts() { return cache.krDistricts ??= decodeKrDistricts(); },
  get admin1() { return cache.admin1 ??= JSON.parse(adminText); },
};
export function getOfflineBaseGis() { return offline; }
export function releaseOfflineBaseGis() { cache = {}; }

export const REFERENCE_FRAME_WIDTH = 520;
export const DEEP_ZOOM_BAKE_SCALE = 1800;

export function isDeepZoomScale(scale) {
  return Number.isFinite(scale) && scale >= DEEP_ZOOM_BAKE_SCALE;
}

/**
 * Creates a d3-geo projection fitted to (width, height) using normalized viewport scale.
 */
export function createMapProjection(projectionName, viewport, width, height) {
  const safeW = Math.max(80, width);
  const safeH = Math.max(80, height);
  const ratio = safeW / REFERENCE_FRAME_WIDTH;
  const scale = Math.max(30, Number(viewport?.scale) || 260) * ratio;
  const centerLon = Number.isFinite(viewport?.centerLon) ? viewport.centerLon : 0;
  const centerLat = Math.max(-82, Math.min(82, Number.isFinite(viewport?.centerLat) ? viewport.centerLat : 0));
  const rotateLon = Number.isFinite(viewport?.rotateLon) ? viewport.rotateLon : 0;

  let proj;
  switch (projectionName) {
    case 'naturalEarth1':
      proj = geoNaturalEarth1();
      break;
    case 'conicEqualArea':
      proj = geoConicEqualArea().parallels([centerLat - 10, centerLat + 10]);
      break;
    case 'equirectangular':
      proj = geoEquirectangular();
      break;
    case 'mercator':
    default:
      proj = geoMercator();
      break;
  }

  proj
    .rotate([rotateLon, 0])
    .center([centerLon, centerLat])
    .scale(scale)
    .translate([safeW / 2, safeH / 2])
    .clipExtent([[0, 0], [safeW, safeH]]);

  return proj;
}

export function createGeoPath(projection) {
  return geoPath(projection);
}

/**
 * Samples the frame perimeter + center to estimate the visible lon/lat bounding box.
 */
export function computeViewportBbox(projection, width, height, wrap = false) {
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const [x, y] of [
      [t * width, 0],
      [t * width, height],
      [0, t * height],
      [width, t * height],
      [t * width, height / 2],
      [width / 2, t * height],
    ]) {
      const ll = projection.invert?.([x, y]);
      if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) {
        pts.push(ll);
      }
    }
  }
  if (!pts.length) return [-180, -85, 180, 85];
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const spanLon = maxLon - minLon;
  if (spanLon > 220 && wrap) {
    const aroundDateLine = pts.map(([lon]) => lon < 0 ? lon+360 : lon);
    const west=Math.min(...aroundDateLine), east=Math.max(...aroundDateLine);
    if (east-west < 180) return [west,minLat,east-360,maxLat];
  }
  if (spanLon > 220) {
    return [-180, Math.max(-85, minLat), 180, Math.min(85, maxLat)];
  }
  return [
    Math.max(-180, minLon),
    Math.max(-85, minLat),
    Math.min(180, maxLon),
    Math.min(85, maxLat),
  ];
}

/**
 * Returns the polygon feature (Admin-0 country or Admin-1 province) containing (lon, lat).
 */
export function hitTestAdminFeature(lon, lat, level = 'admin0', bakedDetail = null) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const base = getOfflineBaseGis();
  const collection = level === 'kr-sido' ? base.krProvinces : level === 'kr-sgg' ? base.krDistricts : level === 'admin1'
    ? (bakedDetail?.admin1?.features?.length ? bakedDetail.admin1 : base.admin1)
    : (bakedDetail?.countries?.features?.length ? bakedDetail.countries : base.countries);
  if (!collection?.features) return null;
  for (const feat of collection.features) {
    try {
      if (geoContains(feat, [lon, lat])) {
        return {
          level,
          code: String(feat.properties?.code ?? feat.id ?? ''),
          name: feat.properties?.nameKo || feat.properties?.name || String(feat.id ?? ''),
          feature: feat,
        };
      }
    } catch {
      // Ignore degenerate geometry
    }
  }
  return null;
}

// Korean district picking takes precedence only on a real district hit unless a target level is explicitly chosen.
export function pickAdmin(lon, lat, layers, detail, preferredLevel = 'auto') {
  if (preferredLevel && preferredLevel !== 'auto') {
    if ((preferredLevel === 'kr-sido' || preferredLevel === 'kr-sgg') && (lon < 124 || lon > 132 || lat < 32 || lat > 39)) {
      return null;
    }
    return hitTestAdminFeature(lon, lat, preferredLevel, detail);
  }
  if ((layers.krDistricts || layers.krProvinces) && lon >= 124 && lon <= 132 && lat >= 32 && lat <= 39) {
    const district = hitTestAdminFeature(lon, lat, layers.krDistricts ? 'kr-sgg' : 'kr-sido');
    if (district) return district;
  }
  return hitTestAdminFeature(lon, lat, layers.admin1 ? 'admin1' : 'admin0', detail);
}

/**
 * Checks whether a baked 10m snapshot covers the requested viewport bbox.
 */
export function bakedCoversBbox(bakedDetail, bbox) {
  if (!bakedDetail || !Array.isArray(bakedDetail.bbox) || bakedDetail.bbox.length !== 4) return false;
  const [bMinLon, bMinLat, bMaxLon, bMaxLat] = bakedDetail.bbox;
  const [vMinLon, vMinLat, vMaxLon, vMaxLat] = bbox;
  return vMinLon >= bMinLon - 0.05 && vMaxLon <= bMaxLon + 0.05 && vMinLat >= bMinLat - 0.05 && vMaxLat <= bMaxLat + 0.05;
}
