import { feature, mesh } from 'topojson-client';
import { COUNTRY_NAMES_KO } from './catalog.js';

export const GIS_CDN_URLS = Object.freeze({
  world10m: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-10m.json',
  rivers10m: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_10m_rivers_lake_centerlines.geojson',
  lakes50m: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_lakes.geojson',
  admin1_50m: 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_admin_1_states_provinces_lakes.geojson',
});

const sessionCache = new Map();

async function fetchCachedJson(url, fetcher, signal) {
  if (fetcher === globalThis.fetch && sessionCache.has(url)) {
    return sessionCache.get(url);
  }
  const response = await fetcher(url, { signal, credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`GIS CDN 요청 실패 (HTTP ${response.status}): ${url}`);
  }
  const json = await response.json();
  if (fetcher === globalThis.fetch) {
    sessionCache.set(url, json);
  }
  return json;
}

export function clearCdnCache() {
  sessionCache.clear();
}

function roundTo(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function expandBbox(bbox, marginRatio = 0.35) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const spanLon = Math.max(0.5, maxLon - minLon);
  const spanLat = Math.max(0.5, maxLat - minLat);
  const padLon = spanLon * marginRatio;
  const padLat = spanLat * marginRatio;
  return [
    Math.max(-180, roundTo(minLon - padLon, 3)),
    Math.max(-85, roundTo(minLat - padLat, 3)),
    Math.min(180, roundTo(maxLon + padLon, 3)),
    Math.min(85, roundTo(maxLat + padLat, 3)),
  ];
}

function coordsOverlapBbox(coords, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  let cMinX = Infinity;
  let cMaxX = -Infinity;
  let cMinY = Infinity;
  let cMaxY = -Infinity;
  const visit = arr => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    if (typeof arr[0] === 'number') {
      const [x, y] = arr;
      if (x < cMinX) cMinX = x;
      if (x > cMaxX) cMaxX = x;
      if (y < cMinY) cMinY = y;
      if (y > cMaxY) cMaxY = y;
    } else {
      for (const child of arr) visit(child);
    }
  };
  visit(coords);
  if (!Number.isFinite(cMinX)) return false;
  return !(cMaxX < minLon || cMinX > maxLon || cMaxY < minLat || cMinY > maxLat);
}

/**
 * Sutherland-Hodgman polygon ring clipping against an axis-aligned lon/lat rectangle.
 * Preserves winding order and cuts continental rings (e.g. Eurasia) down to the local viewport.
 */
function clipRingToBbox(ring, bbox) {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const [minX, minY, maxX, maxY] = bbox;
  const edges = [
    { inside: p => p[0] >= minX, intersect: (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])] },
    { inside: p => p[0] <= maxX, intersect: (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])] },
    { inside: p => p[1] >= minY, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY] },
    { inside: p => p[1] <= maxY, intersect: (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY] },
  ];

  // Work on open vertex list
  let output = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  for (const edge of edges) {
    const input = output;
    output = [];
    if (!input.length) break;
    let prev = input[input.length - 1];
    let prevIn = edge.inside(prev);
    for (const curr of input) {
      const currIn = edge.inside(curr);
      if (currIn) {
        if (!prevIn) output.push(edge.intersect(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(edge.intersect(prev, curr));
      }
      prev = curr;
      prevIn = currIn;
    }
  }
  if (output.length < 3) return [];
  output.push(output[0]);
  return output;
}

/**
 * Liang-Barsky segment clipping for a LineString against bbox, splitting into visible sub-lines.
 */
function clipLineToBbox(coords, bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  const segments = [];
  let current = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
    let accept = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) { accept = false; break; }
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) {
          if (r > t1) { accept = false; break; }
          if (r > t0) t0 = r;
        } else {
          if (r < t0) { accept = false; break; }
          if (r < t1) t1 = r;
        }
      }
    }
    if (!accept) {
      if (current.length >= 2) segments.push(current);
      current = [];
      continue;
    }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!current.length) {
      current.push(a, b);
    } else {
      const last = current[current.length - 1];
      if (Math.abs(last[0] - a[0]) > 1e-9 || Math.abs(last[1] - a[1]) > 1e-9) {
        if (current.length >= 2) segments.push(current);
        current = [a, b];
      } else {
        current.push(b);
      }
    }
    if (t1 < 1) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

function simplifyLine(coords, tol, decimals) {
  if (!Array.isArray(coords) || coords.length <= 2) {
    return (coords ?? []).map(([x, y]) => [roundTo(x, decimals), roundTo(y, decimals)]);
  }
  const out = [];
  let prev = null;
  for (let i = 0; i < coords.length; i++) {
    const pt = [roundTo(coords[i][0], decimals), roundTo(coords[i][1], decimals)];
    if (!prev || i === coords.length - 1 || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) >= tol) {
      out.push(pt);
      prev = pt;
    }
  }
  return out;
}

function simplifyRing(ring, tol, decimals) {
  const s = simplifyLine(ring, tol, decimals);
  if (s.length >= 3 && (s[0][0] !== s.at(-1)[0] || s[0][1] !== s.at(-1)[1])) s.push(s[0]);
  return s.length >= 4 ? s : null;
}

function clipAndSimplifyGeometry(geom, bbox, tol, decimals) {
  if (!geom || !geom.coordinates) return null;
  if (!coordsOverlapBbox(geom.coordinates, bbox)) return null;
  switch (geom.type) {
    case 'LineString': {
      const parts = clipLineToBbox(geom.coordinates, bbox)
        .map(line => simplifyLine(line, tol, decimals))
        .filter(line => line.length >= 2);
      if (!parts.length) return null;
      return parts.length === 1
        ? { type: 'LineString', coordinates: parts[0] }
        : { type: 'MultiLineString', coordinates: parts };
    }
    case 'MultiLineString': {
      const lines = [];
      for (const rawLine of geom.coordinates) {
        if (!coordsOverlapBbox(rawLine, bbox)) continue;
        for (const sub of clipLineToBbox(rawLine, bbox)) {
          const s = simplifyLine(sub, tol, decimals);
          if (s.length >= 2) lines.push(s);
        }
      }
      return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
    }
    case 'Polygon': {
      const rings = geom.coordinates
        .map(r => clipRingToBbox(r, bbox))
        .map(r => simplifyRing(r, tol, decimals))
        .filter(Boolean);
      return rings.length ? { type: 'Polygon', coordinates: rings } : null;
    }
    case 'MultiPolygon': {
      const polys = [];
      for (const poly of geom.coordinates) {
        if (!coordsOverlapBbox(poly, bbox)) continue;
        const rings = poly
          .map(r => clipRingToBbox(r, bbox))
          .map(r => simplifyRing(r, tol, decimals))
          .filter(Boolean);
        if (rings.length) polys.push(rings);
      }
      return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    }
    default:
      return geom;
  }
}

function filterFeatureCollection(fc, bbox, tol, decimals, mapProps) {
  if (!fc?.features) return { type: 'FeatureCollection', features: [] };
  const features = [];
  for (const f of fc.features) {
    const geometry = clipAndSimplifyGeometry(f.geometry, bbox, tol, decimals);
    if (!geometry) continue;
    features.push({
      type: 'Feature',
      properties: mapProps ? mapProps(f) : { name: f.properties?.name || '' },
      geometry,
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Fetches high-resolution 10m public static GIS boundaries for the current zoomed viewport,
 * clips & simplifies them to the expanded bbox, and returns a compact self-contained snapshot
 * suitable for storing in canonical entity state (bakedDetail) for offline pure SVG export.
 */
export async function bakeHighResSnapshot({
  bbox,
  layers = {},
  scale = 3000,
  fetcher = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetcher !== 'function') {
    throw new Error('이 환경에서는 네트워크 fetch를 사용할 수 없습니다.');
  }
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error('유효한 지도 범위(bbox)가 필요합니다.');
  }

  const paddedBbox = expandBbox(bbox, 0.35);
  const tol = scale >= 5000 ? 0.002 : scale >= 2500 ? 0.005 : 0.012;
  const decimals = tol < 0.005 ? 4 : 3;

  const worldTopo = await fetchCachedJson(GIS_CDN_URLS.world10m, fetcher, signal);
  const landRaw = feature(worldTopo, worldTopo.objects.land);
  const countriesRaw = feature(worldTopo, worldTopo.objects.countries);
  const bordersRaw = mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);

  const land = filterFeatureCollection(
    landRaw.type === 'FeatureCollection' ? landRaw : { type: 'FeatureCollection', features: [landRaw] },
    paddedBbox,
    tol,
    decimals,
    () => ({}),
  );
  const countries = filterFeatureCollection(countriesRaw, paddedBbox, tol, decimals, f => {
    const code = String(f.id ?? '').padStart(3, '0');
    return { code, name: f.properties?.name || '', nameKo: COUNTRY_NAMES_KO[code] || f.properties?.name || code };
  });
  const bordersGeom = clipAndSimplifyGeometry(bordersRaw, paddedBbox, tol, decimals);
  const borders = bordersGeom ? { type: 'Feature', properties: {}, geometry: bordersGeom } : null;

  let rivers = null;
  if (layers.rivers) {
    const riversRaw = await fetchCachedJson(GIS_CDN_URLS.rivers10m, fetcher, signal);
    rivers = filterFeatureCollection(riversRaw, paddedBbox, tol, decimals, f => ({ name: f.properties?.name || '' }));
  }

  let lakes = null;
  if (layers.lakes) {
    const lakesRaw = await fetchCachedJson(GIS_CDN_URLS.lakes50m, fetcher, signal);
    lakes = filterFeatureCollection(lakesRaw, paddedBbox, tol, decimals, f => ({ name: f.properties?.name || '' }));
  }

  let admin1 = null;
  if (layers.admin1) {
    const admin1Raw = await fetchCachedJson(GIS_CDN_URLS.admin1_50m, fetcher, signal);
    admin1 = filterFeatureCollection(admin1Raw, paddedBbox, tol, decimals, f => ({
      code: f.properties?.iso_3166_2 || f.properties?.postal || f.properties?.name || '',
      country: f.properties?.adm0_a3 || '',
      name: f.properties?.name || '',
    }));
  }

  return {
    source: 'natural-earth-10m',
    bakedAt: new Date().toISOString(),
    bbox: paddedBbox,
    featureCount:
      land.features.length
      + countries.features.length
      + (rivers?.features.length ?? 0)
      + (lakes?.features.length ?? 0)
      + (admin1?.features.length ?? 0),
    land,
    countries,
    borders,
    rivers,
    lakes,
    admin1,
  };
}
