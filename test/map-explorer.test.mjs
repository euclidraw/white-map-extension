import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MAP_ASPECT_ID,
  createMapPropsFromThematicPreset,
  mountMapExplorer,
  renderMapDom,
} from '../dist/plugin.js';

test('double-clicking a map seizes drag/wheel inside the frame and commits viewport once on Escape', () => {
  const { window } = new JSDOM('<main><div data-entity-id="m1"></div><aside></aside></main>');
  const doc = window.document;
  const surface = doc.querySelector('main');
  const host = surface.firstElementChild;
  const hud = doc.querySelector('aside');

  let props = createMapPropsFromThematicPreset('csat-dongbei');
  // Inspector values are authoritative; the old nested mirrors may disagree.
  Object.assign(props, { showLakes:false, showRivers:false, baseLayers:{...props.baseLayers,lakes:true,rivers:true} });
  let notifyWorld;
  const commits = [];
  const highlights = [];
  renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');
  const mount = host.firstElementChild;

  const rect = () => ({ left: 0, top: 0, right: 480, bottom: 360, width: 480, height: 360 });
  mount.getBoundingClientRect = rect;
  hud.getBoundingClientRect = rect;
  mount.querySelector('svg').getBoundingClientRect = rect;

  const context = {
    world: {
      subscribe: fn => { notifyWorld=fn; return ()=>{}; },
      getCanonical: (_id, aspect) => (aspect === MAP_ASPECT_ID ? props : { width: 480, height: 360, x: 0, y: 0, rotation: 0 }),
    },
    services: {
      get: name => (name === 'canvas.active-tool-surface'
        ? { get: () => ({ surface: { element: surface, hud }, selection: { getSelection: () => ['m1'] }, host: { getZoom: () => 1 } }) }
        : undefined),
    },
  };

  const explorer = mountMapExplorer(context, {
    commitViewport: (id, vp) => { commits.push([id, vp]); props = { ...props, viewport: vp }; },
    toggleHighlight: (id, level, code) => highlights.push([id, level, code]),
    bakeHighRes: async () => {},
  });

  // Enter exploration via double-click
  mount.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(explorer.getActiveId(), 'm1');
  assert.equal(mount.dataset.canvasUi, 'true');
  assert.equal(mount.dataset.escapeOwner, 'true');
  assert.ok(hud.querySelector('[data-wm-explore-hud]'));

  const water = () => mount.querySelectorAll('[data-map-layer="lakes"], [data-map-layer="rivers"], [data-map-layer="river-areas"]');
  assert.equal(water().length,0);
  props={...props,showRivers:true}; notifyWorld();
  assert.ok(mount.querySelector('[data-map-layer="rivers"]'));
  props={...props,showRivers:false}; notifyWorld();
  assert.equal(water().length,0);

  // Wheel zooms inside map frame and cancels propagation
  const beforeScale = explorer.getActiveViewport().scale;
  const wheelEvent = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -150, clientX: 240, clientY: 180 });
  mount.dispatchEvent(wheelEvent);
  assert.equal(wheelEvent.defaultPrevented, true);
  assert.ok(explorer.getActiveViewport().scale > beforeScale);

  // Drag pans centerLon/centerLat AND visibly updates the SVG live DURING pointermove (before pointerup/Esc!)
  const frames = [];
  window.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  window.cancelAnimationFrame = () => {};
  const beforeLon = explorer.getActiveViewport().centerLon;
  const landBefore = mount.querySelector('[data-map-layer="land"]').getAttribute('d');
  const firePtr = (type, x, y) => {
    const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: 7 });
    mount.dispatchEvent(e);
  };
  firePtr('pointerdown', 240, 180);
  firePtr('pointermove', 300, 210);
  // 1) Immediate pan-layer translate before rAF fires
  assert.equal(mount.querySelector('[data-map-pan-layer="true"]').getAttribute('transform'), 'translate(60.0,30.0)');
  // 2) rAF re-projects the SVG land path LIVE while still dragging (before pointerup!)
  while (frames.length) frames.shift()();
  const landDuringDrag = mount.querySelector('[data-map-layer="land"]').getAttribute('d');
  assert.equal(water().length,0);
  assert.notEqual(landDuringDrag, landBefore, 'SVG land path must visibly update during drag');
  assert.equal(commits.length, 0);
  firePtr('pointerup', 300, 210);
  assert.notEqual(explorer.getActiveViewport().centerLon, beforeLon);
  assert.equal(commits.length, 0);

  // Escape exits exploration, releases Alid input lock, and commits once
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(explorer.getActiveId(), null);
  assert.equal(mount.dataset.canvasUi, undefined);
  assert.equal(mount.dataset.escapeOwner, undefined);
  assert.equal(commits.length, 1);

  explorer.dispose();
});

test('double-click enters exploration even when Alid select-suite retargets dblclick e.target to surface', async () => {
  const { window } = new JSDOM('<main><div data-entity-id="m1"></div><aside></aside></main>');
  const doc = window.document;
  const surface = doc.querySelector('main');
  const host = surface.firstElementChild;
  const hud = doc.querySelector('aside');

  const props = createMapPropsFromThematicPreset('csat-dongbei');
  renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');
  const mount = host.firstElementChild;
  const rect = () => ({ left: 40, top: 60, right: 520, bottom: 420, width: 480, height: 360 });
  mount.getBoundingClientRect = rect;
  hud.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 });

  const context = {
    world: {
      getCanonical: (_id, aspect) => (aspect === MAP_ASPECT_ID ? props : { width: 480, height: 360, x: 40, y: 60, rotation: 0 }),
    },
    services: {
      get: name => (name === 'canvas.active-tool-surface'
        ? { get: () => ({ surface: { element: surface, hud }, selection: { getSelection: () => ['m1'] }, host: { getZoom: () => 1 } }) }
        : undefined),
    },
  };

  const explorer = mountMapExplorer(context, {
    useExternalHud: true,
    commitViewport: () => {},
    toggleHighlight: () => {},
    bakeHighRes: async () => {},
  });

  // Case 1: dblclick dispatched directly on surface (pointer-capture retargeted) at map coordinates
  surface.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
  assert.equal(explorer.getActiveId(), 'm1');
  explorer.exit(false);

  // Case 2: two quick pointerdown/pointerup taps where pointerup is retargeted to surface
  const tap = () => {
    const down = new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 220, clientY: 210 });
    Object.defineProperty(down, 'pointerId', { value: 9 });
    mount.dispatchEvent(down);
    const up = new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 220, clientY: 210 });
    Object.defineProperty(up, 'pointerId', { value: 9 });
    surface.dispatchEvent(up);
  };
  tap();
  tap();
  await new Promise(r => queueMicrotask(r));
  assert.equal(explorer.getActiveId(), 'm1');

  explorer.dispose();
});
