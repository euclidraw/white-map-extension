import { KOREAN_SANS, MAP_FONT } from './font-names.js';

/**
 * Five CSAT cartographic print presets modeled directly on Korean geography exam figures.
 */
export const MAP_PRINT_PRESETS = Object.freeze([
  {
    id: 'world-distribution',
    name: '세계 분포 · 점묘와 명암',
    note: '태평양 중심 세계 백지도. 흰 바다, 실선 해안선, 적도 눈금, 회색·진회색·점묘 분포와 좌하단 범례.',
    ocean: '#ffffff',
    land: '#ffffff',
    ink: '#171717',
    coast: '#171717',
    border: '#555555',
    admin1: '#666666',
    river: '#666666',
    lake: '#ffffff',
    highlight: '#b8b8b8',
    coastWidth: 0.85,
    borderWidth: 0.65,
    admin1Width: 0.55,
    riverWidth: 0.6,
    frameWidth: 1.1,
    borderDash: '4 3',
    admin1Dash: '1.2 2',
    gridDash: '3 3',
    defaultLayers: { coastline: true, borders: false, admin1: false, rivers: false, lakes: true, graticule: 'equator-left' },
    defaultRegion: 'world-pacific',
  },
  {
    id: 'regional-physical',
    name: '광역 백지도 · 회색 바다·무국경',
    note: '옅은 회색 바다와 흰 육지, 국경선 없는 순수 해안선과 우측 적도 눈금, 도넛 지점 기호.',
    ocean: '#eaeaea',
    land: '#ffffff',
    ink: '#171717',
    coast: '#171717',
    border: '#555555',
    admin1: '#666666',
    river: '#555555',
    lake: '#eaeaea',
    highlight: '#c4c4c4',
    coastWidth: 0.9,
    borderWidth: 0.7,
    admin1Width: 0.55,
    riverWidth: 0.65,
    frameWidth: 1.1,
    borderDash: '4 3',
    admin1Dash: '1.2 2',
    gridDash: '3 3',
    defaultLayers: { coastline: true, borders: false, admin1: false, rivers: false, lakes: true, graticule: 'equator-right' },
    defaultRegion: 'east-asia-oceania',
  },
  {
    id: 'detail-corridor',
    name: '상세 백지도 · 인셋·경로·지시선',
    note: '회색 바다, 파선 국경, 좌하단 위치 소지도 인셋, 단선/이중선 경로 및 지시선 라벨.',
    ocean: '#e6e6e6',
    land: '#ffffff',
    ink: '#171717',
    coast: '#171717',
    border: '#333333',
    admin1: '#666666',
    river: '#444444',
    lake: '#e6e6e6',
    highlight: '#cccccc',
    coastWidth: 0.9,
    borderWidth: 0.75,
    admin1Width: 0.55,
    riverWidth: 0.7,
    frameWidth: 1.15,
    borderDash: '3.5 2.5',
    admin1Dash: '1.2 2',
    gridDash: '3 3',
    defaultLayers: { coastline: true, borders: true, admin1: false, rivers: false, lakes: true, graticule: 'none' },
    defaultRegion: 'denmark-germany',
  },
  {
    id: 'admin1-highlight',
    name: '행정구역 강조 · 3단 경계선',
    note: '실선 해안선, 파선 국경선, 점선 성·도 경계로 위계를 구분하고 선택 행정구역을 회색으로 채움.',
    ocean: '#ffffff',
    land: '#ffffff',
    ink: '#171717',
    coast: '#171717',
    border: '#1f1f1f',
    admin1: '#3a3a3a',
    river: '#666666',
    lake: '#ffffff',
    highlight: '#cccccc',
    coastWidth: 0.95,
    borderWidth: 0.95,
    admin1Width: 0.75,
    riverWidth: 0.6,
    frameWidth: 1.1,
    borderDash: '6 3.5',
    admin1Dash: '1.3 2.2',
    gridDash: '3 3',
    defaultLayers: { coastline: true, borders: true, admin1: true, rivers: false, lakes: true, graticule: 'none' },
    defaultRegion: 'northeast-china',
  },
  {
    id: 'admin0-highlight',
    name: '국가 강조 · 파선 국경',
    note: '흰 바다·흰 육지 위에 파선 국경선을 두고 선택된 국가를 중회색으로 강조, 좌측 적도 눈금.',
    ocean: '#ffffff',
    land: '#ffffff',
    ink: '#171717',
    coast: '#171717',
    border: '#444444',
    admin1: '#666666',
    river: '#666666',
    lake: '#ffffff',
    highlight: '#9a9a9a',
    coastWidth: 0.9,
    borderWidth: 0.75,
    admin1Width: 0.55,
    riverWidth: 0.65,
    frameWidth: 1.1,
    borderDash: '4 3',
    admin1Dash: '1.2 2',
    gridDash: '3 3',
    defaultLayers: { coastline: true, borders: true, admin1: false, rivers: false, lakes: true, graticule: 'equator-left' },
    defaultRegion: 'east-asia-oceania',
  },
]);

export const EXAMPLE_MAP_CSS = [
  '--map-ocean: #eaeaea;',
  '--map-land: #ffffff;',
  '--map-ink: #171717;',
  '--map-coast-width: 0.9px;',
  '--map-border-dash: 5 3;',
  '--map-admin1-dash: 1.5 2;',
  '--map-river: #555555;',
  '--map-font: serif;',
].join('\n');

const HEX = /^#[0-9a-f]{6}$/i;
const PX = /^(?:0\.[3-9]|[1-3](?:\.\d)?|4(?:\.0)?)px$/;
const DASH = /^(?:none|[1-9]\d?(?:\.\d)? [1-9]\d?(?:\.\d)?)$/;

const validators = {
  ocean: HEX,
  land: HEX,
  ink: HEX,
  coast: HEX,
  border: HEX,
  admin1: HEX,
  river: HEX,
  lake: HEX,
  highlight: HEX,
  'coast-width': PX,
  'border-width': PX,
  'admin1-width': PX,
  'river-width': PX,
  'frame-width': PX,
  'border-dash': DASH,
  'admin1-dash': DASH,
  'grid-dash': DASH,
  font: /^(?:serif|sans-serif)$/,
};

/**
 * Parses safe --map-* declarations. Never emits raw CSS into the DOM or exported SVG.
 */
export function parseMapCss(css) {
  const values = {};
  if (css === undefined || css === null || css === '') return { values };
  if (typeof css !== 'string' || css.length > 2048) {
    return { error: 'CSS는 2048자 이내의 문자열로 입력하세요.' };
  }
  for (const raw of css.split(';')) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^--map-([a-z0-9-]+)\s*:\s*(.+)$/.exec(line);
    if (!match || !Object.hasOwn(validators, match[1]) || !validators[match[1]].test(match[2].trim())) {
      return { error: `지원하지 않는 선언: ${line.slice(0, 80)}` };
    }
    values[match[1]] = match[2].trim();
  }
  return { values };
}

export function resolveMapStyle(presetId = 'admin0-highlight', customCss = '', overrides = {}) {
  const preset = MAP_PRINT_PRESETS.find(p => p.id === presetId) ?? MAP_PRINT_PRESETS[4];
  const parsed = parseMapCss(customCss);
  const v = parsed.values ?? {};
  const hex = val => (typeof val === 'string' && HEX.test(val.trim()) ? val.trim() : '');
  const validDash = val => (typeof val === 'string' && DASH.test(val.trim()) ? val.trim() : '');
  const ovOcean = hex(overrides.oceanColor);
  const ovLand = hex(overrides.landColor);
  const ovInk = hex(overrides.inkColor);
  const ovHighlight = hex(overrides.highlightColor);
  const ovCoastWidth = Number.isFinite(overrides.coastWidth) && overrides.coastWidth >= 0.3 && overrides.coastWidth <= 4
    ? overrides.coastWidth
    : null;
  const ovBorderDash = validDash(overrides.borderDash);
  const ovFont = overrides.fontStyle === 'sans-serif' ? 'sans-serif' : (overrides.fontStyle === 'serif' ? 'serif' : '');

  const ink = v.ink ?? (ovInk || preset.ink);
  const ocean = v.ocean ?? (ovOcean || preset.ocean);
  const fontChoice = v.font ?? (ovFont || 'serif');
  return {
    preset,
    ocean,
    land: v.land ?? (ovLand || preset.land),
    ink,
    coast: v.coast ?? (ovInk || preset.coast || ink),
    border: v.border ?? preset.border,
    admin1: v.admin1 ?? preset.admin1,
    river: v.river ?? preset.river,
    lake: v.lake ?? (ovOcean || preset.lake),
    highlight: v.highlight ?? (ovHighlight || preset.highlight),
    coastWidth: v['coast-width'] ? parseFloat(v['coast-width']) : (ovCoastWidth ?? preset.coastWidth),
    borderWidth: v['border-width'] ? parseFloat(v['border-width']) : preset.borderWidth,
    admin1Width: v['admin1-width'] ? parseFloat(v['admin1-width']) : preset.admin1Width,
    riverWidth: v['river-width'] ? parseFloat(v['river-width']) : preset.riverWidth,
    frameWidth: v['frame-width'] ? parseFloat(v['frame-width']) : preset.frameWidth,
    borderDash: v['border-dash'] ?? (ovBorderDash || preset.borderDash),
    admin1Dash: v['admin1-dash'] ?? preset.admin1Dash,
    gridDash: v['grid-dash'] ?? preset.gridDash,
    fontFamily: fontChoice === 'sans-serif' ? KOREAN_SANS : MAP_FONT,
  };
}
