import { MAP_ASPECT_ID } from './manifest.js';
import { normalizeOffset } from './model.js';

const DRAG_SELECTOR = '[data-map-drag]';

/**
 * Renders selection-space dashed rubber-band outlines and 4-way move gizmos on
 * legend boxes & inset locator maps, and enables dragging legend, inset, and leader-line labels.
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
      band.remove();
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
            color: 'var(--alid-accent, #2563eb)',
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
            background: 'var(--alid-accent, #2563eb)',
            color: '#ffffff',
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
    }

    for (const [key, entry] of overlays) {
      if (!seen.has(key)) {
        entry.band.remove();
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

  function stopDrag(save) {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.style.translate = d.oldTranslate;
    if (d.captured && surface?.hasPointerCapture?.(d.pointerId)) {
      try { surface.releasePointerCapture(d.pointerId); } catch {}
    }
    if (save && d.moved && !context.world.isEntityReadOnly?.(d.id)) {
      actions.commitDragOffset(d.id, d.kind, d.dx, d.dy);
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

    drag = {
      id,
      kind,
      el: targetEl,
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
    d.el.style.translate = `${d.dx}px ${d.dy}px`;
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
