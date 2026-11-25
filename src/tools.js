import { COUNTRY_NAMES_KO, REGION_PRESETS } from './catalog.js';
import { THEMATIC_PRESETS } from './data/gis-presets.js';
import { EXTENSION_ID, MAP_ASPECT_ID } from './manifest.js';
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  resolveMapSpec,
} from './model.js';
import { MAP_PRINT_PRESETS, parseMapCss } from './print-style.js';

function isRecord(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Pure planner producing Alid canonical operations for approval via prepareChange.
 * Never mutates the world directly.
 */
export function planWhiteMapChanges(world, actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions 배열에 최소 1개 이상의 작업을 전달하세요.');
  }
  const ops = [];
  const summary = [];

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    if (!isRecord(act) || typeof act.action !== 'string') {
      throw new Error(`actions[${i}]는 action 필드가 있는 객체여야 합니다.`);
    }

    if (act.action === 'create') {
      const id = typeof act.id === 'string' && act.id.trim() ? act.id.trim() : `white-map-${crypto.randomUUID()}`;
      const patchIn = isRecord(act.patch) ? act.patch : {};
      const base = patchIn.thematicId
        ? createMapPropsFromThematicPreset(patchIn.thematicId)
        : createMapPropsForRegion(patchIn.regionPreset || 'east-asia-oceania', patchIn.stylePreset || 'admin0-highlight');

      if (patchIn.customCss !== undefined && parseMapCss(patchIn.customCss).error) {
        throw new Error(`actions[${i}] customCss 오류: ${parseMapCss(patchIn.customCss).error}`);
      }

      const mapProps = {
        ...base,
        ...(typeof patchIn.title === 'string' ? { title: patchIn.title } : {}),
        ...(patchIn.projection ? { projection: patchIn.projection } : {}),
        ...(isRecord(patchIn.viewport) ? { viewport: { ...base.viewport, ...patchIn.viewport } } : {}),
        ...(patchIn.stylePreset ? { stylePreset: patchIn.stylePreset } : {}),
        ...(typeof patchIn.customCss === 'string' ? { customCss: patchIn.customCss } : {}),
        ...(isRecord(patchIn.baseLayers) ? { baseLayers: { ...base.baseLayers, ...patchIn.baseLayers } } : {}),
        ...(Array.isArray(patchIn.highlights) ? { highlights: patchIn.highlights } : {}),
        ...(Array.isArray(patchIn.customLayers) ? { customLayers: patchIn.customLayers } : {}),
        ...(Array.isArray(patchIn.annotations) ? { annotations: patchIn.annotations } : {}),
        ...(isRecord(patchIn.inset) ? { inset: { ...base.inset, ...patchIn.inset } } : {}),
        ...(isRecord(patchIn.legend) ? { legend: { ...base.legend, ...patchIn.legend } } : {}),
      };

      const x = Number.isFinite(act.x) ? act.x : 80 + i * 32;
      const y = Number.isFinite(act.y) ? act.y : 80 + i * 32;
      const width = Number.isFinite(act.width) && act.width > 0 ? Math.round(act.width) : DEFAULT_MAP_WIDTH;
      const height = Number.isFinite(act.height) && act.height > 0 ? Math.round(act.height) : DEFAULT_MAP_HEIGHT;

      ops.push(
        { id, aspect: 'core.transform', patch: { x, y, rotation: 0 } },
        { id, aspect: 'core.bounds', patch: { width, height } },
        { id, aspect: MAP_ASPECT_ID, patch: mapProps },
      );
      summary.push(`create:${id}`);
      continue;
    }

    if (act.action === 'update') {
      const id = String(act.id ?? '').trim();
      const current = id ? world?.getCanonical?.(id, MAP_ASPECT_ID) : null;
      if (!current) throw new Error(`수정할 백지도를 찾지 못했습니다: ${id}`);
      const patchIn = isRecord(act.patch) ? act.patch : {};
      if (patchIn.customCss !== undefined && parseMapCss(patchIn.customCss).error) {
        throw new Error(`actions[${i}] customCss 오류: ${parseMapCss(patchIn.customCss).error}`);
      }
      const next = {
        ...patchIn,
        ...(isRecord(patchIn.viewport) ? { viewport: { ...(current.viewport ?? {}), ...patchIn.viewport } } : {}),
        ...(isRecord(patchIn.baseLayers) ? { baseLayers: { ...(current.baseLayers ?? {}), ...patchIn.baseLayers } } : {}),
        ...(isRecord(patchIn.inset) ? { inset: { ...(current.inset ?? {}), ...patchIn.inset } } : {}),
        ...(isRecord(patchIn.legend) ? { legend: { ...(current.legend ?? {}), ...patchIn.legend } } : {}),
      };
      ops.push({ id, aspect: MAP_ASPECT_ID, patch: next });
      summary.push(`update:${id}`);
      continue;
    }

    if (act.action === 'move') {
      const id = String(act.id ?? '').trim();
      if (!world?.getCanonical?.(id, MAP_ASPECT_ID)) throw new Error(`이동할 백지도를 찾지 못했습니다: ${id}`);
      if (Number.isFinite(act.x) || Number.isFinite(act.y)) {
        const curT = world.getCanonical(id, 'core.transform') ?? { x: 0, y: 0, rotation: 0 };
        ops.push({
          id,
          aspect: 'core.transform',
          patch: { x: Number.isFinite(act.x) ? act.x : curT.x, y: Number.isFinite(act.y) ? act.y : curT.y, rotation: curT.rotation ?? 0 },
        });
      }
      if (Number.isFinite(act.width) || Number.isFinite(act.height)) {
        const curB = world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
        ops.push({
          id,
          aspect: 'core.bounds',
          patch: {
            width: Number.isFinite(act.width) && act.width > 0 ? Math.round(act.width) : curB.width,
            height: Number.isFinite(act.height) && act.height > 0 ? Math.round(act.height) : curB.height,
          },
        });
      }
      summary.push(`move:${id}`);
      continue;
    }

    if (act.action === 'delete') {
      const id = String(act.id ?? '').trim();
      if (!world?.getCanonical?.(id, MAP_ASPECT_ID)) throw new Error(`삭제할 백지도를 찾지 못했습니다: ${id}`);
      ops.push({ id, aspect: MAP_ASPECT_ID, patch: null });
      summary.push(`delete:${id}`);
      continue;
    }

    throw new Error(`지원하지 않는 action입니다: ${act.action}`);
  }

  return { ops, summary };
}

export function registerWhiteMapTools(context) {
  const tools = context?.services?.get?.('workspace.tools');
  if (!tools || typeof tools.register !== 'function') return () => {};
  const disposers = [];

  const registerTool = (name, description, properties, required, execute) => {
    disposers.push(
      tools.register({
        id: `${EXTENSION_ID}:${name}`,
        description,
        inputSchema: { type: 'object', properties, required },
        execute: async (input, meta) => {
          meta?.signal?.throwIfAborted?.();
          return execute(input ?? {});
        },
      }),
    );
  };

  try {
    if (typeof tools.registerDescriptor === 'function') {
      disposers.push(
        tools.registerDescriptor({
          aspect: MAP_ASPECT_ID,
          description:
            '수능·지리 백지도 도형. 생성·수정·이동·삭제는 반드시 plan-changes 도구를 통해 사용자 승인 제안(prepareChange)으로만 수행하세요.',
          fields: {
            regionPreset: `지역 프리셋: ${REGION_PRESETS.map(r => r.id).join(', ')}`,
            stylePreset: `수능 인쇄 프리셋: ${MAP_PRINT_PRESETS.map(p => p.id).join(', ')}`,
            projection: 'mercator | naturalEarth1 | conicEqualArea | equirectangular',
            viewport: '{ centerLon, centerLat, scale, rotateLon }',
            baseLayers: '{ coastline, borders, admin1, rivers, lakes, graticule }',
            highlights: 'Array<{ level: "admin0"|"admin1", codes: string[], fill, pattern, legendLabel }>',
            customLayers: 'Array<{ id, name, kind: "polygon"|"line"|"point", style, geojson }>',
            annotations: 'Array<{ id, lon, lat, text, dx, dy, leaderLine, halo }>',
            customCss: '--map-ocean / land / ink / coast / border / admin1 / river / border-dash / font 선언 문자열',
          },
        }),
      );
    }

    registerTool(
      'catalog',
      '수능 백지도 지역 프리셋, 인쇄 스타일 프리셋, 주제도 템플릿 및 국가 코드 조회 (읽기 전용).',
      {},
      [],
      () => ({
        regions: REGION_PRESETS.map(r => ({ id: r.id, nameKo: r.nameKo, projection: r.projection, viewport: r.viewport })),
        stylePresets: MAP_PRINT_PRESETS.map(p => ({ id: p.id, name: p.name, note: p.note })),
        thematicPresets: THEMATIC_PRESETS.map(t => ({ id: t.id, name: t.name, summary: t.summary })),
        countryCodes: COUNTRY_NAMES_KO,
      }),
    );

    registerTool(
      'search',
      '캔버스에 배치된 수능 백지도 엔티티를 검색합니다 (읽기 전용).',
      { query: { type: 'string' } },
      [],
      ({ query = '' }) => {
        const q = String(query ?? '').trim().toLowerCase();
        const matches = [];
        for (const id of context.world?.listEntityIds?.() ?? []) {
          if (context.world.isAlive && !context.world.isAlive(id)) continue;
          const props = context.world.getCanonical?.(id, MAP_ASPECT_ID);
          if (!props) continue;
          const resolved = resolveMapSpec(props);
          const hay = `${id} ${resolved.title} ${resolved.regionPreset} ${resolved.region.nameKo} ${resolved.stylePreset}`.toLowerCase();
          if (q && !hay.includes(q)) continue;
          matches.push({
            id,
            title: resolved.title,
            regionPreset: resolved.regionPreset,
            stylePreset: resolved.stylePreset,
            viewport: resolved.viewport,
            baked10m: Boolean(resolved.bakedDetail),
            customLayerCount: resolved.customLayers.length,
          });
        }
        return { total: matches.length, maps: matches };
      },
    );

    registerTool(
      'plan-changes',
      '수능 백지도 생성·수정·이동·삭제 승인 제안 생성. actions는 JSON 배열 문자열입니다. 직접 적용하지 않고 prepareChange 승인 제안을 반환합니다.',
      { actions: { type: 'string' } },
      ['actions'],
      ({ actions }) => {
        const parsed = typeof actions === 'string' ? JSON.parse(actions) : actions;
        const { ops, summary } = planWhiteMapChanges(context.world, parsed);
        const proposal = tools.prepareChange(ops);
        return { ...proposal, summary };
      },
    );
  } catch (error) {
    for (const d of disposers.reverse()) {
      try { d(); } catch {}
    }
    throw error;
  }

  return () => {
    for (const d of disposers.splice(0).reverse()) {
      try { d(); } catch {}
    }
  };
}
