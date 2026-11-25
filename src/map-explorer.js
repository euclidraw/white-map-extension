import { paintMountVector } from './dom-renderer.js';
import {
  bakedCoversBbox,
  computeViewportBbox,
  createMapProjection,
  hitTestAdminFeature,
  isDeepZoomScale,
} from './gis-base.js';
import { MAP_ASPECT_ID } from './manifest.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Double-click map frame explorer:
 * Seizes pointer drag (pan) and wheel/pinch zoom inside the double-clicked map frame
 * by attaching Alid's data-canvas-ui="true" and data-escape-owner="true" to the active map mount.
 * Commits the resulting viewport once on exit (Esc or click outside) as a single Undo group.
 */
export function mountMapExplorer(context, actions) {
  const provider = context?.services?.get?.('canvas.active-tool-surface');
  let surface = null;
  let hud = null;
  let doc = null;
  let active = null; // { id, mountEl, props, width, height, viewport, initialViewport, changed, drag, bar, baking, lastMeta }
  let frame = null;

  function findMount(entityId) {
    if (!surface || !entityId) return null;
    for (const el of surface.querySelectorAll('[data-role="white-map-mount"]')) {
      if (el.dataset.whiteMapId === entityId) return el;
    }
    return null;
  }

  function screenToMapLocal(svgEl, mountEl, clientX, clientY, frameX, frameY) {
    const ctm = svgEl?.getScreenCTM?.();
    if (ctm && typeof ctm.inverse === 'function') {
      const inv = ctm.inverse();
      return {
        x: inv.a * clientX + inv.c * clientY + inv.e - frameX,
        y: inv.b * clientX + inv.d * clientY + inv.f - frameY,
      };
    }
    const svgRect = svgEl?.getBoundingClientRect?.();
    const rect = svgRect?.width && svgRect?.height ? svgRect : mountEl?.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    const vb = svgEl?.viewBox?.baseVal;
    const vw = vb?.width || Number(svgEl?.getAttribute?.('width')) || rect.width;
    const vh = vb?.height || Number(svgEl?.getAttribute?.('height')) || rect.height;
    return {
      x: ((clientX - rect.left) / rect.width) * vw - frameX,
      y: ((clientY - rect.top) / rect.height) * vh - frameY,
    };
  }

  function updateHudBar() {
    if (!active || !active.bar || !hud) return;
    const { mountEl, viewport, props, lastMeta, baking } = active;
    const r = mountEl.getBoundingClientRect();
    const hb = hud.getBoundingClientRect();
    const top = Math.max(6, Math.round(r.top - hb.top - 34));
    const left = Math.max(6, Math.min(Math.max(6, hb.width - 340), Math.round(r.left - hb.left)));
    active.bar.style.transform = `translate(${left}px,${top}px)`;

    const info = active.bar.querySelector('[data-wm-hud-info]');
    if (info) {
      const lonText = `${viewport.centerLon.toFixed(1)}°`;
      const latText = `${viewport.centerLat.toFixed(1)}°`;
      info.textContent = `탐색 중 (${latText}, ${lonText} · ×${Math.round(viewport.scale)})`;
    }

    const bakeBtn = active.bar.querySelector('[data-wm-hud-bake]');
    if (bakeBtn) {
      const needsBake = isDeepZoomScale(viewport.scale) && (!props.bakedDetail || !lastMeta?.useBaked);
      bakeBtn.style.display = needsBake || baking ? 'inline-flex' : 'none';
      bakeBtn.disabled = Boolean(baking);
      bakeBtn.textContent = baking ? '10m 베이크 중…' : '10m 고해상도 베이크';
    }
  }

  function scheduleHud() {
    const win = doc?.defaultView;
    if (win?.requestAnimationFrame && frame == null) {
      frame = win.requestAnimationFrame(() => {
        frame = null;
        updateHudBar();
      });
    }
  }

  function renderPreview() {
    if (!active) return;
    const previewProps = { ...active.props, viewport: active.viewport };
    active.lastMeta = paintMountVector(active.mountEl, previewProps, active.width, active.height, active.id);
    updateHudBar();
    actions.onExploreChange?.(active.id);
  }

  function createHudBar() {
    if (!hud || !doc) return null;
    const bar = doc.createElement('div');
    bar.dataset.canvasUi = 'true';
    bar.dataset.escapeOwner = 'true';
    bar.dataset.wmExploreHud = 'true';
    Object.assign(bar.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      borderRadius: '6px',
      background: '#18181b',
      color: '#ffffff',
      fontSize: '11px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
      pointerEvents: 'auto',
      zIndex: '30',
      whiteSpace: 'nowrap',
    });

    const info = doc.createElement('span');
    info.dataset.wmHudInfo = 'true';
    info.style.fontVariantNumeric = 'tabular-nums';

    const bakeBtn = doc.createElement('button');
    bakeBtn.type = 'button';
    bakeBtn.dataset.wmHudBake = 'true';
    Object.assign(bakeBtn.style, {
      display: 'none',
      padding: '2px 7px',
      borderRadius: '4px',
      border: 'none',
      background: '#2563eb',
      color: '#ffffff',
      fontSize: '10.5px',
      fontWeight: '600',
      cursor: 'pointer',
    });
    bakeBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!active || active.baking) return;
      active.baking = true;
      updateHudBar();
      try {
        // Commit current viewport first so bake uses the exact explored bbox
        if (active.changed) {
          actions.commitViewport(active.id, { ...active.viewport });
          active.changed = false;
        }
        await actions.bakeHighRes(active.id);
        const latest = context.world.getCanonical(active.id, MAP_ASPECT_ID);
        if (active && latest) {
          active.props = latest;
          renderPreview();
        }
      } finally {
        if (active) {
          active.baking = false;
          updateHudBar();
        }
      }
    });

    const doneBtn = doc.createElement('button');
    doneBtn.type = 'button';
    doneBtn.textContent = '완료 (Esc)';
    Object.assign(doneBtn.style, {
      padding: '2px 7px',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'transparent',
      color: '#ffffff',
      fontSize: '10.5px',
      cursor: 'pointer',
    });
    doneBtn.addEventListener('click', e => {
      e.stopPropagation();
      exit(true);
    });

    bar.append(info, bakeBtn, doneBtn);
    hud.append(bar);
    return bar;
  }

  function enter(entityId) {
    if (!surface || !entityId) return false;
    if (active?.id === entityId) return true;
    if (active) exit(true);

    const props = context.world.getCanonical?.(entityId, MAP_ASPECT_ID);
    if (!props || context.world.isEntityReadOnly?.(entityId)) return false;
    const mountEl = findMount(entityId);
    if (!mountEl) return false;

    const bounds = context.world.getCanonical?.(entityId, 'core.bounds') ?? { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT };
    const width = Math.max(160, Math.round(bounds.width || DEFAULT_MAP_WIDTH));
    const height = Math.max(120, Math.round(bounds.height || DEFAULT_MAP_HEIGHT));
    const resolved = resolveMapSpec(props);

    mountEl.dataset.canvasUi = 'true';
    mountEl.dataset.escapeOwner = 'true';
    mountEl.dataset.mapExploring = 'true';

    active = {
      id: entityId,
      mountEl,
      props,
      resolved,
      width,
      height,
      viewport: { ...resolved.viewport },
      initialViewport: { ...resolved.viewport },
      changed: false,
      drag: null,
      baking: false,
      lastMeta: null,
      bar: actions.useExternalHud ? null : createHudBar(),
    };

    renderPreview();
    actions.onExploreChange?.(entityId);
    return true;
  }

  function exit(commit = true) {
    if (!active) return;
    const prev = active;
    active = null;

    if (prev.drag?.captured && prev.mountEl.hasPointerCapture?.(prev.drag.pointerId)) {
      try { prev.mountEl.releasePointerCapture(prev.drag.pointerId); } catch {}
    }
    delete prev.mountEl.dataset.canvasUi;
    delete prev.mountEl.dataset.escapeOwner;
    delete prev.mountEl.dataset.mapExploring;
    prev.mountEl.style.cursor = '';
    prev.bar?.remove();

    if (commit && prev.changed && !context.world.isEntityReadOnly?.(prev.id)) {
      actions.commitViewport(prev.id, {
        centerLon: Math.round(prev.viewport.centerLon * 1000) / 1000,
        centerLat: Math.round(prev.viewport.centerLat * 1000) / 1000,
        scale: Math.round(prev.viewport.scale * 10) / 10,
        rotateLon: prev.viewport.rotateLon ?? 0,
      });
    } else if (!commit) {
      paintMountVector(prev.mountEl, prev.props, prev.width, prev.height, prev.id);
    }
    actions.onExploreChange?.(null);
  }

  function onDblClick(e) {
    if (!surface || !surface.contains(e.target)) return;
    if (e.target.closest?.('[data-map-drag], [data-wm-gizmo]')) return;
    const mountEl = e.target.closest?.('[data-role="white-map-mount"]');
    if (!mountEl || mountEl.dataset.mapTool) return;
    const entityId = mountEl.dataset.whiteMapId;
    if (!entityId) return;
    if (enter(entityId)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onPointerDown(e) {
    if (!active) return;
    if (active.bar?.contains(e.target) || e.target.closest?.('[data-wm-menubar]')) return;
    if (!active.mountEl.contains(e.target)) {
      // Clicking outside the explored map exits and commits
      exit(true);
      return;
    }
    if (e.button !== 0 || e.isPrimary === false) return;
    const svg = active.mountEl.querySelector('svg');
    const frameX = active.lastMeta?.frameX ?? 4;
    const frameY = active.lastMeta?.frameY ?? 4;
    const frameW = active.lastMeta?.frameW ?? (active.width - 8);
    const frameH = active.lastMeta?.frameH ?? (active.height - 8);
    const localStart = screenToMapLocal(svg, active.mountEl, e.clientX, e.clientY, frameX, frameY);
    const proj = createMapProjection(active.resolved.projection, active.viewport, frameW, frameH);
    const startLonLat = proj.invert?.([localStart.x, localStart.y]);

    active.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLocal: localStart,
      startLonLat,
      startViewport: { ...active.viewport },
      moved: false,
      captured: false,
      shiftClick: Boolean(e.shiftKey),
      frameX,
      frameY,
      frameW,
      frameH,
    };
    active.mountEl.style.cursor = 'grabbing';
    try {
      active.mountEl.setPointerCapture?.(e.pointerId);
      active.drag.captured = true;
    } catch {
      // Ignore synthetic events without active pointerId
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!active?.drag || active.drag.pointerId !== e.pointerId) return;
    const d = active.drag;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 2) return;
    d.moved = true;

    const svg = active.mountEl.querySelector('svg');
    const curLocal = screenToMapLocal(svg, active.mountEl, e.clientX, e.clientY, d.frameX, d.frameY);
    const baseProj = createMapProjection(active.resolved.projection, d.startViewport, d.frameW, d.frameH);

    // Compute geographic pan delta by inverting the dragged position in the start projection
    const startCenterPx = [d.frameW / 2, d.frameH / 2];
    const shiftedPx = [
      startCenterPx[0] - (curLocal.x - d.startLocal.x),
      startCenterPx[1] - (curLocal.y - d.startLocal.y),
    ];
    const nextCenter = baseProj.invert?.(shiftedPx);
    if (nextCenter && Number.isFinite(nextCenter[0]) && Number.isFinite(nextCenter[1])) {
      let nextLon = nextCenter[0];
      while (nextLon > 180) nextLon -= 360;
      while (nextLon < -180) nextLon += 360;
      active.viewport = {
        ...d.startViewport,
        centerLon: nextLon,
        centerLat: clamp(nextCenter[1], -80, 80),
      };
      active.changed = true;
      renderPreview();
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerUp(e) {
    if (!active?.drag || active.drag.pointerId !== e.pointerId) return;
    const d = active.drag;
    active.drag = null;
    active.mountEl.style.cursor = 'grab';
    if (d.captured && active.mountEl.hasPointerCapture?.(e.pointerId)) {
      try { active.mountEl.releasePointerCapture(e.pointerId); } catch {}
    }

    // Shift+Click without drag toggles Admin-0 or Admin-1 region highlight right under the cursor
    if (!d.moved && d.shiftClick && d.startLonLat) {
      const level = active.resolved.baseLayers.admin1 ? 'admin1' : 'admin0';
      const hit = hitTestAdminFeature(d.startLonLat[0], d.startLonLat[1], level, active.props.bakedDetail);
      if (hit?.code) {
        actions.toggleHighlight(active.id, hit.level, hit.code);
        const latest = context.world.getCanonical(active.id, MAP_ASPECT_ID);
        if (latest) {
          active.props = latest;
          renderPreview();
        }
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onWheel(e) {
    if (!active || !active.mountEl.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    const svg = active.mountEl.querySelector('svg');
    const frameX = active.lastMeta?.frameX ?? 4;
    const frameY = active.lastMeta?.frameY ?? 4;
    const frameW = active.lastMeta?.frameW ?? (active.width - 8);
    const frameH = active.lastMeta?.frameH ?? (active.height - 8);
    const local = screenToMapLocal(svg, active.mountEl, e.clientX, e.clientY, frameX, frameY);

    const beforeProj = createMapProjection(active.resolved.projection, active.viewport, frameW, frameH);
    const anchorGeo = beforeProj.invert?.([local.x, local.y]);

    const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1;
    const factor = Math.exp(-e.deltaY * line * 0.0022);
    const nextScale = clamp(active.viewport.scale * factor, 30, 40000);
    let nextViewport = { ...active.viewport, scale: nextScale };

    // Anchor zoom around cursor position
    if (anchorGeo && Number.isFinite(anchorGeo[0]) && Number.isFinite(anchorGeo[1])) {
      const midProj = createMapProjection(active.resolved.projection, nextViewport, frameW, frameH);
      const afterPx = midProj(anchorGeo);
      if (afterPx && Number.isFinite(afterPx[0]) && Number.isFinite(afterPx[1])) {
        const dx = afterPx[0] - local.x;
        const dy = afterPx[1] - local.y;
        const shiftedCenter = midProj.invert?.([frameW / 2 + dx, frameH / 2 + dy]);
        if (shiftedCenter && Number.isFinite(shiftedCenter[0]) && Number.isFinite(shiftedCenter[1])) {
          let nextLon = shiftedCenter[0];
          while (nextLon > 180) nextLon -= 360;
          while (nextLon < -180) nextLon += 360;
          nextViewport = {
            ...nextViewport,
            centerLon: nextLon,
            centerLat: clamp(shiftedCenter[1], -80, 80),
          };
        }
      }
    }

    active.viewport = nextViewport;
    active.changed = true;
    renderPreview();
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit(true);
    }
  }

  function detach() {
    exit(false);
    if (frame != null) {
      doc?.defaultView?.cancelAnimationFrame?.(frame);
      frame = null;
    }
    if (doc) {
      doc.removeEventListener('dblclick', onDblClick, true);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointermove', onPointerMove, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      doc.removeEventListener('pointercancel', onPointerUp, true);
      doc.removeEventListener('wheel', onWheel, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    }
    doc = surface = hud = null;
  }

  function attach() {
    const s = provider?.get?.();
    const nextSurface = s?.surface?.element ?? null;
    const nextHud = s?.surface?.hud ?? null;
    if (nextSurface === surface && nextHud === hud) {
      scheduleHud();
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
    doc.addEventListener('dblclick', onDblClick, true);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);
    doc.addEventListener('wheel', onWheel, { capture: true, passive: false });
    doc.addEventListener('keydown', onKeyDown, true);
  }

  attach();
  const offSurface = provider?.subscribe?.(attach);
  const offFrames = context?.services?.get?.('canvas.frames')?.subscribe?.(() => {
    if (active) scheduleHud();
  });

  return {
    enter,
    exit,
    getActiveId: () => active?.id ?? null,
    getActiveViewport: () => (active ? { ...active.viewport } : null),
    dispose() {
      offFrames?.();
      offSurface?.();
      detach();
    },
  };
}
