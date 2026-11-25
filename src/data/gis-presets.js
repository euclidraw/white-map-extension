/**
 * Curated CSAT thematic GIS presets modeled directly on the 5 reference exam figures.
 * Each preset can be applied as a complete exam template OR individual layers can be added.
 */
export const THEMATIC_PRESETS = Object.freeze([
  {
    id: 'csat-world-env',
    name: '세계 환경 분포 (사막화·열대림·해양)',
    summary: '참고 지도 1 (2.18.07): 태평양 중심 세계 백지도 + 회색/진회색/점묘(stipple) 분포 레이어 + A/B/C 범례',
    regionPreset: 'world-pacific',
    stylePreset: 'world-distribution',
    baseLayers: { coastline: true, borders: false, admin1: false, rivers: false, lakes: true, graticule: 'equator-left' },
    highlights: [],
    inset: { enabled: false, region: 'world', corner: 'bl' },
    legend: { enabled: true, corner: 'bl' },
    customLayers: [
      {
        id: 'env-a',
        name: 'A',
        kind: 'polygon',
        visible: true,
        style: { fill: '#bdbdbd', pattern: 'none', stroke: 'none', strokeWidth: 0 },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '사헬 지대' }, geometry: { type: 'Polygon', coordinates: [[[-16, 17], [-5, 19], [10, 17], [25, 16], [38, 13], [42, 9], [30, 10], [15, 12], [0, 13], [-15, 13], [-16, 17]]] } },
            { type: 'Feature', properties: { name: '중앙·동아시아 건조' }, geometry: { type: 'Polygon', coordinates: [[[58, 43], [75, 48], [98, 47], [116, 44], [114, 38], [98, 37], [82, 35], [68, 30], [52, 33], [58, 43]]] } },
            { type: 'Feature', properties: { name: '호주 내륙 건조' }, geometry: { type: 'Polygon', coordinates: [[[118, -22], [134, -20], [144, -25], [142, -33], [126, -32], [116, -28], [118, -22]]] } },
            { type: 'Feature', properties: { name: '북미 서부 건조' }, geometry: { type: 'Polygon', coordinates: [[[-118, 42], [-104, 43], [-101, 31], [-110, 27], [-117, 34], [-118, 42]]] } },
          ],
        },
      },
      {
        id: 'env-b',
        name: 'B',
        kind: 'polygon',
        visible: true,
        style: { fill: '#3f3f3f', pattern: 'none', stroke: 'none', strokeWidth: 0 },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '아마존 주변' }, geometry: { type: 'Polygon', coordinates: [[[-74, -4], [-63, -8], [-52, -9], [-47, -4], [-55, -13], [-68, -12], [-76, -8], [-74, -4]]] } },
            { type: 'Feature', properties: { name: '동남아 열대림' }, geometry: { type: 'Polygon', coordinates: [[[96, 16], [105, 16], [108, 11], [103, 2], [99, 5], [96, 16]]] } },
            { type: 'Feature', properties: { name: '서아프리카·콩고' }, geometry: { type: 'Polygon', coordinates: [[[-11, 7], [2, 6], [12, 3], [21, 0], [16, -5], [8, 1], [-8, 4], [-11, 7]]] } },
          ],
        },
      },
      {
        id: 'env-c',
        name: 'C',
        kind: 'polygon',
        visible: true,
        style: { fill: '#c8c8c8', pattern: 'stipple', stroke: 'none', strokeWidth: 0 },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '북태평양 서부' }, geometry: { type: 'Polygon', coordinates: [[[147, 30], [156, 34], [164, 30], [160, 24], [151, 25], [147, 30]]] } },
            { type: 'Feature', properties: { name: '북태평양 동부' }, geometry: { type: 'Polygon', coordinates: [[[-152, 33], [-141, 35], [-134, 29], [-140, 23], [-150, 26], [-152, 33]]] } },
            { type: 'Feature', properties: { name: '북대서양' }, geometry: { type: 'Polygon', coordinates: [[[-68, 30], [-54, 34], [-47, 30], [-56, 25], [-66, 26], [-68, 30]]] } },
            { type: 'Feature', properties: { name: '인도양' }, geometry: { type: 'Polygon', coordinates: [[[58, -28], [76, -26], [85, -31], [72, -35], [57, -32], [58, -28]]] } },
            { type: 'Feature', properties: { name: '남태평양' }, geometry: { type: 'Polygon', coordinates: [[[-106, -28], [-92, -26], [-84, -32], [-95, -35], [-105, -32], [-106, -28]]] } },
          ],
        },
      },
    ],
    annotations: [],
  },
  {
    id: 'csat-three-stations',
    name: '동아시아~호주 3개 지점 백지도',
    summary: '참고 지도 2 (2.18.15): 회색 바다·무국경 해안선 + 우측 적도 눈금 + 도넛 지점 3곳',
    regionPreset: 'east-asia-oceania',
    stylePreset: 'regional-physical',
    baseLayers: { coastline: true, borders: false, admin1: false, rivers: false, lakes: true, graticule: 'equator-right' },
    highlights: [],
    inset: { enabled: false, region: 'world', corner: 'bl' },
    legend: { enabled: false, corner: 'bl' },
    customLayers: [
      {
        id: 'stations-3',
        name: '관측 지점',
        kind: 'point',
        visible: true,
        style: { stroke: '#171717', fill: '#ffffff', strokeWidth: 2.6, marker: 'ring' },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '지점 1' }, geometry: { type: 'Point', coordinates: [106.9, 47.9] } },
            { type: 'Feature', properties: { name: '지점 2' }, geometry: { type: 'Point', coordinates: [116.1, -1.2] } },
            { type: 'Feature', properties: { name: '지점 3' }, geometry: { type: 'Point', coordinates: [115.86, -31.95] } },
          ],
        },
      },
    ],
    annotations: [],
  },
  {
    id: 'csat-fehmarn-corridor',
    name: '페마른벨트 해저 터널 상세도',
    summary: '참고 지도 3 (2.18.21): 덴마크·독일 상세 백지도 + 유럽 위치 소지도 인셋 + A/B 경로 + 지시선 라벨',
    regionPreset: 'denmark-germany',
    stylePreset: 'detail-corridor',
    baseLayers: { coastline: true, borders: true, admin1: false, rivers: false, lakes: true, graticule: 'none' },
    highlights: [],
    inset: { enabled: true, region: 'europe', corner: 'bl' },
    legend: { enabled: true, corner: 'br' },
    customLayers: [
      {
        id: 'route-a',
        name: 'A',
        kind: 'line',
        visible: true,
        style: { stroke: '#171717', strokeWidth: 1.5, dash: 'none', doubleLine: false },
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'A (기존 육상·교량 경로)' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [9.99, 53.55], [9.6, 54.4], [9.45, 55.1], [9.55, 55.55],
                  [10.2, 55.38], [10.95, 55.34], [11.6, 55.44], [12.57, 55.68],
                ],
              },
            },
          ],
        },
      },
      {
        id: 'route-b',
        name: 'B',
        kind: 'line',
        visible: true,
        style: { stroke: '#171717', strokeWidth: 3.2, dash: 'none', doubleLine: true },
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'B (페마른벨트 해저 터널)' },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [9.99, 53.55], [10.68, 53.87], [11.12, 54.48],
                  [11.35, 54.66], [11.88, 54.96], [12.15, 55.32], [12.57, 55.68],
                ],
              },
            },
          ],
        },
      },
      {
        id: 'corridor-cities',
        name: '주요 도시',
        kind: 'point',
        visible: true,
        style: { stroke: '#171717', fill: '#ffffff', strokeWidth: 1.4, marker: 'bullseye' },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '코펜하겐' }, geometry: { type: 'Point', coordinates: [12.57, 55.68] } },
            { type: 'Feature', properties: { name: '뢰드부' }, geometry: { type: 'Point', coordinates: [11.35, 54.66] } },
            { type: 'Feature', properties: { name: '함부르크' }, geometry: { type: 'Point', coordinates: [9.99, 53.55] } },
          ],
        },
      },
    ],
    annotations: [
      { id: 'ann-dk', lon: 9.2, lat: 55.7, text: '덴마크', dx: 0, dy: 0, leaderLine: false, halo: true },
      { id: 'ann-de', lon: 10.3, lat: 54.1, text: '독일', dx: 0, dy: 0, leaderLine: false, halo: true },
      { id: 'ann-cph', lon: 12.57, lat: 55.68, text: '코펜하겐', dx: -44, dy: -6, leaderLine: true, halo: true },
      { id: 'ann-rod', lon: 11.35, lat: 54.66, text: '뢰드부', dx: -42, dy: 0, leaderLine: true, halo: true },
      { id: 'ann-tun', lon: 11.24, lat: 54.57, text: '페마른벨트 해저 터널', dx: 46, dy: 24, leaderLine: true, halo: true },
      { id: 'ann-ham', lon: 9.99, lat: 53.55, text: '함부르크', dx: 44, dy: 0, leaderLine: true, halo: true },
      { id: 'ann-a', lon: 9.48, lat: 55.05, text: 'A', dx: -24, dy: 0, leaderLine: true, halo: true },
      { id: 'ann-b', lon: 11.95, lat: 55.02, text: 'B', dx: 28, dy: 8, leaderLine: true, halo: true },
    ],
  },
  {
    id: 'csat-dongbei',
    name: '중국 동북 3성 (A 지역)',
    summary: '참고 지도 4 (2.18.29): 3단 경계선(해안·국경·성경계) + 동북 3성 강조 + 베이징·서울 수도 기호',
    regionPreset: 'northeast-china',
    stylePreset: 'admin1-highlight',
    baseLayers: { coastline: true, borders: true, admin1: true, rivers: false, lakes: true, graticule: 'none' },
    highlights: [
      { level: 'admin1', codes: ['CN-HL', 'CN-JL', 'CN-LN'], fill: '#cccccc', legendLabel: 'A 지역' },
    ],
    inset: { enabled: false, region: 'east-asia', corner: 'bl' },
    legend: { enabled: true, corner: 'br' },
    customLayers: [
      {
        id: 'capitals-ea',
        name: '수도',
        kind: 'point',
        visible: true,
        style: { stroke: '#171717', fill: '#ffffff', strokeWidth: 1.3, marker: 'bullseye' },
        geojson: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { name: '베이징' }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } },
            { type: 'Feature', properties: { name: '서울' }, geometry: { type: 'Point', coordinates: [126.98, 37.56] } },
          ],
        },
      },
    ],
    annotations: [
      { id: 'ann-bj', lon: 116.4, lat: 39.9, text: '베이징', dx: 4, dy: 18, leaderLine: false, halo: true },
      { id: 'ann-sel', lon: 126.98, lat: 37.56, text: '서울', dx: -22, dy: 2, leaderLine: false, halo: true },
    ],
  },
  {
    id: 'csat-ea-countries',
    name: '동아시아 · 필리핀 국가 강조',
    summary: '참고 지도 5 (2.18.35): 흰 바다·파선 국경 + 한·중·일·필리핀 국가 강조 + 좌측 적도 눈금',
    regionPreset: 'east-asia-oceania',
    stylePreset: 'admin0-highlight',
    baseLayers: { coastline: true, borders: true, admin1: false, rivers: false, lakes: true, graticule: 'equator-left' },
    highlights: [
      { level: 'admin0', codes: ['156', '410', '392', '608'], fill: '#9a9a9a', legendLabel: '' },
    ],
    inset: { enabled: false, region: 'world', corner: 'bl' },
    legend: { enabled: false, corner: 'bl' },
    customLayers: [],
    annotations: [],
  },
]);

export function getThematicPreset(id) {
  return THEMATIC_PRESETS.find(p => p.id === id) ?? null;
}
