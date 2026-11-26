import { frameLayout } from './frame-layout.js';
import { MAP_ASPECT_ID } from './manifest.js';
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, resolveMapSpec } from './model.js';

const DRAG_SELECTOR = '[data-map-drag]';

function framePointToHud(mount, svg, frameX, frameY, px, py, hudRect, mapW, mapH) {
  const x = frameX + px;
  const y = frameY + py;
  const m = svg?.getScreenCTM?.();
  if (m) {
    return {
      x: m.a * x + m.c * y + m.e - hudRect.left,
      y: m.b * x + m.d * y + m.f - hudRect.top,
    };
  }
  const svgRect = svg?.getBoundingClientRect?.();
  const r = svgRect?.width && svgRect?.height ? svgRect : mount.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    x: r.left + (x / mapW) * r.width - hudRect.left,
    y: r.top + (y / mapH) * r.height - hudRect.top,
  };
}

/**
 * Renders selection-space dashed rubber-band outlines and 4-way move gizmos on
 * legend boxes & inset locator maps, plus anchor/label handles on leader-line annotations.
 */
export function mountMapGizmos(context, actions) {
  const provider = context?.services?.get?.('canvas.active-tool-surface');
  const overlays = new Map();
  const handleToTarget = new WeakMap();
  let surface = null;
  let hud = null;
  let doc = null;
  let drag = null;
  let frame = null;

  function clearOverlays() {
    for (const { band, handle } of overlays.values()) {
      band?.remove();
      handle.remove();
    }
    overlays.clear();
  }

  function paint() {
    const active = provider?.get?.();
    const el = active?.surface?.element;
    const activeHud = active?.surface?.hud;
    const selected = active?.selection?.getSelection?.() ?? [];
    if (!el || !activeHud || !selected.length || active.host?.isSelectionEnabled?.() === false) {
      clearOverlays();
      return;
    }
    const hudRect = activeHud.getBoundingClientRect();
    const seen = new Set();
    const selectedSet = new Set(selected);

    for (const mount of el.querySelectorAll('[data-role="white-map-mount"]')) {
      const id = mount.dataset.whiteMapId;
      if (!selectedSet.has(id) || mount.dataset.mapExploring === 'true' || mount.dataset.mapTool || context.world.isEntityReadOnly?.(id)) {
        continue;
      }
      for (const boxGroup of mount.querySelectorAll('[data-map-drag="legend"], [data-map-drag="inset"]')) {
        const frameEl = boxGroup.querySelector('[data-map-box-frame]') ?? boxGroup;
        const r = frameEl.getBoundingClientRect();
        if (!r.width || !r.height || r.right <= hudRect.left || r.left >= hudRect.right || r.bottom <= hudRect.top || r.top >= hudRect.bottom) {
          continue;
        }
        const kind = boxGroup.dataset.mapDrag;
        const key = JSON.stringify([id, kind]);
        seen.add(key);

        let entry = overlays.get(key);
        if (!entry) {
          const band = activeHud.ownerDocument.createElement('span');
          band.dataset.wmRubberBand = kind;
          band.setAttribute('aria-hidden', 'true');
          Object.assign(band.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            boxSizing: 'border-box',
            border: '1px dashed currentColor',
            color: 'var(--alid-accent, #008FF0)',
            pointerEvents: 'none',
            transformOrigin: 'center',
          });

          const handle = activeHud.ownerDocument.createElement('span');
          handle.dataset.wmGizmo = kind;
          handle.dataset.canvasUi = 'true';
          handle.title = kind === 'inset' ? '드래그하여 위치 소지도 이동' : '드래그하여 범례 이동';
          handle.innerHTML = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v14M1 8h14M5.5 3.5 8 1l2.5 2.5M5.5 12.5 8 15l2.5-2.5M3.5 5.5 1 8l2.5 2.5M12.5 5.5 15 8l-2.5 2.5"/></svg>';
          Object.assign(handle.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            boxSizing: 'border-box',
            width: '20px',
            height: '20px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '4px',
            border: '1px solid #ffffff',
            background: 'var(--alid-accent, #008FF0)',
            color: 'var(--alid-accent-contrast, #ffffff)',
            pointerEvents: 'auto',
            touchAction: 'none',
            userSelect: 'none',
            cursor: 'grab',
          });

          entry = { band, handle };
          overlays.set(key, entry);
          activeHud.append(band, handle);
        }

        handleToTarget.set(entry.handle, { id, kind, targetEl: boxGroup });

        const matrix = frameEl.getScreenCTM?.();
        const zoom = active.host?.getZoom?.() ?? 1;
        const angle = matrix ? Math.atan2(matrix.b, matrix.a) : (context.world.getCanonical?.(id, 'core.transform')?.rotation ?? 0);
        const local = frameEl.getBBox?.();
        const w = (matrix && local ? local.width * Math.hypot(matrix.a, matrix.b) : r.width) || r.width;
        const h = (matrix && local ? local.height * Math.hypot(matrix.c, matrix.d) : r.height) || r.height;
        const cx = r.left + r.width / 2 - hudRect.left;
        const cy = r.top + r.height / 2 - hudRect.top;

        entry.band.style.width = `${w + 4}px`;
        entry.band.style.height = `${h + 4}px`;
        entry.band.style.transform = `translate(${cx - w / 2 - 2}px,${cy - h / 2 - 2}px) rotate(${angle}rad)`;

        const right = cx + (Math.cos(angle) * w + Math.sin(angle) * h) / 2;
        const top = cy + (Math.sin(angle) * w - Math.cos(angle) * h) / 2;
        const hx = Math.max(0, Math.min(Math.max(0, hudRect.width - 20), right - 10));
        const hy = Math.max(0, Math.min(Math.max(0, hudRect.height - 20), top - 10));
        entry.handle.style.transform = `translate(${hx}px,${hy}px)`;
      }

      // Leader-line annotation anchor & label endpoint handles
      const svg = mount.querySelector('svg');
      const props = context.world.getCanonical?.(id, MAP_ASPECT_ID);
      const bounds = context.world.getCanonical?.(id, 'core.bounds');
      const mapW = bounds?.width || DEFAULT_MAP_WIDTH;
      const mapH = bounds?.height || DEFAULT_MAP_HEIGHT;
      const resolved = props ? resolveMapSpec(props) : null;
      const { frameX, frameY } = frameLayout(mapW, mapH, resolved || {});

      for (const annGroup of mount.querySelectorAll('[data-map-drag^="annotation:"]')) {
        const annId = annGroup.dataset.annId;
        const baseAx = Number(annGroup.dataset.annAx);
        const baseAy = Number(annGroup.dataset.annAy);
        const baseLx = Number(annGroup.dataset.annLx);
        const baseLy = Number(annGroup.dataset.annLy);
        if (!annId || !Number.isFinite(baseAx) || !Number.isFinite(baseAy) || !Number.isFinite(baseLx) || !Number.isFinite(baseLy)) {
          continue;
        }
        const draggingAnchor = drag?.id === id && drag.kind === `ann-anchor:${annId}`;
        const draggingLabel = drag?.id === id && (drag.kind === `annotation:${annId}` || drag.kind === `ann-label:${annId}`);
        const ax = draggingAnchor ? baseAx + drag.dx : baseAx;
        const ay = draggingAnchor ? baseAy + drag.dy : baseAy;
        const lx = draggingLabel ? baseLx + drag.dx : baseLx;
        const ly = draggingLabel ? baseLy + drag.dy : baseLy;

        const anchorHud = framePointToHud(mount, svg, frameX, frameY, ax, ay, hudRect, mapW, mapH);
        const labelHud = framePointToHud(mount, svg, frameX, frameY, lx, ly, hudRect, mapW, mapH);
        if (!anchorHud || !labelHud) continue;
        const labelShift = Math.hypot(labelHud.x - anchorHud.x, labelHud.y - anchorHud.y) < 8 ? 10 : 0;

        for (const [role, pt, isAnchor] of [
          [`ann-anchor:${annId}`, anchorHud, true],
          [`ann-label:${annId}`, { x: labelHud.x + labelShift, y: labelHud.y }, false],
        ]) {
          if (pt.x < -8 || pt.x > hudRect.width + 8 || pt.y < -8 || pt.y > hudRect.height + 8) continue;
          const key = JSON.stringify([id, role]);
          seen.add(key);
          let entry = overlays.get(key);
          if (!entry) {
            const handle = activeHud.ownerDocument.createElement('span');
            handle.dataset.wmGizmo = isAnchor ? 'ann-anchor' : 'ann-label';
            handle.dataset.wmAnnId = annId;
            handle.dataset.canvasUi = 'true';
            handle.title = isAnchor
              ? '드래그하여 지시선 기준점 이동'
              : '드래그하여 라벨 위치 이동 · 더블클릭하여 텍스트 수정';
            Object.assign(handle.style, {
              position: 'absolute',
              left: '0',
              top: '0',
              boxSizing: 'border-box',
              width: '10px',
              height: '10px',
              borderRadius: '999px',
              border: isAnchor ? '2px solid var(--alid-accent, #008FF0)' : '1.5px solid #ffffff',
              background: isAnchor ? '#ffffff' : 'var(--alid-accent, #008FF0)',
              pointerEvents: 'auto',
              touchAction: 'none',
              userSelect: 'none',
              cursor: isAnchor ? 'crosshair' : 'grab',
            });
            entry = { band: null, handle };
            overlays.set(key, entry);
            activeHud.append(handle);
          }
          handleToTarget.set(entry.handle, { id, kind: role, targetEl: annGroup });
          entry.handle.style.transform = `translate(${Math.round(pt.x - 5)}px,${Math.round(pt.y - 5)}px)`;
        }
      }
    }

    for (const [key, entry] of overlays) {
      if (!seen.has(key)) {
        entry.band?.remove();
        entry.handle.remove();
        overlays.delete(key);
      }
    }
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

  function resetPreviewTransform(d) {
    d.el.style.translate = d.oldTranslate;
    if (d.lineEl) {
      if (d.oldX1 != null) d.lineEl.setAttribute('x1', d.oldX1);
      if (d.oldY1 != null) d.lineEl.setAttribute('y1', d.oldY1);
      if (d.oldX2 != null) d.lineEl.setAttribute('x2', d.oldX2);
      if (d.oldY2 != null) d.lineEl.setAttribute('y2', d.oldY2);
    }
    if (d.textEls) {
      for (const [el, prev] of d.textEls) el.style.translate = prev;
    }
  }

  function applyPreviewTransform(d) {
    if (d.kind.startsWith('ann-anchor:')) {
      if (d.lineEl && Number.isFinite(d.baseAx) && Number.isFinite(d.baseAy)) {
        d.lineEl.setAttribute('x1', String(d.baseAx + d.dx));
        d.lineEl.setAttribute('y1', String(d.baseAy + d.dy));
      }
      return;
    }
    if ((d.kind.startsWith('annotation:') || d.kind.startsWith('ann-label:')) && d.lineEl && d.textEls?.length) {
      d.lineEl.setAttribute('x2', String(d.baseLx + d.dx));
      d.lineEl.setAttribute('y2', String(d.baseLy + d.dy));
      for (const [el] of d.textEls) el.style.translate = `${d.dx}px ${d.dy}px`;
      return;
    }
    d.el.style.translate = `${d.dx}px ${d.dy}px`;
  }

  function stopDrag(save) {
    if (!drag) return;
    const d = drag;
    drag = null;
    resetPreviewTransform(d);
    if (d.captured && surface?.hasPointerCapture?.(d.pointerId)) {
      try { surface.releasePointerCapture(d.pointerId); } catch {}
    }
    if (save && d.moved && !context.world.isEntityReadOnly?.(d.id)) {
      const commitKind = d.kind.startsWith('ann-label:')
        ? `annotation:${d.kind.slice('ann-label:'.length)}`
        : d.kind;
      actions.commitDragOffset(d.id, commitKind, d.dx, d.dy);
    }
    schedule();
  }

  function onPointerDown(e) {
    if (drag || e.button !== 0 || e.isPrimary === false || !surface) return;
    const gizmoHit = e.target.closest?.('[data-wm-gizmo]');
    let targetEl = null;
    let id = null;
    let kind = null;

    if (gizmoHit && handleToTarget.has(gizmoHit)) {
      const meta = handleToTarget.get(gizmoHit);
      targetEl = meta.targetEl;
      id = meta.id;
      kind = meta.kind;
    } else if (surface.contains(e.target)) {
      const mount = e.target.closest?.('[data-role="white-map-mount"]');
      if (!mount || mount.dataset.mapExploring === 'true' || mount.dataset.mapTool) return;
      targetEl = e.target.closest?.(DRAG_SELECTOR);
      if (!targetEl) return;
      id = mount.dataset.whiteMapId;
      kind = targetEl.dataset.mapDrag;
    } else {
      return;
    }

    if (!id || !kind || context.world.isEntityReadOnly?.(id)) return;
    const svg = targetEl.ownerSVGElement;
    const matrix = svg?.getScreenCTM?.()?.inverse?.();
    const zoom = provider?.get?.()?.host?.getZoom?.() || 1;
    const rotation = context.world.getCanonical?.(id, 'core.transform')?.rotation ?? 0;
    const localDelta = matrix
      ? (x, y) => ({ x: matrix.a * x + matrix.c * y, y: matrix.b * x + matrix.d * y })
      : (x, y) => ({
          x: (Math.cos(rotation) * x + Math.sin(rotation) * y) / zoom,
          y: (-Math.sin(rotation) * x + Math.cos(rotation) * y) / zoom,
        });

    const lineEl = targetEl.querySelector?.('line') ?? null;
    const textEls = [...(targetEl.querySelectorAll?.('text') ?? [])].map(el => [el, el.style.translate]);
    drag = {
      id,
      kind,
      el: targetEl,
      lineEl,
      textEls,
      baseAx: Number(targetEl.dataset?.annAx),
      baseAy: Number(targetEl.dataset?.annAy),
      baseLx: Number(targetEl.dataset?.annLx),
      baseLy: Number(targetEl.dataset?.annLy),
      oldX1: lineEl?.getAttribute('x1') ?? null,
      oldY1: lineEl?.getAttribute('y1') ?? null,
      oldX2: lineEl?.getAttribute('x2') ?? null,
      oldY2: lineEl?.getAttribute('y2') ?? null,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      localDelta,
      oldTranslate: targetEl.style.translate,
      dx: 0,
      dy: 0,
      moved: false,
      captured: false,
    };
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const d = drag;
    const sx = e.clientX - d.startX;
    const sy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(sx, sy) < 3) return;
    if (!d.moved && surface?.setPointerCapture && surface.isConnected) {
      try {
        surface.setPointerCapture(e.pointerId);
        d.captured = true;
      } catch {}
    }
    d.moved = true;
    const delta = d.localDelta(sx, sy);
    d.dx = Math.round(delta.x);
    d.dy = Math.round(delta.y);
    applyPreviewTransform(d);
    schedule();
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerUp(e) {
    if (drag?.pointerId === e.pointerId) {
      const moved = drag.moved;
      stopDrag(true);
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  function onCancel(e) {
    if (drag?.pointerId === e.pointerId) stopDrag(false);
  }

  function onKeyDown(e) {
    if (drag && e.key === 'Escape') {
      stopDrag(false);
      e.stopPropagation();
    }
  }

  const listeners = {
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp,
    pointercancel: onCancel,
    lostpointercapture: onCancel,
    keydown: onKeyDown,
  };

  function detach() {
    stopDrag(false);
    if (frame != null) {
      doc?.defaultView?.cancelAnimationFrame?.(frame);
      frame = null;
    }
    clearOverlays();
    if (doc) {
      for (const [k, fn] of Object.entries(listeners)) doc.removeEventListener(k, fn, true);
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
    for (const [k, fn] of Object.entries(listeners)) doc.addEventListener(k, fn, true);
    schedule();
  }

  attach();
  const offSurface = provider?.subscribe?.(attach);
  const offFrames = context?.services?.get?.('canvas.frames')?.subscribe?.(schedule);

  return () => {
    offFrames?.();
    offSurface?.();
    detach();
  };
}
