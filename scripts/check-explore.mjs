// Browser regression: verifies double-click map exploration (pan + wheel lock-in + Esc commit),
// Alid canvas zoom independence (50%, 140%, 200%), and bundled CMU Serif webfont loading.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const chrome = process.env.CHROME_PATH ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome');

const tmp = await mkdtemp(join(tmpdir(), 'white-map-explore-'));
try {
  const entry = join(tmp, 'entry.js');
  const domMod = fileURLToPath(new URL('../src/dom-renderer.js', import.meta.url));
  const expMod = fileURLToPath(new URL('../src/map-explorer.js', import.meta.url));
  const modelMod = fileURLToPath(new URL('../src/model.js', import.meta.url));
  const manifestMod = fileURLToPath(new URL('../src/manifest.js', import.meta.url));

  await writeFile(
    entry,
    `import { renderMapDom } from ${JSON.stringify(domMod)};
     import { mountMapExplorer } from ${JSON.stringify(expMod)};
     import { createMapPropsFromThematicPreset } from ${JSON.stringify(modelMod)};
     import { MAP_ASPECT_ID } from ${JSON.stringify(manifestMod)};

     const surface = document.createElement('div');
     const stage = document.createElement('div');
     const host = document.createElement('div');
     const hud = document.createElement('div');
     hud.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
     surface.style.cssText = 'position:relative;width:900px;height:700px;';
     stage.style.transformOrigin = '0 0';
     host.style.cssText = 'width:480px;transform-origin:0 0;';
     stage.append(host);
     surface.append(stage, hud);
     document.body.append(surface);

     let props = createMapPropsFromThematicPreset('csat-dongbei');
     const commits = [];
     let leakedWheel = 0;
     surface.addEventListener('wheel', e => {
       if (!e.target.closest?.('[data-canvas-ui]')) leakedWheel++;
     });

     const context = {
       world: {
         getCanonical: (id, aspect) => aspect === MAP_ASPECT_ID ? props : { width: 480, height: 360, x: 0, y: 0, rotation: 0 },
       },
       services: {
         get: name => name === 'canvas.active-tool-surface'
           ? { get: () => ({ surface: { element: surface, hud }, selection: { getSelection: () => ['m1'] }, host: { getZoom: () => 1 } }) }
           : undefined,
       },
     };

     async function verify() {
       for (const [zoom, bake] of [[0.5, 0.5], [1.4, 1], [2, 2]]) {
         stage.style.transform = 'scale(' + (zoom / bake) + ')';
         host.style.transform = 'scale(' + bake + ')';
         renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');
         const box = host.firstElementChild.getBoundingClientRect();
         if (Math.abs(box.width - 480 * zoom) > 0.2 || Math.abs(box.height - 360 * zoom) > 0.2) {
           throw new Error('Zoom mismatch at ' + zoom + ': ' + JSON.stringify(box));
         }
       }

       // Reset to 100% and verify bundled CMU Serif webfont loads
       stage.style.transform = 'scale(1)';
       host.style.transform = 'scale(1)';
       renderMapDom(host, props, { x: 0, y: 0, width: 480, height: 360, rotation: 0 }, 'm1');
       for (const weight of [400, 700]) {
         const faces = await document.fonts.load(weight + ' 14px "CMU Serif"', '0° A B');
         if (!faces.some(f => f.status === 'loaded')) throw new Error('CMU Serif failed: ' + weight);
       }

       const explorer = mountMapExplorer(context, {
         commitViewport: (id, vp) => { commits.push([id, vp]); props = { ...props, viewport: vp }; },
         toggleHighlight: () => {},
         bakeHighRes: async () => {},
       });

       const mount = host.firstElementChild;
       mount.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
       if (mount.dataset.canvasUi !== 'true' || mount.dataset.escapeOwner !== 'true') {
         throw new Error('Double-click did not lock canvas input');
       }

       const beforeVp = explorer.getActiveViewport();
       const r = mount.getBoundingClientRect();
       mount.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: r.left + 200, clientY: r.top + 150 }));
       const afterWheel = explorer.getActiveViewport();
       if (!(afterWheel.scale > beforeVp.scale)) throw new Error('Wheel did not zoom inside map');
       if (leakedWheel !== 0) throw new Error('Wheel leaked to Alid canvas');

       mount.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: r.left + 200, clientY: r.top + 150 }));
       mount.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: r.left + 250, clientY: r.top + 190 }));
       mount.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: r.left + 250, clientY: r.top + 190 }));
       const afterPan = explorer.getActiveViewport();
       if (afterPan.centerLon === afterWheel.centerLon && afterPan.centerLat === afterWheel.centerLat) {
         throw new Error('Drag did not pan map viewport');
       }
       if (commits.length !== 0) throw new Error('Committed prematurely before exit');

       document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
       if (explorer.getActiveId() !== null || mount.dataset.canvasUi) throw new Error('Esc did not exit exploration');
       if (commits.length !== 1) throw new Error('Expected single atomic Undo commit, got ' + commits.length);

       explorer.dispose();
       return 'OK';
     }

     verify()
       .then(res => { document.querySelector('pre').textContent = res; })
       .catch(err => { document.querySelector('pre').textContent = 'ERR: ' + err.message; });`,
  );

  const result = await build({
    configFile: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { lib: { entry, formats: ['iife'], name: 'exploreCheck' }, write: false },
  });
  await writeFile(join(tmp, 'check.js'), (Array.isArray(result) ? result[0] : result).output[0].code);
  await writeFile(join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><pre>waiting</pre><script>onerror=m=>document.querySelector("pre").textContent="ERR:"+m</script><script src="check.js"></script>');

  const html = execFileSync(
    chrome,
    ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--user-data-dir=' + join(tmp, 'profile'), '--virtual-time-budget=8000', '--dump-dom', 'file://' + join(tmp, 'index.html')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 25000 },
  );
  assert.equal(html.match(/<pre>(.*?)<\/pre>/s)?.[1], 'OK');
  console.log('Chrome: zoom 50%/140%/200%, CMU Serif webfont, double-click map explore pan+wheel lock-in, and Esc atomic commit passed.');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
