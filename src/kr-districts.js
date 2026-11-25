import packed from './data/kr-districts.json?raw';

import sido from './data/kr-sido.json?raw';
import sidoLines from './data/kr-sido-lines.json?raw';
import sggLines from './data/kr-sgg-lines.json?raw';

// Decode only on first use; fixed-point coordinates never enter the document.
function line(deltas) {
    let x=0,y=0;
    const points=[];
    for (let i=0;i<deltas.length;i+=2) points.push([(x+=deltas[i])/1e5,(y+=deltas[i+1])/1e5]);
    return points;
}
function ring(deltas) { const pts=line(deltas); return [...pts,pts[0]]; }
const polygon = polys => ({type:'MultiPolygon',coordinates:polys.map(poly=>poly.map(ring))});
export const decodeKrLines = province => ({type:'MultiLineString',coordinates:JSON.parse(province?sidoLines:sggLines).map(line)});
export const decodeKrProvinces = () => ({type:'FeatureCollection',features:JSON.parse(sido).map(([code,nameKo,polys])=>({type:'Feature',properties:{code,nameKo},geometry:polygon(polys)}))});
export function decodeKrDistricts() {
  return {type:'FeatureCollection', features:JSON.parse(packed).map(([code,province,name,polys])=>({
    type:'Feature', properties:{code,nameKo:`${province} ${name}`},
    geometry:polygon(polys),
  }))};
}

export const DISTRICT_CREDIT = '통계청 SGIS (https://sgis.kostat.go.kr), 공공누리 제1유형 · 가공: vuski/admdongkor (https://github.com/vuski/admdongkor), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). 2026-10-01 시군구 경계, 인쇄용 좌표 양자화.';
