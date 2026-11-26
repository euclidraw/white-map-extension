import { BASE_CRS_LABEL } from './crs.js';
import { frameLayout } from './frame-layout.js';
import metadata from '../extension.json' with { type: 'json' };
import { REGION_PRESETS, getRegionPreset } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { renderMapDom } from './dom-renderer.js';
import { cmuSvgDefs } from './fonts.js';
import { computeViewportBbox, createMapProjection, getOfflineBaseGis, releaseOfflineBaseGis, isDeepZoomScale } from './gis-base.js';
import { cachedBake, clearBakeSession, loadBake } from './bake-session.js';
import { bakeHighResSnapshot } from './gis-cdn.js';
import {
  COMMAND_NAMES,
  EXTENSION_ID,
  MAP_ASPECT_ID,
  STUDIO_PANEL_ID,
  createPackageManifest,
  settingsSchema,
} from './manifest.js';
import { mountMapExplorer } from './map-explorer.js';
import { mountMapGizmos } from './map-gizmo.js';
import { HIGHLIGHT_SLOTS, mountMapMenubar } from './map-menubar.js';
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAP_DEFAULTS,
  isLegacyBake,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  deriveMapGeometry,
  normalizeOffset,
  parseCustomGisInput,
  resolveMapSpec,
  syncFlatFields,
} from './model.js';
import { createStudioPanelSpec } from './panel.js';
import { MAP_PRINT_PRESETS, parseMapCss, resolveMapStyle } from './print-style.js';
import { renderMapSvg } from './svg-renderer.js';
import { planWhiteMapChanges, registerWhiteMapTools } from './tools.js';

const MAP_ICON = Object.freeze({
  paths: Object.freeze([
    'M3 5l5-2 6 2 5-2v12l-5 2-6-2-5 2V5z',
    'M8 3v12',
    'M14 5v12',
  ]),
});

const LABEL_ICON = Object.freeze({
  paths: Object.freeze([
    'M3 16l5-5h9',
    'M11 4h6',
    'M14 4v5',
  ]),
});

const QUICK_PRESET_OPTIONS = Object.freeze(
  MAP_PRINT_PRESETS.map(p => ({ label: p.name.split(' · ')[0], value: p.id })),
);

const CORNER_OPTIONS = Object.freeze([
  { label: '좌하', value: 'bl' },
  { label: '우하', value: 'br' },
  { label: '좌상', value: 'tl' },
  { label: '우상', value: 'tr' },
]);

const COMMAND_LABELS = Object.freeze({
  'insert-map': '수능 백지도 추가',
  'explore-map': '지도 프레임 탐색 (더블클릭)',
  'set-region': '백지도 지역 프리셋 전환',
  'apply-preset': '수능 백지도 예제 프리셋 적용',
  'update-style': '백지도 스타일·CSS·옵션 변경',
  'update-viewport': '백지도 중심·배율 갱신',
  'toggle-layer': '백지도 기본 레이어 토글',
  'toggle-highlight': '국가·행정구역 강조 토글',
  'update-highlight': '강조 그룹 수정',
  'add-custom-layer': '커스텀 GIS 레이어 추가',
  'update-custom-layer': '커스텀 GIS 레이어 수정',
  'remove-custom-layer': '커스텀 GIS 레이어 삭제',
  'add-annotation': '지시선 라벨 추가',
  'update-annotation': '지시선 라벨 수정',
  'remove-annotation': '지시선 라벨 삭제',
  'remove-highlight': '강조 그룹 삭제',
  'add-custom-point': '지점 마커 배치',
  'start-tool': '지도 배치 도구 시작',
  'toggle-auto-detail': '자동 상세 타일 토글',
  'bake-high-res': '현재 범위 상세 타일 불러오기',
  'clear-baked': '50m 오프라인 경계 복원',
  'reset-viewport': '지도 시점 초기화',
});

const whiteMapAspect = Object.freeze({
  id: MAP_ASPECT_ID,
  label: '수능 백지도',
  summary: '지역 중심 백지도, 국경·행정구역·하천 레이어, 수능 인쇄 스타일 및 더블클릭 프레임 탐색 도형',
  layout: true,
  dependsOnCanonical: ['core.transform', 'core.bounds', MAP_ASPECT_ID],
  dependsOnComputed: [],
  defaults: MAP_DEFAULTS,
  textSearchFields: ['title', 'regionPreset', 'stylePreset'],
  derive: deriveMapGeometry,
  renderDom: renderMapDom,
  renderSvg: renderMapSvg,
  svgDefs: cmuSvgDefs,
  ui: {
    controls: [
      // Tool shelf
      {
        id: 'white-map.insert.shelf',
        kind: 'action',
        label: '수능 백지도 추가',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:insert-map`,
        placement: 'tool-shelf',
        requiresSelection: false,
      },
      // Selection bar: keep minimal like alid-stem-extensions (all map tools live in top-fixed HUD toolbar)
      {
        id: 'white-map.explore.selection',
        kind: 'action',
        label: '지도 안쪽 탐색',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:explore-map`,
        placement: 'selection-bar',
        requiresSelection: true,
      },

      // Props (Inspector) Panel — Section 1: 수능 인쇄 스타일 (open by default)
      {
        id: 'white-map.title.inspector',
        kind: 'text',
        field: 'title',
        label: '제목',
        section: '수능 인쇄 스타일',
        placement: 'inspector',
      },
      {
        id: 'white-map.preset.inspector',
        kind: 'segmented',
        field: 'stylePreset',
        label: '수능 인쇄 프리셋',
        section: '수능 인쇄 스타일',
        placement: 'inspector',
        options: QUICK_PRESET_OPTIONS,
      },
      {
        id: 'white-map.oceanSwatches.inspector',
        kind: 'segmented',
        field: 'oceanColor',
        label: '바다 팔레트',
        section: '수능 인쇄 스타일',
        placement: 'inspector',
        options: [
          { label: '흰색', value: '#ffffff', swatch: '#ffffff' },
          { label: '연회색', value: '#eaeaea', swatch: '#eaeaea' },
          { label: '회색', value: '#dcdcdc', swatch: '#dcdcdc' },
        ],
      },
      {
        id: 'white-map.fontStyle.inspector',
        kind: 'segmented',
        field: 'fontStyle',
        label: '서체',
        section: '수능 인쇄 스타일',
        placement: 'inspector',
        options: [
          { label: 'CMU·Pretendard', value: 'serif' },
          { label: 'Pretendard 고딕', value: 'sans-serif' },
        ],
      },

      // Props (Inspector) Panel — Section 2: 기본 레이어 (open by default)
      {
        id: 'white-map.showCoastline.inspector',
        kind: 'toggle',
        field: 'showCoastline',
        label: '해안선 (실선)',
        section: '기본 레이어',
        placement: 'inspector',
      },
      {
        id: 'white-map.showBorders.inspector',
        kind: 'toggle',
        field: 'showBorders',
        label: '국경선 (파선)',
        section: '기본 레이어',
        placement: 'inspector',
      },
      {
        id: 'white-map.showAdmin1.inspector',
        kind: 'toggle',
        field: 'showAdmin1',
        label: '성·도 경계 (점선)',
        section: '기본 레이어',
        placement: 'inspector',
      },
      {
        id: 'white-map.showKrProvinces.inspector',
        kind: 'toggle',
        field: 'showKrProvinces',
        label: '대한민국 시·도 경계',
        section: '기본 레이어',
        placement: 'inspector',
        description: '시·군·구와 함께 표시하면 더 작은 시·군·구가 클릭됩니다.',
      },
      {
        id: 'white-map.showKrDistricts.inspector',
        kind: 'toggle',
        field: 'showKrDistricts',
        label: '대한민국 시·군·구 경계',
        section: '기본 레이어',
        placement: 'inspector',
        description: '경계를 켜고 지역 강조 도구로 원하는 시·군·구를 클릭하세요.',
      },
      {
        id: 'white-map.showRivers.inspector',
        kind: 'toggle',
        field: 'showRivers',
        label: '하천',
        section: '기본 레이어',
        placement: 'inspector',
      },
      {
        id: 'white-map.showLakes.inspector',
        kind: 'toggle',
        field: 'showLakes',
        label: '호수',
        section: '기본 레이어',
        placement: 'inspector',
      },
      {
        id: 'white-map.graticule.inspector',
        kind: 'segmented',
        field: 'graticule',
        label: '적도 · 위경선',
        section: '기본 레이어',
        placement: 'inspector',
        options: [
          { label: '없음', value: 'none' },
          { label: '좌 0°', value: 'equator-left' },
          { label: '우 0°', value: 'equator-right' },
          { label: '격자', value: 'grid' },
        ],
      },
      {
        id: 'white-map.bakedDetail.inspector',
        kind: 'toggle',
        field: 'bakedDetail',
        label: '자동 상세 타일 (확대 시)',
        description: '×1800 이상 확대할 때 현재 화면 범위의 정밀 해안선·하천 벡터 타일을 자동으로 불러옵니다.',
        section: '기본 레이어',
        placement: 'inspector',
      },

      // Props (Inspector) Panel — Section 3: 범례 · 위치 소지도 (open by default)
      {
        id: 'white-map.showLegend.inspector',
        kind: 'toggle',
        field: 'showLegend',
        label: '범례 박스',
        section: '범례 · 위치 소지도',
        placement: 'inspector',
      },
      {
        id: 'white-map.legendCorner.inspector',
        kind: 'segmented',
        field: 'legendCorner',
        label: '범례 위치',
        section: '범례 · 위치 소지도',
        placement: 'inspector',
        options: CORNER_OPTIONS,
      },
      {
        id: 'white-map.showInset.inspector',
        kind: 'toggle',
        field: 'showInset',
        label: '위치 소지도 인셋',
        section: '범례 · 위치 소지도',
        placement: 'inspector',
      },
      {
        id: 'white-map.insetRegion.inspector',
        kind: 'segmented',
        field: 'insetRegion',
        label: '인셋 범위',
        section: '범례 · 위치 소지도',
        placement: 'inspector',
        options: [
          { label: '세계', value: 'world' },
          { label: '유럽', value: 'europe' },
          { label: '동아시아', value: 'east-asia' },
        ],
      },
      {
        id: 'white-map.insetCorner.inspector',
        kind: 'segmented',
        field: 'insetCorner',
        label: '인셋 위치',
        section: '범례 · 위치 소지도',
        placement: 'inspector',
        options: CORNER_OPTIONS,
      },

      // Props (Inspector) Panel — Section 4: 시점 · 좌표 미세조정 (collapsed by default)
      {
        id: 'white-map.explore.inspector',
        kind: 'action',
        label: '프레임 탐색 (더블클릭)',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:explore-map`,
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        requiresSelection: true,
      },
      {
        id: 'white-map.projection.inspector',
        kind: 'segmented',
        field: 'projection',
        label: '화면 투영법',
        description: '데이터 기준: ' + BASE_CRS_LABEL + '. 이 선택은 좌표를 바꾸지 않습니다.',
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        options: [
          { label: '메르카토르', value: 'mercator' },
          { label: '내추럴어스', value: 'naturalEarth1' },
          { label: '원뿔정적', value: 'conicEqualArea' },
          { label: '정방형', value: 'equirectangular' },
        ],
      },
      {
        id: 'white-map.resetViewport.inspector',
        kind: 'action',
        label: '시점 초기화',
        commandSymbol: `${EXTENSION_ID}:reset-viewport`,
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        requiresSelection: true,
      },
      {
        id: 'white-map.centerLon.inspector',
        kind: 'number',
        field: 'centerLon',
        label: '중심 경도 (°E)',
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        min: -180,
        max: 180,
        step: 0.5,
      },
      {
        id: 'white-map.centerLat.inspector',
        kind: 'number',
        field: 'centerLat',
        label: '중심 위도 (°N)',
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        min: -80,
        max: 80,
        step: 0.5,
      },
      {
        id: 'white-map.scale.inspector',
        kind: 'number',
        field: 'scale',
        label: '배율 (Scale)',
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        min: 30,
        max: 40000,
        step: 20,
      },
      {
        id: 'white-map.rotateLon.inspector',
        kind: 'number',
        field: 'rotateLon',
        label: '경도 회전 (태평양 -150)',
        section: '시점 · 좌표 미세조정',
        sectionCollapsed: true,
        placement: 'inspector',
        min: -180,
        max: 180,
        step: 10,
      },

      // Props (Inspector) Panel — Section 5: 세부 색상 · 선 굵기 (collapsed by default)
      {
        id: 'white-map.oceanColor.inspector',
        kind: 'color',
        field: 'oceanColor',
        label: '바다 색상',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
      },
      {
        id: 'white-map.landColor.inspector',
        kind: 'color',
        field: 'landColor',
        label: '육지 색상',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
      },
      {
        id: 'white-map.highlightColor.inspector',
        kind: 'color',
        field: 'highlightColor',
        label: '강조 기본색',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
      },
      {
        id: 'white-map.inkColor.inspector',
        kind: 'color',
        field: 'inkColor',
        label: '먹선 · 글씨색',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
      },
      {
        id: 'white-map.coastWidth.inspector',
        kind: 'slider',
        field: 'coastWidth',
        label: '해안선 굵기 (0=기본)',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
        min: 0,
        max: 2.5,
        step: 0.1,
      },
      {
        id: 'white-map.borderDash.inspector',
        kind: 'segmented',
        field: 'borderDash',
        label: '국경 선종',
        section: '세부 색상 · 선 굵기',
        sectionCollapsed: true,
        placement: 'inspector',
        options: [
          { label: '기본', value: '' },
          { label: '실선', value: 'none' },
          { label: '파선', value: '4 3' },
          { label: '긴파선', value: '6 3.5' },
          { label: '점선', value: '1.5 2' },
        ],
      },
      {
        id: 'white-map.customCss.inspector',
        kind: 'text',
        field: 'customCss',
        label: '커스텀 --map-* CSS',
        section: '고급 CSS',
        sectionCollapsed: true,
        placement: 'inspector',
      },
    ],
    panels: [createStudioPanelSpec()],
  },
});

function getActiveSurface(context) {
  return context?.services?.get?.('canvas.active-tool-surface')?.get?.() ?? null;
}

function getSelectedMapIds(context, explicitEntityId) {
  if (typeof explicitEntityId === 'string' && explicitEntityId) {
    return context.world?.getCanonical?.(explicitEntityId, MAP_ASPECT_ID) ? [explicitEntityId] : [];
  }
  const selected = getActiveSurface(context)?.selection?.getSelection?.() ?? [];
  return selected.filter(id => Boolean(context.world?.getCanonical?.(id, MAP_ASPECT_ID)));
}

function withHistoryGroup(context, fn) {
  const history = getActiveSurface(context)?.host?.history;
  history?.begin?.();
  try {
    const result = fn();
    history?.commit?.();
    return result;
  } catch (error) {
    history?.abort?.();
    throw error;
  }
}

function readPreference(context, key, fallback) {
  try {
    const val = context?.services?.get?.('extensions.preferences')?.get?.(key);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function countMaps(world) {
  let n = 0;
  for (const id of world?.listEntityIds?.() ?? []) {
    if (world.isAlive && !world.isAlive(id)) continue;
    if (world.getCanonical?.(id, MAP_ASPECT_ID)) n++;
  }
  return n;
}

const plugin = {
  ...createPackageManifest(metadata),
  summary: metadata.summary,
  aspects: [whiteMapAspect],
  ui: {
    panels: [createStudioPanelSpec()],
  },
  activate(context) {
    const disposers = [];
    // Normalize old inline GeoJSON/deflate payloads once, including on document switch.
    // Never copy the payload to another canonical key or rewrite custom GIS layers.
    let disposed = false, queued = false;
    function migrate() {
      queued = false;
      if (disposed) return;
      const ops = [];
      for (const id of context.world?.listEntityIds?.() ?? []) {
        const props = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (isLegacyBake(props?.bakedDetail) && !context.world.isEntityReadOnly?.(id)) ops.push({id,aspect:MAP_ASPECT_ID,patch:{bakedDetail:true}});
      }
      if (ops.length) context.world.applyCanonicalTransaction(`${EXTENSION_ID}:migrate-bake-flag`, ops, 'bootstrap:migration');
    }
    function scheduleMigration() { if (!queued && !disposed) { queued = true; queueMicrotask(migrate); } }
    const unsubscribeMigration = context.world?.subscribe?.(scheduleMigration);
    disposers.push(() => { disposed = true; unsubscribeMigration?.(); });
    scheduleMigration();

    const insertMap = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
      const regionId = args.regionPreset ?? readPreference(context, 'defaultRegion', 'east-asia-oceania');
      const presetId = args.stylePreset ?? readPreference(context, 'defaultPreset', 'admin0-highlight');
      const mapProps = args.thematicId
        ? createMapPropsFromThematicPreset(args.thematicId)
        : createMapPropsForRegion(regionId, presetId);
      const region = getRegionPreset(mapProps.regionPreset);

      const count = countMaps(context.world);
      const hasX = Number.isFinite(args.x);
      const hasY = Number.isFinite(args.y);
      const x = hasX ? args.x : 80 + (count % 4) * 36;
      const y = hasY ? args.y : 80 + (count % 4) * 36;
      const width = Number.isFinite(args.width) && args.width > 0 ? Math.round(args.width) : (region.defaultSize?.width ?? DEFAULT_MAP_WIDTH);
      const height = Number.isFinite(args.height) && args.height > 0 ? Math.round(args.height) : (region.defaultSize?.height ?? DEFAULT_MAP_HEIGHT);

      const finalProps = syncFlatFields({
        ...mapProps,
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
        ...(typeof args.customCss === 'string' && !parseMapCss(args.customCss).error ? { customCss: args.customCss } : {}),
      });

      const creation = context?.services?.get?.('canvas.creation');
      if (creation && typeof creation.create === 'function') {
        return creation.create({
          caller: `${EXTENSION_ID}:insert-map`,
          ...(hasX ? { x } : {}),
          ...(hasY ? { y } : {}),
          width,
          height,
          aspects: { [MAP_ASPECT_ID]: finalProps },
        });
      }

      const id = typeof args.id === 'string' && args.id ? args.id : `white-map-${crypto.randomUUID()}`;
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:insert-map`, [
          { id, aspect: 'core.transform', patch: { x, y, rotation: 0 } },
          { id, aspect: 'core.bounds', patch: { width, height } },
          { id, aspect: MAP_ASPECT_ID, patch: finalProps },
        ]);
      });
      getActiveSurface(context)?.selection?.select?.(id);
      return id;
    };

    const updateViewport = (entityId, viewport) => {
      const targetIds = getSelectedMapIds(context, entityId);
      if (!targetIds.length || !viewport) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        const resolved = resolveMapSpec(current);
        const nextVp = { ...resolved.viewport, ...viewport };
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: syncFlatFields({ viewport: nextVp }),
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:update-viewport`, ops);
      });
      return targetIds;
    };

    const setRegion = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      const region = getRegionPreset(args.regionPreset);
      const ops = targetIds.map(id => ({
        id,
        aspect: MAP_ASPECT_ID,
        patch: syncFlatFields({
          regionPreset: region.id,
          projection: region.projection,
          viewport: { ...region.viewport },
          bakedDetail: false,
        }),
      }));
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:set-region`, ops);
      });
      return targetIds;
    };

    const applyPreset = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      const presetProps = createMapPropsFromThematicPreset(args.thematicId);
      const ops = targetIds.map(id => ({ id, aspect: MAP_ASPECT_ID, patch: presetProps }));
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:apply-preset`, ops);
      });
      return targetIds;
    };

    const updateStyle = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      if ('customCss' in args && parseMapCss(args.customCss).error) return null;

      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const patch = {};
        if (typeof args.title === 'string') patch.title = args.title;
        if (typeof args.stylePreset === 'string' && MAP_PRINT_PRESETS.some(p => p.id === args.stylePreset)) {
          patch.stylePreset = args.stylePreset;
        }
        if ('customCss' in args) patch.customCss = args.customCss;
        if (typeof args.projection === 'string') patch.projection = args.projection;
        if (args.baseLayers && typeof args.baseLayers === 'object') {
          patch.baseLayers = { ...resolved.baseLayers, ...args.baseLayers };
        }
        if (Array.isArray(args.highlights)) patch.highlights = args.highlights;
        if (args.inset && typeof args.inset === 'object') {
          patch.inset = { ...resolved.inset, ...args.inset };
        }
        if (args.legend && typeof args.legend === 'object') {
          patch.legend = { ...resolved.legend, ...args.legend };
        }
        if (typeof args.showLegend === 'boolean') {
          patch.showLegend = args.showLegend;
          patch.legend = { ...(patch.legend ?? resolved.legend), enabled: args.showLegend };
        }
        if (typeof args.showInset === 'boolean') {
          patch.showInset = args.showInset;
          patch.inset = { ...(patch.inset ?? resolved.inset), enabled: args.showInset };
        }
        const synced = syncFlatFields(patch);
        if (Object.keys(synced).length) ops.push({ id, aspect: MAP_ASPECT_ID, patch: synced });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:update-style`, ops);
        });
      }
      return targetIds;
    };

    const toggleLayer = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || typeof args.layer !== 'string') return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const nextLayers = { ...resolved.baseLayers, [args.layer]: !resolved.baseLayers[args.layer] };
        ops.push({ id, aspect: MAP_ASPECT_ID, patch: syncFlatFields({ baseLayers: nextLayers }) });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:toggle-layer`, ops);
        });
      }
      return targetIds;
    };

    const toggleHighlight = (entityId, level = 'admin0', code = '', slot = null) => {
      const targetIds = getSelectedMapIds(context, entityId);
      const cleanCode = String(code ?? '').trim();
      if (!targetIds.length || !cleanCode) return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const list = structuredClone(resolved.highlights);
        if (slot && typeof slot === 'object' && slot.id) {
          const matchesSlot = h => h.level === level && (
            h.slotId === slot.id
            || (!h.slotId && h.legendLabel === slot.legendLabel && h.fill === slot.fill && h.pattern === slot.pattern)
          );
          const sameSlotIdx = list.findIndex(h => matchesSlot(h) && h.codes.includes(cleanCode));
          if (sameSlotIdx >= 0) {
            list[sameSlotIdx].codes = list[sameSlotIdx].codes.filter(c => c !== cleanCode);
            if (list[sameSlotIdx].codes.length === 0) list.splice(sameSlotIdx, 1);
          } else {
            for (let i = list.length - 1; i >= 0; i--) {
              if (list[i].level === level && list[i].codes.includes(cleanCode)) {
                list[i].codes = list[i].codes.filter(c => c !== cleanCode);
                if (list[i].codes.length === 0) list.splice(i, 1);
              }
            }
            const targetIdx = list.findIndex(matchesSlot);
            if (targetIdx >= 0) {
              list[targetIdx].slotId = slot.id;
              list[targetIdx].codes = [...list[targetIdx].codes, cleanCode];
            } else {
              list.push({
                slotId: slot.id,
                level,
                codes: [cleanCode],
                fill: slot.fill || resolved.style.highlight,
                pattern: slot.pattern || 'none',
                legendLabel: slot.legendLabel ?? '',
              });
            }
          }
          const hasLabeled = list.some(h => Boolean(h.legendLabel));
          ops.push({
            id,
            aspect: MAP_ASPECT_ID,
            patch: syncFlatFields({
              highlights: list,
              ...(hasLabeled ? { legend: { ...resolved.legend, enabled: true } } : {}),
            }),
          });
        } else {
          const containing = list.findIndex(h => h.level === level && h.codes.includes(cleanCode));
          const idx = containing >= 0 ? containing : list.findIndex(h => h.level === level);
          if (idx >= 0) {
            const exists = list[idx].codes.includes(cleanCode);
            list[idx].codes = exists
              ? list[idx].codes.filter(c => c !== cleanCode)
              : [...list[idx].codes, cleanCode];
            if (list[idx].codes.length === 0) list.splice(idx, 1);
          } else {
            list.push({ level, codes: [cleanCode], fill: resolved.style.highlight, pattern: 'none', legendLabel: '' });
          }
          ops.push({ id, aspect: MAP_ASPECT_ID, patch: { highlights: list } });
        }
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:toggle-highlight`, ops);
        });
      }
      return targetIds;
    };

    const updateHighlight = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : {};
      if (!targetIds.length || !Number.isInteger(args.index)) return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const list = structuredClone(resolved.highlights);
        if (args.index < 0 || args.index >= list.length) continue;
        const item = list[args.index];
        if (typeof patch.legendLabel === 'string') item.legendLabel = patch.legendLabel;
        if (typeof patch.fill === 'string' && patch.fill) item.fill = patch.fill;
        if (['none', 'hatch', 'crosshatch', 'stipple'].includes(patch.pattern)) item.pattern = patch.pattern;
        if (Array.isArray(patch.codes)) item.codes = patch.codes.map(c => String(c).trim()).filter(Boolean);
        const enableLegend = typeof patch.legendLabel === 'string' && patch.legendLabel.trim().length > 0;
        ops.push({
          id,
          aspect: MAP_ASPECT_ID,
          patch: syncFlatFields({
            highlights: list,
            ...(enableLegend ? { legend: { ...resolved.legend, enabled: true } } : {}),
          }),
        });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:update-highlight`, ops);
        });
      }
      return targetIds;
    };

    const removeHighlight = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !Number.isInteger(args.index)) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        const list = [...(current?.highlights ?? [])];
        list.splice(args.index, 1);
        return { id, aspect: MAP_ASPECT_ID, patch: { highlights: list } };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:remove-highlight`, ops);
      });
      return targetIds;
    };

    const addCustomLayer = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !args.layer) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        const resolved = resolveMapSpec(current);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: syncFlatFields({
            customLayers: [...(current?.customLayers ?? []), args.layer],
            legend: { ...resolved.legend, enabled: true },
          }),
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:add-custom-layer`, ops);
      });
      return targetIds;
    };

    const addCustomPoint = (entityId, lon, lat, marker = 'bullseye') => {
      const targetIds = getSelectedMapIds(context, entityId);
      if (!targetIds.length || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const layerId = `user-points-${marker}`;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        const layers = structuredClone(current?.customLayers ?? []);
        const feat = { type: 'Feature', properties: { name: '' }, geometry: { type: 'Point', coordinates: [lon, lat] } };
        const existing = layers.find(l => l.id === layerId);
        if (existing?.geojson?.features) {
          existing.geojson.features.push(feat);
        } else {
          layers.push({
            id: layerId,
            name: '지점 마커',
            kind: 'point',
            visible: true,
            showInLegend: false,
            style: { stroke: '#171717', fill: '#ffffff', strokeWidth: marker === 'ring' ? 2.6 : 1.4, marker },
            geojson: { type: 'FeatureCollection', features: [feat] },
          });
        }
        return { id, aspect: MAP_ASPECT_ID, patch: { customLayers: layers } };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:add-custom-point`, ops);
      });
      return targetIds;
    };

    const updateCustomLayer = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : {};
      if (!targetIds.length || !args.layerId) return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const layers = structuredClone(current.customLayers ?? []).map(layer => {
          if (layer.id !== args.layerId) return layer;
          return {
            ...layer,
            ...(typeof patch.visible === 'boolean' ? { visible: patch.visible } : {}),
            ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
            ...(typeof patch.showInLegend === 'boolean' ? { showInLegend: patch.showInLegend } : {}),
            ...(patch.style && typeof patch.style === 'object' ? { style: { ...(layer.style ?? {}), ...patch.style } } : {}),
          };
        });
        ops.push({ id, aspect: MAP_ASPECT_ID, patch: { customLayers: layers } });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:update-custom-layer`, ops);
        });
      }
      return targetIds;
    };

    const removeCustomLayer = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !args.layerId) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: { customLayers: (current?.customLayers ?? []).filter(l => l.id !== args.layerId) },
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:remove-custom-layer`, ops);
      });
      return targetIds;
    };

    const addAnnotation = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !args.annotation) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: { annotations: [...(current?.annotations ?? []), args.annotation] },
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:add-annotation`, ops);
      });
      return targetIds;
    };

    const updateAnnotation = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : {};
      if (!targetIds.length || !args.annotationId) return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const nextAnns = resolved.annotations.map(ann => {
          if (ann.id !== args.annotationId) return ann;
          return {
            ...ann,
            ...(typeof patch.text === 'string' && patch.text.trim() ? { text: patch.text.trim() } : {}),
            ...(typeof patch.leaderLine === 'boolean' ? { leaderLine: patch.leaderLine } : {}),
            ...(typeof patch.halo === 'boolean' ? { halo: patch.halo } : {}),
            ...(Number.isFinite(patch.dx) ? { dx: Math.round(patch.dx) } : {}),
            ...(Number.isFinite(patch.dy) ? { dy: Math.round(patch.dy) } : {}),
            ...(Number.isFinite(patch.lon) ? { lon: patch.lon } : {}),
            ...(Number.isFinite(patch.lat) ? { lat: patch.lat } : {}),
          };
        });
        ops.push({ id, aspect: MAP_ASPECT_ID, patch: { annotations: nextAnns } });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:update-annotation`, ops);
        });
      }
      return targetIds;
    };

    const removeAnnotation = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !args.annotationId) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: { annotations: (current?.annotations ?? []).filter(a => a.id !== args.annotationId) },
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:remove-annotation`, ops);
      });
      return targetIds;
    };

    const bakeHighRes = async (rawArgs = {}) => {
      const args = typeof rawArgs === 'string' ? { entityId: rawArgs } : (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return { ok: false, error: '선택된 백지도가 없습니다.' };
      const id = targetIds[0];
      const current = context.world.getCanonical(id, MAP_ASPECT_ID);
      if (!current) return { ok: false, error: '백지도 속성을 찾지 못했습니다.' };
      const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
      const resolved = resolveMapSpec(current);
      if (!isDeepZoomScale(resolved.viewport.scale)) return {ok:false, error:'지도를 더 확대한 뒤 정밀 경계를 가져오세요.'};
      const {frameW:w,frameH:h}=frameLayout(bounds.width || DEFAULT_MAP_WIDTH,bounds.height || DEFAULT_MAP_HEIGHT,resolved,true);
      const proj = createMapProjection(resolved.projection,resolved.viewport,w,h);
      const bbox = computeViewportBbox(proj,w,h,true);

      const cached = cachedBake(bbox,resolved.viewport.scale,resolved.baseLayers);
      const snapshot = cached ?? await loadBake(bbox,resolved.viewport.scale,resolved.baseLayers,args.fetcher);
      if (context.world.getCanonical(id, MAP_ASPECT_ID) !== current || context.world.isEntityReadOnly?.(id)) return {ok:false,error:'지도가 변경되어 베이크 적용을 취소했습니다.'};
      if (current.bakedDetail !== true) withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:bake-high-res`, [{ id, aspect: MAP_ASPECT_ID, patch: { bakedDetail: true } }]);
      });
      return { ok:true, id, reused:!!cached, featureCount:snapshot.featureCount, bbox };
    };

    const toggleAutoDetail = (rawArgs = {}) => {
      const args = typeof rawArgs === 'string' ? { entityId: rawArgs } : (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return { ok: false, error: '선택된 백지도가 없습니다.' };
      const id = targetIds[0];
      const current = context.world.getCanonical(id, MAP_ASPECT_ID);
      if (!current) return { ok: false, error: '백지도 속성을 찾지 못했습니다.' };
      const resolved = resolveMapSpec(current);
      if (resolved.bakeEnabled) {
        clearBaked({ entityId: id });
        return { ok: true, id, enabled: false };
      }
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:toggle-auto-detail`, [{ id, aspect: MAP_ASPECT_ID, patch: { bakedDetail: true } }]);
      });
      if (!isDeepZoomScale(resolved.viewport.scale)) {
        return { ok: true, id, enabled: true, deferred: true };
      }
      if (args.fetcher) {
        const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
        const { frameW: w, frameH: h } = frameLayout(bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT, resolved, true);
        const proj = createMapProjection(resolved.projection, resolved.viewport, w, h);
        const bbox = computeViewportBbox(proj, w, h, true);
        return loadBake(bbox, resolved.viewport.scale, resolved.baseLayers, args.fetcher)
          .then(s => ({ ok: true, id, enabled: true, featureCount: s.featureCount, bbox }));
      }
      return { ok: true, id, enabled: true };
    };

    const clearBaked = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(
          `${EXTENSION_ID}:clear-baked`,
          targetIds.map(id => ({ id, aspect: MAP_ASPECT_ID, patch: { bakedDetail: false } })),
        );
      });
      return targetIds;
    };

    const resetViewport = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        const region = getRegionPreset(current?.regionPreset);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: syncFlatFields({ viewport: { ...region.viewport }, bakedDetail: false }),
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:reset-viewport`, ops);
      });
      return targetIds;
    };

    const commitDragOffset = (entityId, kind, dx, dy) => {
      const current = context.world.getCanonical?.(entityId, MAP_ASPECT_ID);
      if (!current) return;
      const resolved = resolveMapSpec(current);
      if (kind === 'legend') {
        const prev = normalizeOffset(resolved.legend.offset);
        updateStyle({ entityId, legend: { ...resolved.legend, offset: { x: prev.x + dx, y: prev.y + dy } } });
      } else if (kind === 'inset') {
        const prev = normalizeOffset(resolved.inset.offset);
        updateStyle({ entityId, inset: { ...resolved.inset, offset: { x: prev.x + dx, y: prev.y + dy } } });
      } else if (kind.startsWith('ann-anchor:')) {
        const annId = kind.slice('ann-anchor:'.length);
        const bounds = context.world.getCanonical(entityId, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
        const { frameW, frameH } = frameLayout(bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT, resolved);
        const proj = createMapProjection(resolved.projection, resolved.viewport, frameW, frameH);
        const nextAnns = resolved.annotations.map(a => {
          if (a.id !== annId) return a;
          const pt = proj([a.lon, a.lat]);
          if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return a;
          const ll = proj.invert?.([pt[0] + dx, pt[1] + dy]);
          if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return a;
          const nextDx = Math.round(a.dx - dx);
          const nextDy = Math.round(a.dy - dy);
          return {
            ...a,
            lon: Math.round(ll[0] * 10000) / 10000,
            lat: Math.round(ll[1] * 10000) / 10000,
            dx: nextDx,
            dy: nextDy,
            leaderLine: a.leaderLine || Math.hypot(nextDx, nextDy) >= 6,
          };
        });
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:move-annotation-anchor`, [
            { id: entityId, aspect: MAP_ASPECT_ID, patch: { annotations: nextAnns } },
          ]);
        });
      } else if (kind.startsWith('annotation:')) {
        const annId = kind.slice('annotation:'.length);
        const nextAnns = resolved.annotations.map(a =>
          a.id === annId ? { ...a, dx: Math.round(a.dx + dx), dy: Math.round(a.dy + dy) } : a,
        );
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:move-annotation`, [
            { id: entityId, aspect: MAP_ASPECT_ID, patch: { annotations: nextAnns } },
          ]);
        });
      }
    };

    let menubar = null;
    const explorer = mountMapExplorer(context, {
      useExternalHud: true,
      commitViewport: (id, vp) => updateViewport(id, vp),
      toggleHighlight: (id, level, code) => toggleHighlight(id, level, code),
      bakeHighRes: id => bakeHighRes({ entityId: id }),
      onExploreChange: () => menubar?.refresh?.(),
    });
    menubar = mountMapMenubar(context, {
      enterExplore: id => explorer.enter(id),
      exitExplore: commit => explorer.exit(commit),
      getExploringId: () => explorer.getActiveId(),
      getExploringViewport: () => explorer.getActiveViewport(),
      bakeFromExplore: async id => {
        const vp = explorer.getActiveViewport();
        if (vp) updateViewport(id, vp);
        return bakeHighRes({ entityId: id });
      },
      addAnnotation: (entityId, annotation) => addAnnotation({ entityId, annotation }),
      updateAnnotation: (entityId, annotationId, patch) => updateAnnotation({ entityId, annotationId, patch }),
      addCustomPoint: (entityId, lon, lat, marker) => addCustomPoint(entityId, lon, lat, marker),
      addCustomLayer: (entityId, layer) => addCustomLayer({ entityId, layer }),
      toggleHighlight: (entityId, level, code) => toggleHighlight(entityId, level, code),
      toggleHighlightSlot: (entityId, level, code, slot) => toggleHighlight(entityId, level, code, slot),
      toggleLayer: (entityId, layer) => toggleLayer({ entityId, layer }),
      toggleLegend: entityId => {
        const cur = context.world.getCanonical(entityId, MAP_ASPECT_ID);
        if (!cur) return;
        const resolved = resolveMapSpec(cur);
        updateStyle({ entityId, showLegend: !resolved.legend.enabled });
      },
      toggleInset: entityId => {
        const cur = context.world.getCanonical(entityId, MAP_ASPECT_ID);
        if (!cur) return;
        const resolved = resolveMapSpec(cur);
        updateStyle({ entityId, showInset: !resolved.inset.enabled });
      },
      toggleAutoDetail: entityId => toggleAutoDetail({ entityId }),
      bakeHighRes: entityId => bakeHighRes({ entityId }),
    });
    disposers.push(() => menubar.dispose());
    disposers.push(() => explorer.dispose());
    disposers.push(mountMapGizmos(context, { commitDragOffset }));

    const runCommand = (name, rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      switch (name) {
        case 'insert-map': return insertMap(args);
        case 'explore-map': {
          const targetId = getSelectedMapIds(context, args.entityId)[0];
          menubar.clearTool();
          return targetId ? explorer.enter(targetId) : false;
        }
        case 'set-region': return setRegion(args);
        case 'apply-preset': return applyPreset(args);
        case 'update-style': return updateStyle(args);
        case 'update-viewport': return updateViewport(args.entityId, args.viewport);
        case 'toggle-layer': return toggleLayer(args);
        case 'toggle-highlight': return toggleHighlight(args.entityId, args.level, args.code, args.slot ?? null);
        case 'update-highlight': return updateHighlight(args);
        case 'remove-highlight': return removeHighlight(args);
        case 'add-custom-layer': return addCustomLayer(args);
        case 'update-custom-layer': return updateCustomLayer(args);
        case 'add-custom-point': return addCustomPoint(args.entityId, args.lon, args.lat, args.marker);
        case 'remove-custom-layer': return removeCustomLayer(args);
        case 'add-annotation': return addAnnotation(args);
        case 'update-annotation': return updateAnnotation(args);
        case 'remove-annotation': return removeAnnotation(args);
        case 'start-tool': {
          const targetId = getSelectedMapIds(context, args.entityId)[0];
          if (targetId && args.mode) {
            explorer.exit(true);
            menubar.startTool(targetId, args.mode);
            return true;
          }
          return false;
        }
        case 'toggle-auto-detail': return toggleAutoDetail(args);
        case 'bake-high-res': return bakeHighRes(args);
        case 'clear-baked': return clearBaked(args);
        case 'reset-viewport': return resetViewport(args);
        default: return null;
      }
    };

    try {
      disposers.push(registerWhiteMapTools(context));
      for (const name of COMMAND_NAMES) {
        const off = context.commands?.register?.({
          id: `${EXTENSION_ID}:${name}`,
          title: COMMAND_LABELS[name] ?? name,
          summary: COMMAND_LABELS[name] ?? name,
          shortcutScope: 'canvas',
          run: args => runCommand(name, args),
        });
        if (typeof off === 'function') disposers.push(off);
      }
    } catch (error) {
      for (const d of disposers.reverse()) {
        try { d(); } catch {}
      }
      throw error;
    }

    return {
      api: Object.freeze({
        run: runCommand,
        insertMap,
        setRegion,
        applyPreset,
        updateStyle,
        updateViewport,
        toggleLayer,
        toggleHighlight,
        updateHighlight,
        removeHighlight,
        addCustomLayer,
        updateCustomLayer,
        addCustomPoint,
        removeCustomLayer,
        addAnnotation,
        updateAnnotation,
        removeAnnotation,
        toggleAutoDetail,
        bakeHighRes,
        clearBaked,
        resetViewport,
        explorer,
        menubar,
      }),
      dispose() {
        releaseOfflineBaseGis();
        clearBakeSession();
        for (const d of disposers.splice(0).reverse()) {
          try { d(); } catch {}
        }
      },
    };
  },
};

export default plugin;
export {
  COMMAND_NAMES,
  EXTENSION_ID,
  HIGHLIGHT_SLOTS,
  MAP_ASPECT_ID,
  MAP_DEFAULTS,
  MAP_PRINT_PRESETS,
  REGION_PRESETS,
  STUDIO_PANEL_ID,
  THEMATIC_PRESETS,
  bakeHighResSnapshot,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  createPackageManifest,
  deriveMapGeometry,
  getOfflineBaseGis,
  mountMapExplorer,
  mountMapGizmos,
  mountMapMenubar,
  parseCustomGisInput,
  parseMapCss,
  planWhiteMapChanges,
  registerWhiteMapTools,
  renderMapDom,
  renderMapSvg,
  resolveMapSpec,
  resolveMapStyle,
  settingsSchema,
  syncFlatFields,
  whiteMapAspect,
};
