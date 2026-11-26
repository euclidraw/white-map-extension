import {
  computeViewportBbox,
  createGeoPath,
  createMapProjection,
  isDeepZoomScale,
  pickAdmin,
} from './gis-base.js';
import { frameLayout } from './frame-layout.js';
import { cachedBake, isBakeLoading, subscribeBakeLoading } from './bake-session.js';
import { MAP_ASPECT_ID } from './manifest.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';

// Vendored from alid-stem-extensions/src/edit/toolbar.ts (MIT); no runtime dependency.
import stemToolbarCss from './styles/stem-toolbar.css?inline';

const NS = 'http://www.w3.org/2000/svg';

export const HIGHLIGHT_SLOTS = Object.freeze([
  { id: 'A', chip: 'A · 회색', legendLabel: 'A', fill: '#bdbdbd', pattern: 'none' },
  { id: 'B', chip: 'B · 진회색', legendLabel: 'B', fill: '#525252', pattern: 'none' },
  { id: 'C', chip: 'C · 빗금', legendLabel: 'C', fill: '#ffffff', pattern: 'hatch' },
  { id: 'D', chip: 'D · 점묘', legendLabel: 'D', fill: '#d8d8d8', pattern: 'stipple' },
]);

const HIGHLIGHT_LEVELS = Object.freeze([
  ['auto', '자동'],
  ['admin0', '국가'],
  ['admin1', '성·도'],
  ['kr-sido', '시·도'],
  ['kr-sgg', '시·군·구'],
]);

const REGION_STYLES = Object.freeze([
  { id: 'gray', label: '연회색', fill: '#bdbdbd', pattern: 'none', legendName: '분포 A' },
  { id: 'dark', label: '진회색', fill: '#525252', pattern: 'none', legendName: '분포 B' },
  { id: 'hatch', label: '빗금', fill: '#ffffff', pattern: 'hatch', legendName: '분포 C' },
  { id: 'stipple', label: '점묘', fill: '#d8d8d8', pattern: 'stipple', legendName: '분포 D' },
]);

const PROMPT_STYLE = `
.wm-prompt{position:absolute;display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border-radius:var(--alid-radius-small,6px);
  background:var(--alid-bg-surface,#fff);border:1px solid var(--alid-accent,#008FF0);box-shadow:0 4px 16px #0000001a;
  color:var(--alid-text,#18181b);font:12px/1.4 var(--alid-font,system-ui,sans-serif);pointer-events:auto;z-index:40}
.wm-prompt input{width:136px;border:0;outline:none;background:transparent;color:inherit;font:inherit}
.wm-prompt button{height:24px;padding:0 8px;border:0;border-radius:var(--alid-control-radius,4px);background:var(--alid-accent,#008FF0);
  color:var(--alid-accent-contrast,#fff);font:inherit;font-size:11px;font-weight:500;cursor:pointer}
.wm-prompt button:hover{background:var(--alid-accent-hover,#0077cc)}
.stem-toolbar .stem-step{flex-wrap:wrap;justify-content:center;max-width:100%}
.stem-toolbar .stem-step button[aria-pressed="true"]{background:var(--alid-accent,#008FF0);color:#fff}
.stem-toolbar .stem-step button:disabled{opacity:.42;cursor:default}
.stem-toolbar .wm-step-sep{width:1px;height:14px;background:#ffffff2e}
`;

const ICONS = {
  select: ['m5 3 12 9-6 1-3 6z'],
  explore: ['M10 2v16', 'M2 10h16', 'M7 5 10 2l3 3', 'M7 15 10 18l3-3', 'M5 7 2 10l3 3', 'M15 7 18 10l-3 3'],
  annotation: ['M4 15.5a1.5 1.5 0 1 0 0 .01', 'M5.2 14.3 9.5 10h7.5', 'M11.5 4.5h6', 'M14.5 4.5v4.5'],
  point: ['M10 4a6 6 0 1 0 0 12 6 6 0 1 0 0-12', { d: 'M10 8a2 2 0 1 0 0 4 2 2 0 1 0 0-4', fill: true }],
  route: ['M3.5 15.5 7.5 8l5 3.5L16.5 4.5', { d: 'M3.5 14.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6', fill: true }, { d: 'M16.5 3.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6', fill: true }],
  region: [{ d: 'M4 6l5.5-2.5 7 3-2 8.5-7.5 1.5L3.5 12z', fill: true }],
  highlight: [{ d: 'M3.5 5.5 8.5 3l8 2.5-2 9-6.5 2.5-5-3.5z', fill: true }],
  borders: ['M3 15 7.5 8l5 2.5L17 4.5'],
  rivers: ['M3 15c3-1.2 3-4.8 6-4.8s3-3.6 6-4.8 2-1.2 2-1.2'],
  legend: ['M3 4h14v12H3z', { d: 'M5.5 7h3.5v2.5H5.5z', fill: true }, 'M10.5 8.2h4', 'M5.5 12.2h3.5', 'M10.5 12.2h4'],
  inset: ['M3 3.5h14v13H3z', 'M4.5 9.5h6v5.5h-6z'],
  bake: ['M10 3v9', 'M6.5 8.5 10 12l3.5-3.5', 'M4 15.5h12'],
};

const TOOL_MODES = new Set(['annotation', 'point', 'route', 'region', 'highlight']);

const TOOL_ITEMS = [
  { id: '', label: '선택·이동', tooltip: '선택·이동 (Esc)', icon: 'select' },
  { separator: true },
  { id: 'explore', label: '지도 탐색', tooltip: '지도 프레임 탐색 (더블클릭 · 팬/휠 줌)', icon: 'explore' },
  { id: 'highlight', label: '지역 강조', tooltip: '지역 강조 (A/B/C 그룹 · 호버 미리보기)', icon: 'highlight' },
  { id: 'annotation', label: '지시선 라벨', tooltip: '지시선 라벨 추가 (클릭 배치 · 라벨 더블클릭 수정)', icon: 'annotation' },
  { id: 'point', label: '지점 마커', tooltip: '지점 마커 추가 (수도·도넛·점 배치)', icon: 'point' },
  { id: 'route', label: '경로 그리기', tooltip: '경로 선 그리기 (고스트 미리보기 · ⌫ 취소 · Enter 완료)', icon: 'route' },
  { id: 'region', label: '분포 영역', tooltip: '분포 영역 다각형 그리기 (단색·빗금·점묘 · Enter 완료)', icon: 'region' },
  { separator: true },
  { id: 'toggle-borders', label: '국경선', tooltip: '국경선 표시 토글', toggleLayer: 'borders', icon: 'borders', dashed: true },
  { id: 'toggle-rivers', label: '하천', tooltip: '하천 표시 토글', toggleLayer: 'rivers', icon: 'rivers' },
  { id: 'toggle-legend', label: '범례', tooltip: '범례 박스 표시 토글', icon: 'legend' },
  { id: 'toggle-inset', label: '위치 소지도', tooltip: '위치 소지도 인셋 토글', icon: 'inset' },
  { separator: true },
  { id: 'bake', label: '자동 상세화', tooltip: '확대 시 상세 해안선·하천 자동 로드 토글 (Auto-LOD)', icon: 'bake' },
];

function createIconSvg(doc, key, dashed = false) {
  const paths = ICONS[key];
  if (!paths) return null;
  const svg = doc.createElementNS(NS, 'svg');
  for (const [k, v] of [
    ['width', '18'],
    ['height', '18'],
    ['viewBox', '0 0 20 20'],
    ['stroke-width', '1.5'],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
    ['aria-hidden', 'true'],
    ['focusable', 'false'],
  ]) {
    svg.setAttribute(k, v);
  }
  for (const entry of paths) {
    const p = doc.createElementNS(NS, 'path');
    const filled = typeof entry === 'object' && entry.fill;
    p.setAttribute('d', typeof entry === 'string' ? entry : entry.d);
    p.setAttribute('fill', filled ? 'currentColor' : 'none');
    p.setAttribute('stroke', filled ? 'none' : 'currentColor');
    if (filled && (key === 'highlight' || key === 'region')) {
      p.setAttribute('fill-opacity', key === 'region' ? '0.16' : '0.28');
      p.setAttribute('stroke', 'currentColor');
      if (key === 'region') p.setAttribute('stroke-dasharray', '2.5 2');
    }
    if (dashed) p.setAttribute('stroke-dasharray', '3 2.5');
    svg.append(p);
  }
  return svg;
}

function screenToGeo(mountEl, props, width, height, clientX, clientY) {
  const svg = mountEl.querySelector('svg:not([data-wm-draft-overlay])') ?? mountEl.querySelector('svg');
  const resolved = resolveMapSpec(props);
  const { frameX, frameY, frameW, frameH } = frameLayout(width, height, resolved);

  let lx = 0;
  let ly = 0;
  const ctm = svg?.getScreenCTM?.();
  if (ctm && typeof ctm.inverse === 'function') {
    const inv = ctm.inverse();
    lx = inv.a * clientX + inv.c * clientY + inv.e - frameX;
    ly = inv.b * clientX + inv.d * clientY + inv.f - frameY;
  } else {
    const rect = svg?.getBoundingClientRect?.();
    const box = rect?.width && rect?.height ? rect : mountEl.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    lx = ((clientX - box.left) / box.width) * width - frameX;
    ly = ((clientY - box.top) / box.height) * height - frameY;
  }

  if (lx < 0 || ly < 0 || lx > frameW || ly > frameH) return null;
  const proj = createMapProjection(resolved.projection, resolved.viewport, frameW, frameH);
  const ll = proj.invert?.([lx, ly]);
  if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
  return {
    lon: Math.round(ll[0] * 1000) / 1000,
    lat: Math.round(ll[1] * 1000) / 1000,
    resolved,
    projection: proj,
    frameX,
    frameY,
    frameW,
    frameH,
    width,
    height,
  };
}

/**
 * Top-fixed canvas HUD toolbar matching alid-stem-extensions' FigureToolbar pattern:
 * - Pinned horizontally at top-center (`left: 50%; top: 12px; transform: translateX(-50%)`)
 * - Pure CSS hover/focus tooltips (`role="tooltip"`) below each icon button
 * - Contextual second row (`.stem-step`) for active placement tools, A/B/C highlight slots & Auto-LOD status
 */
export function mountMapMenubar(context, actions) {
  const provider = context?.services?.get?.('canvas.active-tool-surface');
  let surface = null;
  let hud = null;
  let doc = null;
  let rootEl = null;
  let rowEl = null;
  let stepEl = null;
  let promptEl = null;
  let themeObserver = null;
  let activeTool = null;
  let lastSlotId = 'A';
  let lastTargetLevel = 'auto';
  let lastRegionStyle = 'gray';
  let baking = false;
  let tileLoading = isBakeLoading();
  let bakeStatus = null;
  let frame = null;

  async function requestBake(id, fn) {
    if (baking) return;
    baking = true;
    bakeStatus = null;
    schedule();
    try {
      const result = await fn(id);
      if (result?.error) bakeStatus = { id, message: result.error };
      else if (result?.deferred) bakeStatus = { id, message: '자동 상세화 켜짐 · ×1800 이상 확대 시 상세 타일을 자동으로 불러옵니다' };
    } catch (error) {
      bakeStatus = { id, message: String(error?.message ?? error) };
    } finally {
      baking = false;
      schedule();
    }
  }

  function findMount(id) {
    if (!surface || !id) return null;
    for (const el of surface.querySelectorAll('[data-role="white-map-mount"]')) {
      if (el.dataset.whiteMapId === id) return el;
    }
    return null;
  }

  function currentTargetId() {
    const exploringId = actions.getExploringId?.();
    if (exploringId) return exploringId;
    if (activeTool?.id) return activeTool.id;
    const active = provider?.get?.();
    const selected = active?.selection?.getSelection?.() ?? [];
    if (selected.length === 1 && context.world?.getCanonical?.(selected[0], MAP_ASPECT_ID)) {
      return selected[0];
    }
    return null;
  }

  function closePrompt() {
    if (promptEl) {
      promptEl.remove();
      promptEl = null;
    }
  }

  function removeDraftOverlay(mountEl) {
    mountEl?.querySelector?.('[data-wm-draft-overlay="true"]')?.remove();
  }

  function syncDraftOverlay() {
    if (!activeTool || !doc) return;
    const { id, mode, mountEl } = activeTool;
    if (mode !== 'highlight' && mode !== 'route' && mode !== 'region') {
      removeDraftOverlay(mountEl);
      return;
    }
    const props = context.world.getCanonical(id, MAP_ASPECT_ID);
    if (!props) {
      removeDraftOverlay(mountEl);
      return;
    }
    const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
    const width = Math.max(160, Math.round(bounds.width || DEFAULT_MAP_WIDTH));
    const height = Math.max(120, Math.round(bounds.height || DEFAULT_MAP_HEIGHT));
    const resolved = resolveMapSpec(props);
    const { frameX, frameY, frameW, frameH } = frameLayout(width, height, resolved);
    const proj = createMapProjection(resolved.projection, resolved.viewport, frameW, frameH);

    let overlay = mountEl.querySelector('[data-wm-draft-overlay="true"]');
    if (!overlay) {
      overlay = doc.createElementNS(NS, 'svg');
      overlay.setAttribute('data-wm-draft-overlay', 'true');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        overflow: 'hidden',
      });
      mountEl.append(overlay);
    }
    overlay.setAttribute('width', String(width));
    overlay.setAttribute('height', String(height));
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    overlay.replaceChildren();

    const defs = doc.createElementNS(NS, 'defs');
    const clip = doc.createElementNS(NS, 'clipPath');
    clip.setAttribute('id', `wm-draft-clip-${id}`);
    const clipRect = doc.createElementNS(NS, 'rect');
    clipRect.setAttribute('x', '0');
    clipRect.setAttribute('y', '0');
    clipRect.setAttribute('width', String(frameW));
    clipRect.setAttribute('height', String(frameH));
    clip.append(clipRect);
    defs.append(clip);

    const g = doc.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${frameX},${frameY})`);
    g.setAttribute('clip-path', `url(#wm-draft-clip-${id})`);
    overlay.append(defs, g);

    if (mode === 'highlight' && activeTool.hoverHit?.feature) {
      const pathGen = createGeoPath(proj);
      const d = pathGen(activeTool.hoverHit.feature);
      if (d) {
        const p = doc.createElementNS(NS, 'path');
        p.setAttribute('data-wm-hover-preview', 'true');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'rgba(0, 143, 240, 0.16)');
        p.setAttribute('stroke', '#008FF0');
        p.setAttribute('stroke-width', '1.8');
        p.setAttribute('stroke-dasharray', '4 2');
        p.setAttribute('stroke-linejoin', 'round');
        g.append(p);
      }
      return;
    }

    const placedPts = activeTool.coords
      .map(ll => proj(ll))
      .filter(pt => pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
    const cursorPt = activeTool.cursorGeo ? proj(activeTool.cursorGeo) : null;
    const validCursor = cursorPt && Number.isFinite(cursorPt[0]) && Number.isFinite(cursorPt[1]) ? cursorPt : null;

    if (mode === 'route') {
      if (placedPts.length >= 2) {
        const pl = doc.createElementNS(NS, 'polyline');
        pl.setAttribute('data-wm-ghost-placed', 'true');
        pl.setAttribute('points', placedPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', '#171717');
        pl.setAttribute('stroke-width', activeTool.doubleLine ? '2.8' : '1.6');
        if (activeTool.dashed) pl.setAttribute('stroke-dasharray', '4 3');
        g.append(pl);
      }
      if (placedPts.length >= 1 && validCursor) {
        const last = placedPts[placedPts.length - 1];
        const rubber = doc.createElementNS(NS, 'line');
        rubber.setAttribute('data-wm-ghost-rubber', 'true');
        rubber.setAttribute('x1', last[0].toFixed(1));
        rubber.setAttribute('y1', last[1].toFixed(1));
        rubber.setAttribute('x2', validCursor[0].toFixed(1));
        rubber.setAttribute('y2', validCursor[1].toFixed(1));
        rubber.setAttribute('stroke', '#008FF0');
        rubber.setAttribute('stroke-width', '1.5');
        rubber.setAttribute('stroke-dasharray', '4 3');
        g.append(rubber);
      }
    } else if (mode === 'region') {
      const polyPts = validCursor ? [...placedPts, validCursor] : placedPts;
      if (polyPts.length >= 2) {
        const poly = doc.createElementNS(NS, polyPts.length >= 3 ? 'polygon' : 'polyline');
        poly.setAttribute('data-wm-ghost-polygon', 'true');
        poly.setAttribute('points', polyPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
        poly.setAttribute('fill', polyPts.length >= 3 ? 'rgba(0, 143, 240, 0.14)' : 'none');
        poly.setAttribute('stroke', '#008FF0');
        poly.setAttribute('stroke-width', '1.5');
        poly.setAttribute('stroke-dasharray', '4 3');
        g.append(poly);
      }
    }

    for (const [x, y] of placedPts) {
      const dot = doc.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', '#ffffff');
      dot.setAttribute('stroke', '#008FF0');
      dot.setAttribute('stroke-width', '1.6');
      g.append(dot);
    }
  }

  function clearTool() {
    closePrompt();
    if (activeTool) {
      const { mountEl } = activeTool;
      removeDraftOverlay(mountEl);
      delete mountEl.dataset.canvasUi;
      delete mountEl.dataset.escapeOwner;
      delete mountEl.dataset.mapTool;
      mountEl.style.cursor = '';
      activeTool = null;
    }
    schedule();
  }

  function finishRoute() {
    if (!activeTool || activeTool.mode !== 'route') return;
    const { id, coords, doubleLine, dashed } = activeTool;
    if (coords.length >= 2) {
      actions.addCustomLayer(id, {
        id: `route-${Date.now()}`,
        name: doubleLine ? '경로 (이중선)' : dashed ? '경로 (파선)' : '경로',
        kind: 'line',
        visible: true,
        showInLegend: true,
        style: {
          stroke: '#171717',
          strokeWidth: doubleLine ? 3.2 : 1.5,
          dash: dashed ? '4 3' : 'none',
          doubleLine: Boolean(doubleLine),
        },
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { name: '경로' }, geometry: { type: 'LineString', coordinates: coords } }],
        },
      });
    }
    clearTool();
  }

  function finishRegion() {
    if (!activeTool || activeTool.mode !== 'region') return;
    const { id, coords, regionStyle } = activeTool;
    if (coords.length >= 3) {
      const styleDef = REGION_STYLES.find(s => s.id === regionStyle) ?? REGION_STYLES[0];
      const closedRing = [...coords, coords[0]];
      actions.addCustomLayer(id, {
        id: `region-${Date.now()}`,
        name: styleDef.legendName,
        kind: 'polygon',
        visible: true,
        showInLegend: true,
        style: {
          fill: styleDef.fill,
          pattern: styleDef.pattern,
          stroke: '#171717',
          strokeWidth: 0.7,
        },
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { name: styleDef.legendName }, geometry: { type: 'Polygon', coordinates: [closedRing] } }],
        },
      });
    }
    clearTool();
  }

  function undoLastVertex() {
    if (!activeTool || (activeTool.mode !== 'route' && activeTool.mode !== 'region')) return false;
    if (!activeTool.coords.length) return false;
    activeTool.coords.pop();
    syncDraftOverlay();
    schedule();
    return true;
  }

  function startTool(id, mode) {
    if (!mode) {
      actions.exitExplore?.(true);
      clearTool();
      return;
    }
    if (mode === 'explore') {
      clearTool();
      actions.enterExplore?.(id);
      schedule();
      return;
    }
    actions.exitExplore?.(true);
    if (activeTool?.id === id && activeTool.mode === mode) {
      clearTool();
      return;
    }
    clearTool();
    const mountEl = findMount(id);
    if (!mountEl || context.world.isEntityReadOnly?.(id)) return;
    mountEl.dataset.canvasUi = 'true';
    mountEl.dataset.escapeOwner = 'true';
    mountEl.dataset.mapTool = mode;
    mountEl.style.cursor = 'crosshair';
    activeTool = {
      id,
      mode,
      mountEl,
      marker: 'bullseye',
      doubleLine: false,
      dashed: false,
      regionStyle: lastRegionStyle,
      slotId: lastSlotId,
      targetLevel: lastTargetLevel,
      hoverHit: null,
      cursorGeo: null,
      coords: [],
    };
    syncDraftOverlay();
    schedule();
  }

  function openAnnotationPrompt(id, lon, lat, clientX, clientY, existingAnn = null) {
    closePrompt();
    if (!hud || !doc) return;
    const hb = hud.getBoundingClientRect();
    const wrap = doc.createElement('div');
    wrap.className = 'wm-prompt';
    wrap.dataset.canvasUi = '';
    wrap.dataset.escapeOwner = 'true';
    wrap.dataset.wmAnnotationPrompt = 'true';
    const theme = doc.documentElement?.dataset?.alidTheme;
    if (theme === 'light' || theme === 'dark') wrap.dataset.alidTheme = theme;
    const px = Math.max(8, Math.min(Math.max(8, hb.width - 210), Math.round(clientX - hb.left + 10)));
    const py = Math.max(52, Math.min(Math.max(52, hb.height - 40), Math.round(clientY - hb.top - 16)));
    wrap.style.left = `${px}px`;
    wrap.style.top = `${py}px`;

    const input = doc.createElement('input');
    input.type = 'text';
    input.placeholder = '지명 입력 후 Enter';
    input.dataset.canvasEditor = 'true';
    if (existingAnn?.text) input.value = existingAnn.text;

    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });

    const commit = () => {
      const text = input.value.trim();
      closePrompt();
      if (!text) return;
      if (existingAnn?.id && actions.updateAnnotation) {
        actions.updateAnnotation(id, existingAnn.id, { text });
      } else {
        actions.addAnnotation(id, {
          id: `ann-${Date.now()}`,
          lon,
          lat,
          text,
          dx: 26,
          dy: -12,
          leaderLine: true,
          halo: true,
        });
      }
    };

    input.addEventListener('keydown', e => {
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePrompt();
      }
    });

    const okBtn = doc.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = existingAnn ? '수정' : '추가';
    okBtn.addEventListener('click', e => { e.stopPropagation(); commit(); });

    wrap.append(input, okBtn);
    hud.append(wrap);
    promptEl = wrap;
    input.focus?.();
    if (existingAnn) input.select?.();
  }

  function ensureToolbar() {
    if (rootEl || !hud || !doc) return;
    rootEl = doc.createElement('div');
    rootEl.className = 'stem-toolbar';
    rootEl.dataset.canvasUi = '';
    rootEl.dataset.wmMenubar = 'true';
    rootEl.hidden = true;

    const syncTheme = () => {
      const theme = doc.documentElement?.dataset?.alidTheme;
      if (theme === 'light' || theme === 'dark') rootEl.dataset.alidTheme = theme;
      else delete rootEl.dataset.alidTheme;
    };
    syncTheme();
    if (typeof doc.defaultView?.MutationObserver === 'function' && doc.documentElement) {
      themeObserver = new doc.defaultView.MutationObserver(syncTheme);
      themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-alid-theme'] });
    }

    const style = doc.createElement('style');
    style.textContent = stemToolbarCss + '\n' + PROMPT_STYLE;

    rowEl = doc.createElement('div');
    rowEl.className = 'stem-toolbar-row';
    rowEl.setAttribute('role', 'toolbar');
    rowEl.setAttribute('aria-label', '백지도 도구');

    for (const item of TOOL_ITEMS) {
      if (item.separator) {
        const sep = doc.createElement('span');
        sep.className = 'stem-sep';
        sep.setAttribute('role', 'separator');
        rowEl.append(sep);
        continue;
      }
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.dataset.wmToolBtn = item.id;
      btn.setAttribute('aria-label', item.label);
      const icon = createIconSvg(doc, item.icon, item.dashed);
      if (icon) btn.append(icon);
      else btn.append(doc.createTextNode(item.label));

      const tooltip = doc.createElement('span');
      tooltip.className = 'stem-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = item.tooltip;
      btn.append(tooltip);

      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        const id = currentTargetId();
        if (!id) return;
        bakeStatus = null;
        if (item.id === '' || item.id === 'explore' || TOOL_MODES.has(item.id)) {
          startTool(id, item.id);
        } else if (item.toggleLayer) {
          actions.toggleLayer(id, item.toggleLayer);
        } else if (item.id === 'toggle-legend') {
          actions.toggleLegend(id);
        } else if (item.id === 'toggle-inset') {
          actions.toggleInset(id);
        } else if (item.id === 'bake' && !baking) {
          await requestBake(id, actions.toggleAutoDetail ?? actions.bakeHighRes);
        }
        schedule();
      });
      rowEl.append(btn);
    }

    stepEl = doc.createElement('div');
    stepEl.className = 'stem-step';
    stepEl.setAttribute('role', 'status');
    stepEl.hidden = true;

    rootEl.append(style, rowEl, stepEl);
    hud.append(rootEl);
  }

  function appendStepSep() {
    const sep = doc.createElement('span');
    sep.className = 'wm-step-sep';
    sep.setAttribute('aria-hidden', 'true');
    stepEl.append(sep);
  }

  function renderStepRow(id, exploringId) {
    if (!stepEl || !doc) return;
    stepEl.replaceChildren();
    if (tileLoading || baking) {
      const loadingEl = doc.createElement('span');
      loadingEl.dataset.wmTileLoading = 'true';
      loadingEl.textContent = '상세 해안선·하천 불러오는 중…';
      stepEl.append(loadingEl);
    } else if (bakeStatus?.id === id) {
      const message = doc.createElement('span');
      message.textContent = bakeStatus.message;
      stepEl.append(message);
    }

    if (exploringId === id) {
      const vp = actions.getExploringViewport?.();
      const span = doc.createElement('span');
      span.dataset.wmHudInfo = 'true';
      span.textContent = vp
        ? `탐색 중 (${vp.centerLat.toFixed(1)}°N, ${vp.centerLon.toFixed(1)}°E · ×${Math.round(vp.scale)}) · 드래그 이동, 휠 줌`
        : '지도 프레임 탐색 중 · 드래그 이동, 휠 줌';
      stepEl.append(span);

      if (vp && (isDeepZoomScale(vp.scale) || baking)) {
        const bakeBtn = doc.createElement('button');
        bakeBtn.type = 'button';
        bakeBtn.dataset.wmHudBake = 'true';
        bakeBtn.disabled = baking;
        bakeBtn.textContent = baking ? '타일 로딩 중…' : '상세 타일 불러오기';
        bakeBtn.addEventListener('click', async e => {
          e.preventDefault();
          e.stopPropagation();
          if (baking) return;
          await requestBake(id, actions.bakeFromExplore);
        });
        stepEl.append(bakeBtn);
      }

      const doneBtn = doc.createElement('button');
      doneBtn.type = 'button';
      doneBtn.textContent = '완료 (Esc)';
      doneBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        actions.exitExplore?.(true);
        schedule();
      });
      stepEl.append(doneBtn);
      stepEl.hidden = false;
      return;
    }

    if (!activeTool || activeTool.id !== id) {
      stepEl.hidden = !stepEl.childElementCount;
      return;
    }

    const msg = doc.createElement('span');
    if (activeTool.mode === 'annotation') {
      msg.textContent = '지도 위를 클릭해 지시선 라벨을 배치하세요 (기존 라벨 더블클릭 수정)';
      stepEl.append(msg);
    } else if (activeTool.mode === 'point') {
      msg.textContent = '마커 배치:';
      stepEl.append(msg);
      for (const [mKey, mLabel] of [['bullseye', '수도 ◎'], ['ring', '도넛 ○'], ['dot', '점 ●']]) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = mLabel;
        b.setAttribute('aria-pressed', String(activeTool.marker === mKey));
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (activeTool) {
            activeTool.marker = mKey;
            schedule();
          }
        });
        stepEl.append(b);
      }
    } else if (activeTool.mode === 'route') {
      msg.textContent = `경로 꼭짓점 ${activeTool.coords.length}개`;
      stepEl.append(msg);
      const styleBtn = doc.createElement('button');
      styleBtn.type = 'button';
      styleBtn.textContent = activeTool.doubleLine ? '이중선' : '단선';
      styleBtn.setAttribute('aria-pressed', String(activeTool.doubleLine));
      styleBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTool) {
          activeTool.doubleLine = !activeTool.doubleLine;
          syncDraftOverlay();
          schedule();
        }
      });
      const dashBtn = doc.createElement('button');
      dashBtn.type = 'button';
      dashBtn.textContent = '파선';
      dashBtn.setAttribute('aria-pressed', String(Boolean(activeTool.dashed)));
      dashBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTool) {
          activeTool.dashed = !activeTool.dashed;
          syncDraftOverlay();
          schedule();
        }
      });
      const undoBtn = doc.createElement('button');
      undoBtn.type = 'button';
      undoBtn.dataset.wmUndoVertex = 'true';
      undoBtn.textContent = '한 점 취소 (⌫)';
      undoBtn.disabled = activeTool.coords.length === 0;
      undoBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        undoLastVertex();
      });
      const finishBtn = doc.createElement('button');
      finishBtn.type = 'button';
      finishBtn.textContent = '완료';
      finishBtn.disabled = activeTool.coords.length < 2;
      finishBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        finishRoute();
      });
      stepEl.append(styleBtn, dashBtn, undoBtn, finishBtn);
    } else if (activeTool.mode === 'region') {
      msg.textContent = `영역 꼭짓점 ${activeTool.coords.length}개`;
      stepEl.append(msg);
      for (const st of REGION_STYLES) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.dataset.wmRegionStyle = st.id;
        b.textContent = st.label;
        b.setAttribute('aria-pressed', String(activeTool.regionStyle === st.id));
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (activeTool) {
            activeTool.regionStyle = st.id;
            lastRegionStyle = st.id;
            schedule();
          }
        });
        stepEl.append(b);
      }
      const undoBtn = doc.createElement('button');
      undoBtn.type = 'button';
      undoBtn.dataset.wmUndoVertex = 'true';
      undoBtn.textContent = '한 점 취소 (⌫)';
      undoBtn.disabled = activeTool.coords.length === 0;
      undoBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        undoLastVertex();
      });
      const finishBtn = doc.createElement('button');
      finishBtn.type = 'button';
      finishBtn.dataset.wmFinishRegion = 'true';
      finishBtn.textContent = '완료';
      finishBtn.disabled = activeTool.coords.length < 3;
      finishBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        finishRegion();
      });
      stepEl.append(undoBtn, finishBtn);
    } else if (activeTool.mode === 'highlight') {
      for (const slot of HIGHLIGHT_SLOTS) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.dataset.wmHlSlot = slot.id;
        b.textContent = slot.chip;
        b.setAttribute('aria-pressed', String(activeTool.slotId === slot.id));
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (activeTool) {
            activeTool.slotId = slot.id;
            lastSlotId = slot.id;
            schedule();
          }
        });
        stepEl.append(b);
      }
      appendStepSep();
      for (const [lvl, lvlLabel] of HIGHLIGHT_LEVELS) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.dataset.wmHlLevel = lvl;
        b.textContent = lvlLabel;
        b.setAttribute('aria-pressed', String(activeTool.targetLevel === lvl));
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (activeTool) {
            activeTool.targetLevel = lvl;
            lastTargetLevel = lvl;
            activeTool.hoverHit = null;
            syncDraftOverlay();
            schedule();
          }
        });
        stepEl.append(b);
      }
      appendStepSep();
      msg.dataset.wmHoverName = 'true';
      msg.textContent = activeTool.hoverHit
        ? `${activeTool.hoverHit.name} (${activeTool.hoverHit.code})`
        : '지역에 마우스를 올린 뒤 클릭';
      stepEl.append(msg);
    }

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '도구 끄기';
    cancelBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      clearTool();
    });
    stepEl.append(cancelBtn);
    stepEl.hidden = false;
  }

  function paint() {
    ensureToolbar();
    if (!rootEl || !rowEl || !hud) return;
    const id = currentTargetId();
    const mountEl = id ? findMount(id) : null;
    if (!id || !mountEl || context.world.isEntityReadOnly?.(id)) {
      rootEl.hidden = true;
      return;
    }

    rootEl.hidden = false;
    const exploringId = actions.getExploringId?.() ?? null;
    const props = context.world.getCanonical(id, MAP_ASPECT_ID);
    const resolved = props ? resolveMapSpec(props) : null;
    const currentMode = exploringId === id ? 'explore' : (activeTool?.id === id ? activeTool.mode : '');

    for (const btn of rowEl.querySelectorAll('button[data-wm-tool-btn]')) {
      const bid = btn.dataset.wmToolBtn;
      const isMode = bid === '' || bid === 'explore' || TOOL_MODES.has(bid);
      const pressed = isMode
        ? bid === currentMode
        : Boolean(resolved && (
            (bid === 'toggle-borders' && resolved.baseLayers.borders)
            || (bid === 'toggle-rivers' && resolved.baseLayers.rivers)
            || (bid === 'toggle-legend' && resolved.legend.enabled)
            || (bid === 'toggle-inset' && resolved.inset.enabled)
            || (bid === 'bake' && resolved.bakeEnabled)
          ));
      btn.setAttribute('aria-pressed', String(pressed));
    }

    renderStepRow(id, exploringId);
  }

  function schedule() {
    const win = doc?.defaultView;
    if (win?.requestAnimationFrame && frame == null) {
      frame = win.requestAnimationFrame(() => {
        frame = null;
        paint();
      });
    }
  }

  function onPointerDown(e) {
    if (!activeTool || e.button !== 0 || e.isPrimary === false) return;
    if (rootEl?.contains(e.target) || promptEl?.contains(e.target)) return;
    if (!activeTool.mountEl.contains(e.target)) {
      clearTool();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const { id, mode, mountEl } = activeTool;
    const props = context.world.getCanonical(id, MAP_ASPECT_ID);
    const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
    const geo = props ? screenToGeo(mountEl, props, bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT, e.clientX, e.clientY) : null;
    if (!geo) return;

    if (mode === 'annotation') {
      openAnnotationPrompt(id, geo.lon, geo.lat, e.clientX, e.clientY);
    } else if (mode === 'point') {
      actions.addCustomPoint(id, geo.lon, geo.lat, activeTool.marker);
    } else if (mode === 'route' || mode === 'region') {
      activeTool.coords.push([geo.lon, geo.lat]);
      activeTool.cursorGeo = [geo.lon, geo.lat];
      syncDraftOverlay();
      schedule();
    } else if (mode === 'highlight') {
      const detail = geo.resolved.bakeEnabled && cachedBake(computeViewportBbox(geo.projection, geo.frameW, geo.frameH), geo.resolved.viewport.scale, geo.resolved.baseLayers);
      const hit = pickAdmin(geo.lon, geo.lat, geo.resolved.baseLayers, detail, activeTool.targetLevel);
      if (hit?.code) {
        const slot = HIGHLIGHT_SLOTS.find(s => s.id === activeTool.slotId) ?? HIGHLIGHT_SLOTS[0];
        if (actions.toggleHighlightSlot) {
          actions.toggleHighlightSlot(id, hit.level, hit.code, slot);
        } else {
          actions.toggleHighlight(id, hit.level, hit.code);
        }
      }
    }
  }

  function onPointerMove(e) {
    if (!activeTool) return;
    const { id, mode, mountEl } = activeTool;
    if (mode !== 'highlight' && mode !== 'route' && mode !== 'region') return;
    if (!mountEl.contains(e.target) && (mode === 'highlight')) {
      if (activeTool.hoverHit) {
        activeTool.hoverHit = null;
        syncDraftOverlay();
        const hoverEl = stepEl?.querySelector?.('[data-wm-hover-name]');
        if (hoverEl) hoverEl.textContent = '지역에 마우스를 올린 뒤 클릭';
      }
      return;
    }
    const props = context.world.getCanonical(id, MAP_ASPECT_ID);
    const bounds = context.world.getCanonical(id, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
    const geo = props ? screenToGeo(mountEl, props, bounds.width || DEFAULT_MAP_WIDTH, bounds.height || DEFAULT_MAP_HEIGHT, e.clientX, e.clientY) : null;

    if (mode === 'highlight') {
      const detail = geo?.resolved.bakeEnabled && cachedBake(computeViewportBbox(geo.projection, geo.frameW, geo.frameH), geo.resolved.viewport.scale, geo.resolved.baseLayers);
      const hit = geo ? pickAdmin(geo.lon, geo.lat, geo.resolved.baseLayers, detail, activeTool.targetLevel) : null;
      const prevKey = activeTool.hoverHit ? `${activeTool.hoverHit.level}:${activeTool.hoverHit.code}` : '';
      const nextKey = hit ? `${hit.level}:${hit.code}` : '';
      if (prevKey !== nextKey) {
        activeTool.hoverHit = hit;
        syncDraftOverlay();
        const hoverEl = stepEl?.querySelector?.('[data-wm-hover-name]');
        if (hoverEl) {
          hoverEl.textContent = hit ? `${hit.name} (${hit.code})` : '지역에 마우스를 올린 뒤 클릭';
        }
      }
    } else if (mode === 'route' || mode === 'region') {
      activeTool.cursorGeo = geo ? [geo.lon, geo.lat] : null;
      syncDraftOverlay();
    }
  }

  function onDblClick(e) {
    if (activeTool?.mode === 'route' && activeTool.mountEl.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
      return;
    }
    if (activeTool?.mode === 'region' && activeTool.mountEl.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      finishRegion();
      return;
    }
    if (!activeTool) {
      const gizmoLabel = e.target.closest?.('[data-wm-gizmo="ann-label"]');
      const annGroup = e.target.closest?.('[data-map-drag^="annotation:"]');
      let id = null;
      let annId = null;
      if (gizmoLabel) {
        id = currentTargetId();
        annId = gizmoLabel.dataset.wmAnnId;
      } else if (annGroup) {
        const mount = annGroup.closest?.('[data-role="white-map-mount"]');
        id = mount?.dataset?.whiteMapId ?? null;
        annId = annGroup.dataset.annId || annGroup.dataset.mapDrag?.slice('annotation:'.length);
      }
      if (id && annId && !context.world.isEntityReadOnly?.(id)) {
        const props = context.world.getCanonical(id, MAP_ASPECT_ID);
        const resolved = props ? resolveMapSpec(props) : null;
        const existing = resolved?.annotations.find(a => a.id === annId);
        if (existing) {
          e.preventDefault();
          e.stopPropagation();
          openAnnotationPrompt(id, existing.lon, existing.lat, e.clientX, e.clientY, existing);
        }
      }
    }
  }

  function onKeyDown(e) {
    if (!activeTool) return;
    if (promptEl?.contains(e.target)) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      clearTool();
    } else if (e.key === 'Backspace' && (activeTool.mode === 'route' || activeTool.mode === 'region')) {
      if (undoLastVertex()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === 'Enter' && activeTool.mode === 'route') {
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
    } else if (e.key === 'Enter' && activeTool.mode === 'region') {
      e.preventDefault();
      e.stopPropagation();
      finishRegion();
    }
  }

  function detach() {
    clearTool();
    if (frame != null) { doc?.defaultView?.cancelAnimationFrame?.(frame); frame = null; }
    themeObserver?.disconnect();
    themeObserver = null;
    if (rootEl) { rootEl.remove(); rootEl = rowEl = stepEl = null; }
    if (doc) {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointermove', onPointerMove, true);
      doc.removeEventListener('dblclick', onDblClick, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    }
    doc = surface = hud = null;
  }

  function attach() {
    const s = provider?.get?.();
    const nextSurface = s?.surface?.element ?? null;
    const nextHud = s?.surface?.hud ?? null;
    if (nextSurface === surface && nextHud === hud) {
      schedule();
      return;
    }
    detach();
    surface = nextSurface;
    hud = nextHud;
    doc = surface?.ownerDocument ?? null;
    if (!doc?.addEventListener) {
      doc = null;
      return;
    }
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('dblclick', onDblClick, true);
    doc.addEventListener('keydown', onKeyDown, true);
    schedule();
  }

  attach();
  const offSurface = provider?.subscribe?.(attach);
  const offFrames = context?.services?.get?.('canvas.frames')?.subscribe?.(schedule);
  const offWorld = context?.world?.subscribe?.(() => {
    syncDraftOverlay();
    schedule();
  });
  const offBakeLoading = subscribeBakeLoading(loading => {
    tileLoading = loading;
    schedule();
  });

  return {
    startTool,
    clearTool,
    refresh: schedule,
    getActiveTool: () => (activeTool ? { id: activeTool.id, mode: activeTool.mode } : null),
    dispose() {
      offBakeLoading?.();
      offWorld?.();
      offFrames?.();
      offSurface?.();
      detach();
    },
  };
}
