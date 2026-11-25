import proj4 from 'proj4';

export const BASE_CRS_LABEL = 'WGS 84 (EPSG:4326) · 경도, 위도 (°)';
const unified = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs';
const toDegrees = proj4(unified, 'EPSG:4326');

export function inputCrs(declaration, selected = 'auto') {
  const name = declaration?.properties?.name ?? '';
  let declared;
  if (declaration != null) {
    if (/^(?:OGC:CRS84|CRS84|urn:ogc:def:crs:OGC:(?:1\.3)?:CRS84)$/i.test(name)) declared = 'EPSG:4326';
    else {
      const code = /^(?:EPSG:|urn:ogc:def:crs:EPSG:[\d.]*:|https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/0\/)(4326|5179)$/i.exec(name)?.[1];
      if (!code) throw Error('지원하지 않는 원본 좌표계입니다. EPSG:4326으로 재투영한 뒤 가져오세요.');
      declared = `EPSG:${code}`;
    }
  }
  if (!['auto','EPSG:4326','EPSG:5179'].includes(selected)) throw Error('원본 좌표계를 확인하세요.');
  if (declared && selected !== 'auto' && declared !== selected) throw Error('파일의 좌표계와 선택한 원본 좌표계가 다릅니다.');
  return declared ?? (selected === 'auto' ? 'EPSG:4326' : selected);
}

export function normalizePosition(p, crs) {
  if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw Error('좌표는 유한한 숫자 쌍이어야 합니다.');
  const [x,y] = crs === 'EPSG:5179' ? toDegrees.forward([p[0],p[1]]) : p;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>180 || Math.abs(y)>90) throw Error('경위도 범위를 벗어났습니다. 원본 좌표계와 X/Y 순서를 확인하세요.');
  return [x,y,...p.slice(2)];
}

// Called on freshly parsed/decoded import data, never on the canonical document.
export function normalizeCollection(fc, crs) {
  const depth = {Point:0,MultiPoint:1,LineString:1,MultiLineString:2,Polygon:2,MultiPolygon:3};
  function coords(c,n) {
    if (!Array.isArray(c)) throw Error('올바르지 않은 GIS 좌표 배열입니다.');
    return n === 0 ? normalizePosition(c,crs) : c.map(v=>coords(v,n-1));
  }
  function strip(node) {
    inputCrs(node.crs, crs);
    delete node.crs; delete node.bbox; // A projected extent is invalid after conversion.
  }
  strip(fc);
  for (const f of fc.features) {
    const g = f?.geometry;
    if (!g || !Object.hasOwn(depth,g.type)) throw Error('지원하지 않는 피처 도형입니다.');
    strip(f); strip(g); g.coordinates = coords(g.coordinates,depth[g.type]);
  }
  return fc;
}
