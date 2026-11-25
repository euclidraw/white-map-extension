// Generates compact, quantized public-domain offline GIS datasets from Natural Earth v5.1.2.
import { writeFile } from 'node:fs/promises';

const BASE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson';

function roundCoord(v, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function simplifyLine(coords, tol, decimals) {
  if (!Array.isArray(coords) || coords.length <= 2) {
    return (coords ?? []).map(([x, y]) => [roundCoord(x, decimals), roundCoord(y, decimals)]);
  }
  const out = [];
  let prev = null;
  for (let i = 0; i < coords.length; i++) {
    const pt = [roundCoord(coords[i][0], decimals), roundCoord(coords[i][1], decimals)];
    if (!prev || i === coords.length - 1 || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) >= tol) {
      out.push(pt);
      prev = pt;
    }
  }
  return out;
}

function simplifyGeom(geom, tol = 0.04, decimals = 2) {
  if (!geom) return null;
  if (geom.type === 'LineString') {
    const c = simplifyLine(geom.coordinates, tol, decimals);
    return c.length >= 2 ? { type: 'LineString', coordinates: c } : null;
  }
  if (geom.type === 'MultiLineString') {
    const c = geom.coordinates.map(line => simplifyLine(line, tol, decimals)).filter(l => l.length >= 2);
    return c.length ? { type: 'MultiLineString', coordinates: c } : null;
  }
  if (geom.type === 'Polygon') {
    const c = geom.coordinates.map(ring => {
      const s = simplifyLine(ring, tol, decimals);
      if (s.length >= 3 && (s[0][0] !== s.at(-1)[0] || s[0][1] !== s.at(-1)[1])) s.push(s[0]);
      return s;
    }).filter(r => r.length >= 4);
    return c.length ? { type: 'Polygon', coordinates: c } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const c = geom.coordinates
      .map(poly =>
        poly.map(ring => {
          const s = simplifyLine(ring, tol, decimals);
          if (s.length >= 3 && (s[0][0] !== s.at(-1)[0] || s[0][1] !== s.at(-1)[1])) s.push(s[0]);
          return s;
        }).filter(r => r.length >= 4),
      )
      .filter(p => p.length > 0);
    return c.length ? { type: 'MultiPolygon', coordinates: c } : null;
  }
  return geom;
}

async function fetchJson(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  return res.json();
}

const [riversRaw, lakesRaw, admin1Raw] = await Promise.all([
  fetchJson('ne_50m_rivers_lake_centerlines.geojson'),
  fetchJson('ne_110m_lakes.geojson'),
  fetchJson('ne_50m_admin_1_states_provinces_lakes.geojson'),
]);

const rivers = {
  type: 'FeatureCollection',
  features: riversRaw.features
    .filter(f => (f.properties?.scalerank ?? 99) <= 5)
    .map(f => ({
      type: 'Feature',
      properties: { name: f.properties?.name || '', rank: f.properties?.scalerank ?? 5 },
      geometry: simplifyGeom(f.geometry, 0.12, 2),
    }))
    .filter(f => f.geometry),
};

const lakes = {
  type: 'FeatureCollection',
  features: lakesRaw.features
    .map(f => ({
      type: 'Feature',
      properties: { name: f.properties?.name || '' },
      geometry: simplifyGeom(f.geometry, 0.05, 2),
    }))
    .filter(f => f.geometry),
};

const ADMIN1_KO = {
  'CN-HL': '헤이룽장성', 'CN-JL': '지린성', 'CN-LN': '랴오닝성', 'CN-BJ': '베이징',
  'CN-SH': '상하이', 'CN-GD': '광둥성', 'CN-SC': '쓰촨성', 'CN-XJ': '신장',
  'CN-XZ': '티베트', 'CN-NM': '네이멍구', 'CN-SD': '산둥성', 'CN-JS': '장쑤성',
  'CN-ZJ': '저장성', 'CN-FJ': '푸젠성', 'CN-HB': '후베이성', 'CN-HN': '후난성',
  'CN-HE': '허베이성', 'CN-HA': '허난성', 'CN-SN': '산시성(섬서)', 'CN-SX': '산시성(산서)',
  'CN-YN': '윈난성', 'CN-GX': '광시', 'CN-CQ': '충칭', 'CN-TJ': '톈진',
  'CN-AH': '안후이성', 'CN-JX': '장시성', 'CN-GZ': '구이저우성', 'CN-GS': '간쑤성',
  'CN-QH': '칭하이성', 'CN-NX': '닝샤', 'CN-HI': '하이난성',
};

const admin1 = {
  type: 'FeatureCollection',
  features: admin1Raw.features
    .filter(f => ['CHN', 'USA', 'AUS', 'BRA', 'IND'].includes(f.properties?.adm0_a3))
    .map(f => {
      const code = f.properties?.iso_3166_2 || f.properties?.postal || f.properties?.name || '';
      return {
        type: 'Feature',
        properties: {
          code,
          country: f.properties?.adm0_a3 || '',
          name: f.properties?.name || '',
          nameKo: ADMIN1_KO[code] || f.properties?.name || '',
        },
        geometry: simplifyGeom(f.geometry, 0.14, 2),
      };
    })
    .filter(f => f.geometry),
};

await writeFile(new URL('../src/data/rivers.json', import.meta.url), JSON.stringify(rivers));
await writeFile(new URL('../src/data/lakes.json', import.meta.url), JSON.stringify(lakes));
await writeFile(new URL('../src/data/admin1.json', import.meta.url), JSON.stringify(admin1));

console.log('Generated offline GIS datasets:', {
  rivers: rivers.features.length,
  lakes: lakes.features.length,
  admin1: admin1.features.length,
});
