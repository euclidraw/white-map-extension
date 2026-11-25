import {
  createMapProjection,
  hitTestAdminFeature,
  isDeepZoomScale,
} from './gis-base.js';
import { MAP_ASPECT_ID } from './manifest.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';

// Vendored from alid-stem-extensions/src/edit/toolbar.ts (MIT); no runtime dependency.
import stemToolbarCss from './styles/stem-toolbar.css?inline';

const NS = 'http://www.w3.org/2000/svg';

const PROMPT_STYLE = `
.wm-prompt{position:absolute;display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border-radius:var(--alid-radius-small,6px);
  background:var(--alid-bg-surface,#fff);border:1px solid var(--alid-accent,#008FF0);box-shadow:0 4px 16px #0000001a;
  color:var(--alid-text,#18181b);font:12px/1.4 var(--alid-font,system-ui,sans-serif);pointer-events:auto;z-index:40}
.wm-prompt input{width:136px;border:0;outline:none;background:transparent;color:inherit;font:inherit}
.wm-prompt button{height:24px;padding:0 8px;border:0;border-radius:var(--alid-control-radius,4px);background:var(--alid-accent,#008FF0);
  color:var(--alid-accent-contrast,#fff);font:inherit;font-size:11px;font-weight:500;cursor:pointer}
.wm-prompt button:hover{background:var(--alid-accent-hover,#0077cc)}
`;

const ICONS = {
  select: ['m5 3 12 9-6 1-3 6z'],
  explore: ['M10 2v16', 'M2 10h16', 'M7 5 10 2l3 3', 'M7 15 10 18l3-3', 'M5 7 2 10l3 3', 'M15 7 18 10l-3 3'],
  annotation: ['M4 15.5a1.5 1.5 0 1 0 0 .01', 'M5.2 14.3 9.5 10h7.5', 'M11.5 4.5h6', 'M14.5 4.5v4.5'],
  point: ['M10 4a6 6 0 1 0 0 12 6 6 0 1 0 0-12', { d: 'M10 8a2 2 0 1 0 0 4 2 2 0 1 0 0-4', fill: true }],
  route: ['M3.5 15.5 7.5 8l5 3.5L16.5 4.5', { d: 'M3.5 14.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6', fill: true }, { d: 'M16.5 3.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6', fill: true }],
  highlight: [{ d: 'M3.5 5.5 8.5 3l8 2.5-2 9-6.5 2.5-5-3.5z', fill: true }],
  borders: ['M3 15 7.5 8l5 2.5L17 4.5'],
  rivers: ['M3 15c3-1.2 3-4.8 6-4.8s3-3.6 6-4.8 2-1.2 2-1.2'],
  legend: ['M3 4h14v12H3z', { d: 'M5.5 7h3.5v2.5H5.5z', fill: true }, 'M10.5 8.2h4', 'M5.5 12.2h3.5', 'M10.5 12.2h4'],
  inset: ['M3 3.5h14v13H3z', 'M4.5 9.5h6v5.5h-6z'],
  bake: ['M10 3v9', 'M6.5 8.5 10 12l3.5-3.5', 'M4 15.5h12'],
};

const TOOL_ITEMS = [
  { id: '', label: '선택·이동', tooltip: '선택·이동 (Esc)', icon: 'select' },
  { separator: true },
  { id: 'explore', label: '지도 탐색', tooltip: '지도 프레임 탐색 (더블클릭 · 팬/휠 줌)', icon: 'explore' },
  { id: 'annotation', label: '지시선 라벨', tooltip: '지시선 라벨 추가 (지도 클릭 후 지명 입력)', icon: 'annotation' },
  { id: 'point', label: '지점 마커', tooltip: '지점 마커 추가 (수도·도넛·점 배치)', icon: 'point' },
  { id: 'route', label: '경로 그리기', tooltip: '경로 선 그리기 (클릭 추가 · Enter 완료)', icon: 'route' },
  { id: 'highlight', label: '지역 강조', tooltip: '지역 강조 (국가·성·도 클릭 토글)', icon: 'highlight' },
  { separator: true },
  { id: 'toggle-borders', label: '국경선', tooltip: '국경선 표시 토글', toggleLayer: 'borders', icon: 'borders', dashed: true },
  { id: 'toggle-rivers', label: '하천', tooltip: '하천 표시 토글', toggleLayer: 'rivers', icon: 'rivers' },
  { id: 'toggle-legend', label: '범례', tooltip: '범례 박스 표시 토글', icon: 'legend' },
  { id: 'toggle-inset', label: '위치 소지도', tooltip: '위치 소지도 인셋 토글', icon: 'inset' },
  { separator: true },
  { id: 'bake', label: '10m 베이크', tooltip: '10m 고해상도 CDN 스냅샷 베이크', icon: 'bake' },
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
    if (filled && key === 'highlight') p.setAttribute('fill-opacity', '0.28');
    if (filled && key === 'highlight') p.setAttribute('stroke', 'currentColor');
    if (dashed) p.setAttribute('stroke-dasharray', '3 2.5');
    svg.append(p);
  }
  return svg;
}

function screenToGeo(mountEl, props, width, height, clientX, clientY) {
  const svg = mountEl.querySelector('svg');
  const resolved = resolveMapSpec(props);
  const titleH = resolved.title ? 26 : 0;
  const pad = 4;
  const frameX = pad;
  const frameY = pad + titleH;
  const frameW = Math.max(120, width - pad * 2);
  const frameH = Math.max(96, height - pad * 2 - titleH);

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

  const proj = createMapProjection(resolved.projection, resolved.viewport, frameW, frameH);
  const ll = proj.invert?.([lx, ly]);
  if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
  return { lon: Math.round(ll[0] * 1000) / 1000, lat: Math.round(ll[1] * 1000) / 1000, resolved };
}

/**
 * Top-fixed canvas HUD toolbar matching alid-stem-extensions' FigureToolbar pattern:
 * - Pinned horizontally at top-center (`left: 50%; top: 12px; transform: translateX(-50%)`)
 * - Pure CSS hover/focus tooltips (`role="tooltip"`) below each icon button
 * - Contextual second row (`.stem-step`) for active placement tools & exploration status
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
  let activeTool = null; // { id, mode: 'annotation'|'point'|'route'|'highlight', mountEl, marker, doubleLine, coords }
  let baking = false;
  let frame = null;

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

  function clearTool() {
    closePrompt();
    if (activeTool) {
      const { mountEl } = activeTool;
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
    const { id, coords, doubleLine } = activeTool;
    if (coords.length >= 2) {
      actions.addCustomLayer(id, {
        id: `route-${Date.now()}`,
        name: doubleLine ? '경로 (이중선)' : '경로',
        kind: 'line',
        visible: true,
        showInLegend: true,
        style: {
          stroke: '#171717',
          strokeWidth: doubleLine ? 3.2 : 1.5,
          dash: 'none',
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
    activeTool = { id, mode, mountEl, marker: 'bullseye', doubleLine: false, coords: [] };
    schedule();
  }

  function openAnnotationPrompt(id, lon, lat, clientX, clientY) {
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

    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });

    const commit = () => {
      const text = input.value.trim();
      closePrompt();
      if (!text) return;
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
    okBtn.textContent = '추가';
    okBtn.addEventListener('click', e => { e.stopPropagation(); commit(); });

    wrap.append(input, okBtn);
    hud.append(wrap);
    promptEl = wrap;
    input.focus?.();
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
        if (item.id === '' || item.id === 'explore' || ['annotation', 'point', 'route', 'highlight'].includes(item.id)) {
          startTool(id, item.id);
        } else if (item.toggleLayer) {
          actions.toggleLayer(id, item.toggleLayer);
        } else if (item.id === 'toggle-legend') {
          actions.toggleLegend(id);
        } else if (item.id === 'toggle-inset') {
          actions.toggleInset(id);
        } else if (item.id === 'bake' && !baking) {
          baking = true;
          schedule();
          try {
            await actions.bakeHighRes(id);
          } finally {
            baking = false;
            schedule();
          }
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

  function renderStepRow(id, exploringId, props) {
    if (!stepEl || !doc) return;
    stepEl.replaceChildren();

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
        bakeBtn.textContent = baking ? '10m 베이크 중…' : '10m 고해상도 베이크';
        bakeBtn.addEventListener('click', async e => {
          e.preventDefault();
          e.stopPropagation();
          if (baking) return;
          baking = true;
          schedule();
          try {
            await actions.bakeFromExplore?.(id);
          } finally {
            baking = false;
            schedule();
          }
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
      stepEl.hidden = true;
      return;
    }

    const msg = doc.createElement('span');
    if (activeTool.mode === 'annotation') {
      msg.textContent = '지도 위를 클릭해 지시선 라벨을 배치하세요';
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
      msg.textContent = `경로 꼭짓점 ${activeTool.coords.length}개 · 클릭 추가`;
      const styleBtn = doc.createElement('button');
      styleBtn.type = 'button';
      styleBtn.textContent = activeTool.doubleLine ? '이중선' : '단선';
      styleBtn.setAttribute('aria-pressed', String(activeTool.doubleLine));
      styleBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (activeTool) {
          activeTool.doubleLine = !activeTool.doubleLine;
          schedule();
        }
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
      stepEl.append(msg, styleBtn, finishBtn);
    } else if (activeTool.mode === 'highlight') {
      msg.textContent = '국가·성·도를 클릭해 강조를 토글하세요';
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
      const isMode = bid === '' || bid === 'explore' || ['annotation', 'point', 'route', 'highlight'].includes(bid);
      const pressed = isMode
        ? bid === currentMode
        : Boolean(resolved && (
            (bid === 'toggle-borders' && resolved.baseLayers.borders)
            || (bid === 'toggle-rivers' && resolved.baseLayers.rivers)
            || (bid === 'toggle-legend' && resolved.legend.enabled)
            || (bid === 'toggle-inset' && resolved.inset.enabled)
          ));
      btn.setAttribute('aria-pressed', String(pressed));
    }

    renderStepRow(id, exploringId, props);
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
    } else if (mode === 'route') {
      activeTool.coords.push([geo.lon, geo.lat]);
      schedule();
    } else if (mode === 'highlight') {
      const level = geo.resolved.baseLayers.admin1 ? 'admin1' : 'admin0';
      const hit = hitTestAdminFeature(geo.lon, geo.lat, level, props.bakedDetail);
      if (hit?.code) actions.toggleHighlight(id, hit.level, hit.code);
    }
  }

  function onDblClick(e) {
    if (activeTool?.mode === 'route' && activeTool.mountEl.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
    }
  }

  function onKeyDown(e) {
    if (!activeTool) return;
    if (promptEl?.contains(e.target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      clearTool();
    } else if (e.key === 'Enter' && activeTool.mode === 'route') {
      e.preventDefault();
      e.stopPropagation();
      finishRoute();
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
    doc.addEventListener('dblclick', onDblClick, true);
    doc.addEventListener('keydown', onKeyDown, true);
    schedule();
  }

  attach();
  const offSurface = provider?.subscribe?.(attach);
  const offFrames = context?.services?.get?.('canvas.frames')?.subscribe?.(schedule);
  const offWorld = context?.world?.subscribe?.(schedule);

  return {
    startTool,
    clearTool,
    refresh: schedule,
    getActiveTool: () => (activeTool ? { id: activeTool.id, mode: activeTool.mode } : null),
    dispose() {
      offWorld?.();
      offFrames?.();
      offSurface?.();
      detach();
    },
  };
}
