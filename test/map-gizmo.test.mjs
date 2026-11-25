import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MAP_ASPECT_ID,
  createMapPropsFromThematicPreset,
  mountMapGizmos,
  renderMapDom,
} from '../dist/plugin.js';

test('selected white-map shows dashed rubber-band and move gizmo for legend and inset, drags cleanly, and clears on deselect', () => {
  const { window } = new JSDOM('<main><div data-entity-id="m1"></div><aside></aside></main>');
  const doc = window.document;
  const surface = doc.querySelector('main');
  const host = surface.firstElementChild;
  const hud = doc.querySelector('aside');

  const props = createMapPropsFromThematicPreset('csat-fehmarn-corridor');
  renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');

  const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
  hud.getBoundingClientRect = () => rect(0, 0, 600, 500);
  for (const el of host.querySelectorAll('[data-map-box-frame]')) {
    el.getBoundingClientRect = () => rect(20, 220, 90, 60);
  }

  let selected = ['m1'];
  let paintFrame = null;
  let onFrame = null;
  const committed = [];
  window.requestAnimationFrame = cb => { paintFrame = cb; return 1; };
  window.cancelAnimationFrame = () => {};

  const active = {
    surface: { element: surface, hud },
    selection: { getSelection: () => selected },
    host: { getZoom: () => 1 },
  };
  const dispose = mountMapGizmos(
    {
      world: { getCanonical: (_id, a) => (a === MAP_ASPECT_ID ? props : { rotation: 0 }) },
      services: { get: name => (name === 'canvas.frames' ? { subscribe: cb => { onFrame = cb; } } : { get: () => active }) },
    },
    { commitDragOffset: (id, kind, dx, dy) => committed.push([id, kind, dx, dy]) },
  );

  paintFrame();
  assert.ok(hud.querySelector('[data-wm-rubber-band="legend"]'));
  assert.ok(hud.querySelector('[data-wm-rubber-band="inset"]'));
  const legendHandle = hud.querySelector('[data-wm-gizmo="legend"]');
  assert.ok(legendHandle);

  const fire = (type, x, y) => {
    const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: 3 });
    legendHandle.dispatchEvent(e);
  };
  fire('pointerdown', 100, 220);
  fire('pointermove', 130, 200);
  fire('pointerup', 130, 200);
  assert.deepEqual(committed, [['m1', 'legend', 30, -20]]);

  selected = [];
  onFrame();
  paintFrame();
  assert.equal(hud.childElementCount, 0);
  dispose();
});
