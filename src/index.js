import metadata from '../extension.json' with { type: 'json' };
import { REGION_PRESETS, getRegionPreset } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { renderMapDom } from './dom-renderer.js';
import { cmuSvgDefs } from './fonts.js';
import { computeViewportBbox, createMapProjection, getOfflineBaseGis } from './gis-base.js';
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
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAP_DEFAULTS,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  deriveMapGeometry,
  normalizeOffset,
  parseCustomGisInput,
  resolveMapSpec,
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

const QUICK_REGION_OPTIONS = Object.freeze([
  { label: '세계', value: 'world-pacific' },
  { label: '동아시아', value: 'east-asia-oceania' },
  { label: '동북3성', value: 'northeast-china' },
  { label: '한반도', value: 'korea' },
  { label: '유럽', value: 'europe' },
  { label: '페마른', value: 'denmark-germany' },
]);

const QUICK_PRESET_OPTIONS = Object.freeze(
  MAP_PRINT_PRESETS.map(p => ({ label: p.name.split(' · ')[0], value: p.id })),
);

const COMMAND_LABELS = Object.freeze({
  'insert-map': '수능 백지도 추가',
  'explore-map': '지도 프레임 탐색 (더블클릭)',
  'set-region': '백지도 지역 프리셋 전환',
  'apply-preset': '수능 백지도 예제 프리셋 적용',
  'update-style': '백지도 스타일·CSS·옵션 변경',
  'update-viewport': '백지도 중심·배율 갱신',
  'toggle-layer': '백지도 기본 레이어 토글',
  'toggle-highlight': '국가·행정구역 강조 토글',
  'add-custom-layer': '커스텀 GIS 레이어 추가',
  'remove-custom-layer': '커스텀 GIS 레이어 삭제',
  'add-annotation': '지시선 라벨 추가',
  'bake-high-res': '10m 고해상도 CDN 스냅샷 베이크',
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
      {
        id: 'white-map.insert.shelf',
        kind: 'action',
        label: '수능 백지도 추가',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:insert-map`,
        placement: 'tool-shelf',
        requiresSelection: false,
      },
      {
        id: 'white-map.explore.selection',
        kind: 'action',
        label: '지도 탐색',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:explore-map`,
        placement: 'selection-bar',
        requiresSelection: true,
      },
      {
        id: 'white-map.preset.selection',
        kind: 'segmented',
        field: 'stylePreset',
        label: '인쇄 스타일',
        placement: 'selection-bar',
        options: QUICK_PRESET_OPTIONS,
      },
      {
        id: 'white-map.bake.selection',
        kind: 'action',
        label: '10m 베이크',
        icon: MAP_ICON,
        commandSymbol: `${EXTENSION_ID}:bake-high-res`,
        placement: 'selection-bar',
        requiresSelection: true,
      },
      {
        id: 'white-map.title.inspector',
        kind: 'text',
        field: 'title',
        label: '제목',
        section: '백지도 기본',
        placement: 'inspector',
      },
      {
        id: 'white-map.region.inspector',
        kind: 'segmented',
        field: 'regionPreset',
        label: '빠른 지역 전환',
        section: '백지도 기본',
        placement: 'inspector',
        options: QUICK_REGION_OPTIONS,
      },
      {
        id: 'white-map.preset.inspector',
        kind: 'segmented',
        field: 'stylePreset',
        label: '수능 인쇄 스타일',
        section: '인쇄 스타일',
        placement: 'inspector',
        options: QUICK_PRESET_OPTIONS,
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

      const finalProps = {
        ...mapProps,
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
        ...(typeof args.customCss === 'string' && !parseMapCss(args.customCss).error ? { customCss: args.customCss } : {}),
      };

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
        return { id, aspect: MAP_ASPECT_ID, patch: { viewport: { ...(current?.viewport ?? {}), ...viewport } } };
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
        patch: {
          regionPreset: region.id,
          projection: region.projection,
          viewport: { ...region.viewport },
          bakedDetail: null,
        },
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
        const patch = {};
        if (typeof args.title === 'string') patch.title = args.title;
        if (typeof args.stylePreset === 'string' && MAP_PRINT_PRESETS.some(p => p.id === args.stylePreset)) {
          patch.stylePreset = args.stylePreset;
        }
        if ('customCss' in args) patch.customCss = args.customCss;
        if (typeof args.projection === 'string') patch.projection = args.projection;
        if (args.baseLayers && typeof args.baseLayers === 'object') patch.baseLayers = { ...(current.baseLayers ?? {}), ...args.baseLayers };
        if (Array.isArray(args.highlights)) patch.highlights = args.highlights;
        if (args.inset && typeof args.inset === 'object') patch.inset = { ...(current.inset ?? {}), ...args.inset };
        if (args.legend && typeof args.legend === 'object') patch.legend = { ...(current.legend ?? {}), ...args.legend };
        if (Object.keys(patch).length) ops.push({ id, aspect: MAP_ASPECT_ID, patch });
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
        ops.push({
          id,
          aspect: MAP_ASPECT_ID,
          patch: { baseLayers: { ...resolved.baseLayers, [args.layer]: !resolved.baseLayers[args.layer] } },
        });
      }
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:toggle-layer`, ops);
        });
      }
      return targetIds;
    };

    const toggleHighlight = (entityId, level = 'admin0', code = '') => {
      const targetIds = getSelectedMapIds(context, entityId);
      const cleanCode = String(code ?? '').trim();
      if (!targetIds.length || !cleanCode) return null;
      const ops = [];
      for (const id of targetIds) {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        if (!current) continue;
        const resolved = resolveMapSpec(current);
        const list = structuredClone(resolved.highlights);
        const idx = list.findIndex(h => h.level === level);
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
      if (ops.length) {
        withHistoryGroup(context, () => {
          context.world.applyCanonicalTransaction(`${EXTENSION_ID}:toggle-highlight`, ops);
        });
      }
      return targetIds;
    };

    const addCustomLayer = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length || !args.layer) return null;
      const ops = targetIds.map(id => {
        const current = context.world.getCanonical(id, MAP_ASPECT_ID);
        return {
          id,
          aspect: MAP_ASPECT_ID,
          patch: {
            customLayers: [...(current?.customLayers ?? []), args.layer],
            legend: { ...(current?.legend ?? {}), enabled: true },
          },
        };
      });
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:add-custom-layer`, ops);
      });
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

    const bakeHighRes = async (rawArgs = {}) => {
      const args = typeof rawArgs === 'string' ? { entityId: rawArgs } : (rawArgs && typeof rawArgs === 'object' ? rawArgs : {});
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return { ok: false, error: '선택된 백지도가 없습니다.' };
      const id = targetIds[0];
      const current = context.world.getCanonical(id, MAP_ASPECT_ID);
      if (!current) return { ok: false, error: '백지도 속성을 찾지 못했습니다.' };
      const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
      const resolved = resolveMapSpec(current);
      const proj = createMapProjection(resolved.projection, resolved.viewport, bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT);
      const bbox = computeViewportBbox(proj, bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT);

      const snapshot = await bakeHighResSnapshot({
        bbox,
        layers: resolved.baseLayers,
        scale: resolved.viewport.scale,
        fetcher: args.fetcher ?? globalThis.fetch,
      });

      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(`${EXTENSION_ID}:bake-high-res`, [
          { id, aspect: MAP_ASPECT_ID, patch: { bakedDetail: snapshot } },
        ]);
      });
      return { ok: true, id, featureCount: snapshot.featureCount, bbox: snapshot.bbox };
    };

    const clearBaked = (rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      const targetIds = getSelectedMapIds(context, args.entityId);
      if (!targetIds.length) return null;
      withHistoryGroup(context, () => {
        context.world.applyCanonicalTransaction(
          `${EXTENSION_ID}:clear-baked`,
          targetIds.map(id => ({ id, aspect: MAP_ASPECT_ID, patch: { bakedDetail: null } })),
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
        return { id, aspect: MAP_ASPECT_ID, patch: { viewport: { ...region.viewport }, bakedDetail: null } };
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

    const explorer = mountMapExplorer(context, {
      commitViewport: (id, vp) => updateViewport(id, vp),
      toggleHighlight: (id, level, code) => toggleHighlight(id, level, code),
      bakeHighRes: id => bakeHighRes({ entityId: id }),
    });
    disposers.push(() => explorer.dispose());
    disposers.push(mountMapGizmos(context, { commitDragOffset }));

    const runCommand = (name, rawArgs = {}) => {
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
      switch (name) {
        case 'insert-map': return insertMap(args);
        case 'explore-map': {
          const targetId = getSelectedMapIds(context, args.entityId)[0];
          return targetId ? explorer.enter(targetId) : false;
        }
        case 'set-region': return setRegion(args);
        case 'apply-preset': return applyPreset(args);
        case 'update-style': return updateStyle(args);
        case 'update-viewport': return updateViewport(args.entityId, args.viewport);
        case 'toggle-layer': return toggleLayer(args);
        case 'toggle-highlight': return toggleHighlight(args.entityId, args.level, args.code);
        case 'add-custom-layer': return addCustomLayer(args);
        case 'remove-custom-layer': return removeCustomLayer(args);
        case 'add-annotation': return addAnnotation(args);
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
        addCustomLayer,
        removeCustomLayer,
        addAnnotation,
        bakeHighRes,
        clearBaked,
        resetViewport,
        explorer,
      }),
      dispose() {
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
  parseCustomGisInput,
  parseMapCss,
  planWhiteMapChanges,
  registerWhiteMapTools,
  renderMapDom,
  renderMapSvg,
  resolveMapSpec,
  resolveMapStyle,
  settingsSchema,
  whiteMapAspect,
};
