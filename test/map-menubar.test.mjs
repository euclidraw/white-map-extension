import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MAP_ASPECT_ID,
  createMapPropsFromThematicPreset,
  mountMapMenubar,
  renderMapDom,
  renderMapSvg,
  whiteMapAspect,
} from '../dist/plugin.js';

test('top-fixed HUD toolbar shows on selection with CSS hover tooltips, step bar, and places annotations/points/routes', () => {
  const { window } = new JSDOM('<main><div data-entity-id="m1"></div><aside></aside></main>');
  const doc = window.document;
  const surface = doc.querySelector('main');
  const host = surface.firstElementChild;
  const hud = doc.querySelector('aside');

  const props = createMapPropsFromThematicPreset('csat-dongbei');
  renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');
  const mount = host.firstElementChild;

  const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
  hud.getBoundingClientRect = () => rect(0, 0, 800, 600);
  mount.getBoundingClientRect = () => rect(40, 80, 480, 360);

  let selected = [];
  let nextFrame = null;
  window.requestAnimationFrame = cb => { nextFrame = cb; return 1; };
  window.cancelAnimationFrame = () => {};

  const addedAnnotations = [];
  const addedPoints = [];
  const addedLayers = [];
  const toggled = [];

  const context = {
    world: {
      getCanonical: (_id, a) => (a === MAP_ASPECT_ID ? props : { width: 480, height: 360, x: 0, y: 0, rotation: 0 }),
    },
    services: {
      get: name => (name === 'canvas.active-tool-surface'
        ? { get: () => ({ surface: { element: surface, hud }, selection: { getSelection: () => selected }, host: { getZoom: () => 1 } }) }
        : undefined),
    },
  };

  const menubar = mountMapMenubar(context, {
    enterExplore: () => {},
    exitExplore: () => {},
    getExploringId: () => null,
    getExploringViewport: () => null,
    addAnnotation: (id, ann) => addedAnnotations.push([id, ann]),
    addCustomPoint: (id, lon, lat, marker) => addedPoints.push([id, lon, lat, marker]),
    addCustomLayer: (id, layer) => addedLayers.push([id, layer]),
    toggleHighlight: () => {},
    toggleLayer: (id, layer) => toggled.push([id, layer]),
    toggleLegend: id => toggled.push([id, 'legend']),
    toggleInset: id => toggled.push([id, 'inset']),
    bakeHighRes: async () => {},
  });

  // Hidden when nothing is selected
  nextFrame?.();
  const bar = hud.querySelector('[data-wm-menubar].stem-toolbar');
  assert.ok(bar);
  assert.equal(bar.hidden, true);
  assert.ok(bar.querySelector(':scope > .stem-toolbar-row[role=toolbar] > .stem-sep'));
  assert.ok(bar.querySelector('button > .stem-tooltip[role=tooltip]'));

  // Selecting the white map reveals the top-fixed toolbar with hover tooltips
  selected = ['m1'];
  menubar.refresh();
  nextFrame?.();
  assert.equal(bar.hidden, false);

  const annBtn = bar.querySelector('[data-wm-tool-btn="annotation"]');
  const tip = annBtn.querySelector('[role="tooltip"]');
  assert.ok(tip && tip.textContent.includes('지시선 라벨'));

  // Clicking annotation tool activates the contextual step bar and locks map input
  annBtn.click();
  nextFrame?.();
  assert.equal(menubar.getActiveTool()?.mode, 'annotation');
  assert.equal(mount.dataset.canvasUi, 'true');
  const step = bar.querySelector('.stem-step');
  assert.equal(step.hidden, false);
  assert.ok(step.textContent.includes('지시선 라벨'));

  // Clicking map opens inline input; Enter commits annotation
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 240, clientY: 220 }));
  const promptInput = hud.querySelector('[data-wm-annotation-prompt] input');
  assert.ok(promptInput, 'inline annotation input should appear');
  promptInput.value = '하얼빈';
  promptInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(addedAnnotations.length, 1);
  assert.equal(addedAnnotations[0][1].text, '하얼빈');
  assert.equal(addedAnnotations[0][1].leaderLine, true);
  assert.ok(Number.isFinite(addedAnnotations[0][1].lon) && Number.isFinite(addedAnnotations[0][1].lat));

  // Point marker tool clicks directly place a marker
  bar.querySelector('[data-wm-tool-btn="point"]').click();
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 260, clientY: 240 }));
  assert.equal(addedPoints.length, 1);
  assert.equal(addedPoints[0][3], 'bullseye');

  // Route drawing tool collects clicks and commits LineString on Enter
  bar.querySelector('[data-wm-tool-btn="route"]').click();
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 180, clientY: 200 }));
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 260 }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(addedLayers.length, 1);
  assert.equal(addedLayers[0][1].kind, 'line');
  assert.equal(addedLayers[0][1].geojson.features[0].geometry.coordinates.length, 2);

  // Quick toggle buttons trigger layer/legend actions
  bar.querySelector('[data-wm-tool-btn="toggle-rivers"]').click();
  bar.querySelector('[data-wm-tool-btn="toggle-legend"]').click();
  assert.deepEqual(toggled, [['m1', 'rivers'], ['m1', 'legend']]);

  menubar.dispose();
});

test('all scalar properties are exposed in Inspector Props controls and override SVG output directly', () => {
  const inspectorControls = whiteMapAspect.ui.controls.filter(c => c.placement === 'inspector');
  const fields = new Set(inspectorControls.map(c => c.field).filter(Boolean));
  for (const expected of [
    'title', 'projection', 'centerLon', 'centerLat', 'scale', 'rotateLon',
    'showCoastline', 'showBorders', 'showAdmin1', 'showRivers', 'showLakes', 'graticule',
    'showLegend', 'legendCorner', 'showInset', 'insetRegion', 'insetCorner',
    'stylePreset', 'oceanColor', 'landColor', 'highlightColor', 'inkColor',
    'coastWidth', 'borderDash', 'fontStyle', 'customCss',
  ]) {
    assert.ok(fields.has(expected), `Inspector Props panel must expose ${expected}`);
  }

  const base = createMapPropsFromThematicPreset('csat-dongbei');
  const edited = {
    ...base,
    showRivers: true,
    oceanColor: '#e2e2e2',
    coastWidth: 1.7,
    borderDash: '7 2',
    showInset: true,
    fontStyle: 'sans-serif',
  };
  const { svg } = renderMapSvg(edited, undefined, 'props-direct');
  assert.ok(svg.includes('data-map-layer="rivers"'));
  assert.ok(svg.includes('fill="#e2e2e2"'));
  assert.ok(svg.includes('stroke-width="1.7"'));
  assert.ok(svg.includes('stroke-dasharray="7 2"'));
  assert.ok(svg.includes('data-map-drag="inset"'));
});
