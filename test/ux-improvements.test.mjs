import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';

const bootDom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = bootDom.window;
globalThis.document = bootDom.window.document;
globalThis.HTMLElement = bootDom.window.HTMLElement;
globalThis.HTMLInputElement = bootDom.window.HTMLInputElement;
globalThis.HTMLSelectElement = bootDom.window.HTMLSelectElement;
globalThis.Event = bootDom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  default: plugin,
  MAP_ASPECT_ID,
  createMapPropsForRegion,
  createMapPropsFromThematicPreset,
  renderMapDom,
  renderMapSvg,
  whiteMapAspect,
} = await import('../dist/plugin.js');

function createFullHarness(initialProps) {
  const { window } = new JSDOM('<main><div data-entity-id="m1"></div><aside></aside><section id="studio"></section></main>');
  const doc = window.document;
  const surface = doc.querySelector('main');
  const host = surface.firstElementChild;
  const hud = doc.querySelector('aside');
  const studioHost = doc.querySelector('#studio');

  const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
  hud.getBoundingClientRect = () => rect(0, 0, 900, 700);

  let nextFrames = [];
  window.requestAnimationFrame = cb => { nextFrames.push(cb); return nextFrames.length; };
  window.cancelAnimationFrame = () => {};
  const flushFrames = () => {
    while (nextFrames.length) {
      const batch = nextFrames.splice(0);
      for (const fn of batch) fn();
    }
  };

  const entities = new Map([
    ['m1', {
      'core.transform': { x: 40, y: 80, rotation: 0 },
      'core.bounds': { width: 480, height: 360 },
      [MAP_ASPECT_ID]: structuredClone(initialProps),
    }],
  ]);
  let selected = ['m1'];
  const worldListeners = new Set();
  const commands = new Map();

  const repaintDom = () => {
    for (const [id, bag] of entities) {
      let el = surface.querySelector(`[data-entity-id="${id}"]`);
      if (!el) {
        el = doc.createElement('div');
        el.dataset.entityId = id;
        surface.insertBefore(el, hud);
      }
      renderMapDom(el, bag[MAP_ASPECT_ID], {
        x: bag['core.transform'].x,
        y: bag['core.transform'].y,
        width: bag['core.bounds'].width,
        height: bag['core.bounds'].height,
        rotation: 0,
      }, id);
      const mount = el.firstElementChild;
      if (mount) mount.getBoundingClientRect = () => rect(40, 80, 480, 360);
    }
  };
  repaintDom();

  const world = {
    listEntityIds: () => [...entities.keys()],
    isAlive: id => entities.has(id),
    isEntityReadOnly: () => false,
    getCanonical: (id, aspect) => entities.get(id)?.[aspect] ?? null,
    createEntityWithCanonical: (_label, aspects) => {
      const id = `m${entities.size + 1}`;
      entities.set(id, structuredClone(aspects));
      repaintDom();
      for (const fn of worldListeners) fn();
      return id;
    },
    applyCanonicalTransaction: (_label, ops) => {
      for (const op of ops) {
        let bag = entities.get(op.id);
        if (!bag) {
          bag = {};
          entities.set(op.id, bag);
        }
        bag[op.aspect] = { ...(bag[op.aspect] ?? {}), ...structuredClone(op.patch) };
      }
      repaintDom();
      for (const fn of worldListeners) fn();
    },
    subscribe: fn => {
      worldListeners.add(fn);
      return () => worldListeners.delete(fn);
    },
  };

  const active = {
    surface: { element: surface, hud },
    selection: {
      getSelection: () => selected,
      replaceSelection: ids => { selected = [...ids]; },
    },
    host: { getZoom: () => 1, history: { begin() {}, commit() {}, abort() {} } },
  };

  const context = {
    world,
    commands: {
      register: spec => {
        commands.set(spec.id, spec.run);
        return () => commands.delete(spec.id);
      },
    },
    services: {
      get: name => {
        if (name === 'canvas.active-tool-surface') return { get: () => active, subscribe: () => () => {} };
        if (name === 'canvas.frames') return { subscribe: () => () => {} };
        return undefined;
      },
    },
  };

  const activated = plugin.activate(context);
  flushFrames();

  return {
    window,
    doc,
    hud,
    host,
    studioHost,
    entities,
    world,
    commands,
    activated,
    flushFrames,
    getMount: () => host.firstElementChild,
    getProps: (id = 'm1') => entities.get(id)?.[MAP_ASPECT_ID],
    setSelected: ids => { selected = ids; activated.api.menubar.refresh(); flushFrames(); },
    getSelected: () => selected,
    worldListeners,
  };
}

test('UX 1: highlight tool offers A/B/C/D slots, explicit unit picker, and hover outline preview before click', () => {
  const baseProps = {
    ...createMapPropsForRegion('korea'),
    centerLon: 126.978,
    centerLat: 37.572,
    scale: 4200,
    showKrProvinces: false,
    showKrDistricts: false,
  };
  const h = createFullHarness(baseProps);
  const { window, hud } = h;
  const bar = hud.querySelector('[data-wm-menubar]');
  bar.querySelector('[data-wm-tool-btn="highlight"]').click();
  h.flushFrames();

  // Verify A/B/C/D slot chips and unit selector chips exist
  assert.equal(bar.querySelectorAll('[data-wm-hl-slot]').length, 4);
  assert.equal(bar.querySelector('[data-wm-hl-slot="A"]').getAttribute('aria-pressed'), 'true');

  // Switch unit explicitly to kr-sgg even while district boundary lines are OFF
  bar.querySelector('[data-wm-hl-level="kr-sgg"]').click();
  h.flushFrames();

  const mount = h.getMount();
  // Hover over centre (Jongno-gu: 126.978, 37.572 -> clientX 280, clientY 260)
  mount.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 280, clientY: 260 }));
  const previewPath = mount.querySelector('[data-wm-draft-overlay="true"] [data-wm-hover-preview="true"]');
  assert.ok(previewPath && previewPath.getAttribute('d')?.length > 10, 'hover outline path should render before click');
  assert.match(bar.querySelector('[data-wm-hover-name]').textContent, /종로구.*11110/);

  // Click to highlight into slot A, then switch to slot C (hatch) and reassign
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 280, clientY: 260 }));
  assert.equal(h.getProps().highlights.length, 1);
  assert.equal(h.getProps().highlights[0].legendLabel, 'A');
  assert.equal(h.getProps().showLegend, true);

  bar.querySelector('[data-wm-hl-slot="C"]').click();
  h.flushFrames();
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 280, clientY: 260 }));
  assert.equal(h.getProps().highlights.length, 1);
  assert.equal(h.getProps().highlights[0].legendLabel, 'C');
  assert.equal(h.getProps().highlights[0].pattern, 'hatch');

  // Pure SVG export never includes transient draft overlay
  const { svg } = renderMapSvg(h.getProps());
  assert.doesNotMatch(svg, /data-wm-draft-overlay/);
  h.activated.dispose();
});

test('UX 2: route & region tools render live ghost previews, undo vertices on Backspace, and annotations support dblclick edit & dual handles', () => {
  const h = createFullHarness(createMapPropsFromThematicPreset('csat-dongbei'));
  const { window, doc, hud } = h;
  const bar = hud.querySelector('[data-wm-menubar]');
  const mount = h.getMount();

  // 2A. Route ghost rubber-band + Backspace undo
  bar.querySelector('[data-wm-tool-btn="route"]').click();
  h.flushFrames();
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 210 }));
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 260, clientY: 240 }));
  mount.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 310, clientY: 270 }));
  h.flushFrames();
  assert.ok(mount.querySelector('[data-wm-ghost-placed="true"]'));
  assert.ok(mount.querySelector('[data-wm-ghost-rubber="true"]'));
  assert.match(bar.querySelector('.stem-step').textContent, /꼭짓점 2개/);

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  h.flushFrames();
  assert.match(bar.querySelector('.stem-step').textContent, /꼭짓점 1개/);

  // 2B. Region polygon tool with hatch fill
  bar.querySelector('[data-wm-tool-btn="region"]').click();
  h.flushFrames();
  bar.querySelector('[data-wm-region-style="hatch"]').click();
  h.flushFrames();
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200 }));
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 280, clientY: 200 }));
  mount.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 250, clientY: 270 }));
  mount.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 220, clientY: 260 }));
  assert.ok(mount.querySelector('polygon[data-wm-ghost-polygon="true"]'));

  const prevLayers = h.getProps().customLayers.length;
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  h.flushFrames();
  assert.equal(h.getProps().customLayers.length, prevLayers + 1);
  const createdPoly = h.getProps().customLayers.at(-1);
  assert.equal(createdPoly.kind, 'polygon');
  assert.equal(createdPoly.style.pattern, 'hatch');
  assert.equal(createdPoly.geojson.features[0].geometry.coordinates[0].length, 4);
  assert.equal(mount.querySelector('[data-wm-draft-overlay="true"]'), null);

  // 2C. Annotation dual handles (anchor + label) and double-click inline edit with Korean IME protection
  h.flushFrames();
  const anchorHandle = hud.querySelector('[data-wm-gizmo="ann-anchor"]');
  const labelHandle = hud.querySelector('[data-wm-gizmo="ann-label"]');
  assert.ok(anchorHandle && labelHandle, 'selected map annotations expose both anchor and label handles');

  const beforeAnn = structuredClone(h.getProps().annotations[0]);
  const fireDrag = (el, x0, y0, x1, y1) => {
    for (const [t, x, y] of [['pointerdown', x0, y0], ['pointermove', x1, y1], ['pointerup', x1, y1]]) {
      const ev = new window.MouseEvent(t, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(ev, 'pointerId', { value: 7 });
      el.dispatchEvent(ev);
    }
  };
  fireDrag(anchorHandle, 200, 200, 220, 215);
  const afterAnchorDrag = h.getProps().annotations[0];
  assert.notEqual(afterAnchorDrag.lon, beforeAnn.lon);
  assert.equal(afterAnchorDrag.dx, beforeAnn.dx - 20);
  assert.equal(afterAnchorDrag.dy, beforeAnn.dy - 15);

  const annEl = h.getMount().querySelector('[data-map-drag^="annotation:"]');
  annEl.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 240, clientY: 220 }));
  const promptInput = hud.querySelector('[data-wm-annotation-prompt] input');
  assert.ok(promptInput);
  assert.equal(promptInput.value, afterAnchorDrag.text);

  // Korean IME composition Enter must NOT prematurely commit
  promptInput.dispatchEvent(new window.Event('compositionstart'));
  promptInput.value = '선양';
  promptInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.ok(hud.querySelector('[data-wm-annotation-prompt]'), 'prompt stays open during IME composition');
  promptInput.dispatchEvent(new window.Event('compositionend'));
  promptInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(h.getProps().annotations[0].text, '선양');

  h.activated.dispose();
});

test('UX 3: Auto-LOD detail button acts as a stateful aria-pressed toggle when zoomed out and shows quiet loading status when zoomed in', async () => {
  // Zoomed-out map (scale 265 < 1800): turns Auto-LOD flag on with deferred hint
  const hOut = createFullHarness(createMapPropsForRegion('east-asia-oceania'));
  const barOut = hOut.hud.querySelector('[data-wm-menubar]');
  const bakeBtnOut = barOut.querySelector('[data-wm-tool-btn="bake"]');
  assert.equal(bakeBtnOut.getAttribute('aria-pressed'), 'false');

  bakeBtnOut.click();
  await new Promise(r => setTimeout(r, 10));
  hOut.flushFrames();
  assert.equal(hOut.getProps().bakedDetail, true);
  assert.equal(bakeBtnOut.getAttribute('aria-pressed'), 'true');
  assert.match(barOut.querySelector('.stem-step').textContent, /자동 상세화 켜짐/);

  bakeBtnOut.click();
  await new Promise(r => setTimeout(r, 10));
  hOut.flushFrames();
  assert.equal(hOut.getProps().bakedDetail, false);
  assert.equal(bakeBtnOut.getAttribute('aria-pressed'), 'false');
  hOut.activated.dispose();

  // Zoomed-in map (korea, scale 2350 >= 1800): shows quiet background tile loading indicator and can still toggle off immediately
  const prevFetch = globalThis.fetch;
  let releaseTile;
  globalThis.fetch = () => new Promise(resolve => { releaseTile = () => resolve({ ok: false, status: 503 }); });
  try {
    const hIn = createFullHarness(createMapPropsForRegion('korea'));
    const barIn = hIn.hud.querySelector('[data-wm-menubar]');
    const bakeBtnIn = barIn.querySelector('[data-wm-tool-btn="bake"]');
    bakeBtnIn.click();
    await new Promise(r => setTimeout(r, 10));
    hIn.flushFrames();
    assert.equal(bakeBtnIn.getAttribute('aria-pressed'), 'true');
    assert.ok(barIn.querySelector('[data-wm-tile-loading="true"]'));

    // Toggling off works immediately without blocking on pending tile requests
    bakeBtnIn.click();
    await new Promise(r => setTimeout(r, 10));
    hIn.flushFrames();
    assert.equal(hIn.getProps().bakedDetail, false);
    assert.equal(bakeBtnIn.getAttribute('aria-pressed'), 'false');
    releaseTile?.();
    hIn.activated.dispose();
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('UX 4: Studio panel guards preset overwrite, imports dropped GIS files, and edits layers/highlights/annotations inline', async () => {
  const h = createFullHarness(createMapPropsFromThematicPreset('csat-dongbei'));
  const { window, doc, studioHost, commands, world } = h;
  const panelSpec = whiteMapAspect.ui.panels[0];

  const savedGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    Event: globalThis.Event,
  };
  Object.assign(globalThis, {
    window,
    document: doc,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Event: window.Event,
  });

  let unmount;
  try {
    await act(async () => {
      unmount = panelSpec.mount(studioHost, {
        world,
        getSelectedIds: () => h.getSelected(),
        onSelectionChange: () => () => {},
        onWorldMutated: cb => world.subscribe(cb),
        executeCommand: (cmdId, args) => commands.get(cmdId)?.(args),
      });
    });

    // 4A. Clicking a preset while current map has edits opens confirmation instead of overwriting
    const presetBtn = studioHost.querySelector('[data-wm-thematic-btn="csat-fehmarn-corridor"]');
    await act(async () => { presetBtn.click(); });
    assert.equal(h.getProps('m1').regionPreset, 'northeast-china', 'existing work was not overwritten');
    const confirmBox = studioHost.querySelector('[data-wm-preset-confirm="true"]');
    assert.ok(confirmBox, 'overwrite guard banner is displayed');

    await act(async () => {
      confirmBox.querySelector('[data-wm-confirm-insert="true"]').click();
    });
    assert.equal(h.entities.size, 2, 'chose to insert as a new white map');
    const newId = [...h.entities.keys()].find(k => k !== 'm1');
    assert.equal(h.getProps(newId).regionPreset, 'denmark-germany');

    // Switch selection back to m1 for inline editing & file drop tests
    await act(async () => {
      h.setSelected(['m1']);
      for (const fn of h.worldListeners) fn();
    });

    // 4B. File drop imports .csv directly as a custom layer
    const dropzone = studioHost.querySelector('[data-wm-gis-dropzone="true"]');
    assert.ok(dropzone);
    const mockFile = {
      name: 'jeju-points.csv',
      text: async () => 'name,lon,lat\n제주,126.53,33.50\n서귀포,126.56,33.25',
    };
    await act(async () => {
      const dropEv = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEv, 'dataTransfer', { value: { files: [mockFile] } });
      dropzone.dispatchEvent(dropEv);
      await new Promise(r => setTimeout(r, 10));
    });
    assert.ok(h.getProps('m1').customLayers.some(l => l.name === 'jeju-points'));

    // 4C. Inline editing of highlight pattern & annotation text
    const patternSelect = studioHost.querySelector('[aria-label="강조 그룹 무늬 수정"]');
    assert.ok(patternSelect);
    await act(async () => {
      const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      selectSetter.call(patternSelect, 'hatch');
      patternSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(h.getProps('m1').highlights[0].pattern, 'hatch');

    const annInput = studioHost.querySelector('[aria-label="지시선 라벨 텍스트 수정"]');
    assert.ok(annInput);
    await act(async () => {
      annInput.focus();
      const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inputSetter.call(annInput, '(가) 산업 지대');
      annInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      annInput.blur();
    });
    assert.equal(h.getProps('m1').annotations[0].text, '(가) 산업 지대');
  } finally {
    if (unmount) await act(async () => { unmount(); });
    h.activated.dispose();
    for (const [k, v] of Object.entries(savedGlobals)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
});

test('UX 5: Props Inspector prioritizes print style, layers, and legend open at top and collapses fine-tuning sections', () => {
  const inspectorControls = whiteMapAspect.ui.controls.filter(c => c.placement === 'inspector');
  const sections = [];
  const firstOfSection = new Map();
  for (const ctrl of inspectorControls) {
    if (!firstOfSection.has(ctrl.section)) {
      sections.push(ctrl.section);
      firstOfSection.set(ctrl.section, ctrl);
    }
  }
  assert.deepEqual(sections, [
    '수능 인쇄 스타일',
    '기본 레이어',
    '범례 · 위치 소지도',
    '시점 · 좌표 미세조정',
    '세부 색상 · 선 굵기',
    '고급 CSS',
  ]);
  assert.ok(!firstOfSection.get('수능 인쇄 스타일').sectionCollapsed);
  assert.ok(!firstOfSection.get('기본 레이어').sectionCollapsed);
  assert.ok(!firstOfSection.get('범례 · 위치 소지도').sectionCollapsed);
  assert.equal(firstOfSection.get('시점 · 좌표 미세조정').sectionCollapsed, true);
  assert.equal(firstOfSection.get('세부 색상 · 선 굵기').sectionCollapsed, true);
  assert.equal(firstOfSection.get('고급 CSS').sectionCollapsed, true);
  assert.ok(inspectorControls.some(c => c.field === 'bakedDetail' && c.kind === 'toggle'));
});
