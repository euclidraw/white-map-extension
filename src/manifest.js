import rawConfig from '../extension.json' with { type: 'json' };

export const EXTENSION_ID = rawConfig.id;
export const MAP_ASPECT_ID = `${EXTENSION_ID}.map`;
export const STUDIO_PANEL_ID = `${EXTENSION_ID}.studio`;
export const LEGEND_INSPECTOR_PANEL_ID = `${EXTENSION_ID}.legend-inspector`;

export const COMMAND_NAMES = Object.freeze([
  'insert-map',
  'explore-map',
  'set-region',
  'apply-preset',
  'update-style',
  'update-viewport',
  'toggle-layer',
  'toggle-highlight',
  'update-highlight',
  'add-custom-layer',
  'update-custom-layer',
  'remove-custom-layer',
  'add-annotation',
  'update-annotation',
  'remove-annotation',
  'remove-highlight',
  'add-custom-point',
  'update-legend-item',
  'start-tool',
  'toggle-auto-detail',
  'bake-high-res',
  'clear-baked',
  'reset-viewport',
]);

export const settingsSchema = Object.freeze([
  {
    key: 'defaultRegion',
    label: '기본 지도 지역',
    kind: 'select',
    defaultValue: 'east-asia-oceania',
    options: [
      { value: 'world-pacific', label: '세계 (태평양 중심)' },
      { value: 'east-asia-oceania', label: '동아시아 · 오세아니아' },
      { value: 'korea', label: '한반도' },
      { value: 'northeast-china', label: '중국 동북 3성 · 한반도' },
      { value: 'denmark-germany', label: '덴마크 · 독일 (페마른벨트)' },
      { value: 'europe', label: '유럽' },
    ],
  },
  {
    key: 'defaultPreset',
    label: '기본 수능 인쇄 스타일',
    kind: 'select',
    defaultValue: 'admin0-highlight',
    options: [
      { value: 'world-distribution', label: '세계 분포 (점묘·명암)' },
      { value: 'regional-physical', label: '광역 백지도 (회색 바다·무국경)' },
      { value: 'detail-corridor', label: '상세 백지도 (인셋·경로·지시선)' },
      { value: 'admin1-highlight', label: '행정구역 강조 (3단 경계)' },
      { value: 'admin0-highlight', label: '국가 강조 (파선 국경)' },
    ],
  },
  {
    key: 'autoBakeOnDeepZoom',
    label: '크게 확대 시 상세 벡터 타일 안내',
    kind: 'boolean',
    defaultValue: true,
  },
]);

export function createPackageManifest(metadata = rawConfig) {
  return {
    id: metadata.id,
    settingsSchema,
    version: metadata.version,
    engine: metadata.engine,
    dependencies: { ...metadata.dependencies },
    optionalDependencies: { ...metadata.optionalDependencies },
    conflicts: [...metadata.conflicts],
    provides: {
      services: [...metadata.provides.services],
      aspects: [`${metadata.id}.map`],
      hsmSlots: [...metadata.provides.hsmSlots],
    },
  };
}

export const EXTENSION_MANIFEST = Object.freeze(createPackageManifest(rawConfig));
