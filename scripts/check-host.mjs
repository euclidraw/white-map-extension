import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import plugin from '../dist/plugin.js';
import { registerWhiteMapTools } from '../src/tools.js';

const host = resolve(process.env.ALID_PATH ?? '../alid');
const dir = await mkdtemp(join(tmpdir(), 'white-map-host-'));

try {
  const entry = join(dir, 'entry.js');
  await writeFile(
    entry,
    [
      `export { CommandRegistry } from ${JSON.stringify(join(host, 'packages/kernel/src/commands.ts'))};`,
      `export { ServiceRegistry } from ${JSON.stringify(join(host, 'packages/kernel/src/services.ts'))};`,
      `export { ExtensionRuntimeRegistry } from ${JSON.stringify(join(host, 'packages/kernel/src/extension-controller.ts'))};`,
      `export { CanvasWorld } from ${JSON.stringify(join(host, 'packages/kernel/src/kernel-data.ts'))};`,
      `export { SceneVectorCompiler } from ${JSON.stringify(join(host, 'packages/kernel/src/scene-compiler.ts'))};`,
      `export { installPorcelainExtension } from ${JSON.stringify(join(host, 'packages/kernel/src/porcelain-and-trust.ts'))};`,
      `export { createWorkspaceChanges } from ${JSON.stringify(join(host, 'packages/kernel/src/workspace-changes.ts'))};`,
      `export { WorkspaceToolRegistry } from ${JSON.stringify(join(host, 'packages/kernel/src/workspace-tools.ts'))};`,
      `export { validateRepositoryManifest, validatePluginSpec } from ${JSON.stringify(join(host, 'apps/playground/src/repository-plugins.ts'))};`,
    ].join('\n'),
  );

  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'stub-quickjs',
        resolveId(id) {
          if (id === 'quickjs-emscripten') return '\0quickjs-emscripten';
          return null;
        },
        load(id) {
          if (id === '\0quickjs-emscripten') return 'export const getQuickJS = async () => ({}); export default {};';
          return null;
        },
      },
    ],
    build: {
      target: 'esnext',
      outDir: join(dir, 'out'),
      lib: { entry, formats: ['es'], fileName: () => 'host.mjs' },
    },
  });

  const {
    CanvasWorld,
    installPorcelainExtension,
    SceneVectorCompiler,
    CommandRegistry,
    ServiceRegistry,
    ExtensionRuntimeRegistry,
    createWorkspaceChanges,
    WorkspaceToolRegistry,
    validateRepositoryManifest,
    validatePluginSpec,
  } = await import(pathToFileURL(join(dir, 'out/host.mjs')));

  // 1. Validate alid.extension.json and dist/plugin.js against host repository installer validators
  const rawManifest = JSON.parse(await readFile(new URL('../alid.extension.json', import.meta.url), 'utf8'));
  const validatedManifest = validateRepositoryManifest(rawManifest);
  validatePluginSpec(plugin, validatedManifest);

  // 2. Load real Rust WasmCanvasCore and verify world + compiler + Undo/Redo
  const wasm = await import(pathToFileURL(join(host, 'crates/ecanvas-core/pkg/ecanvas_core.js')));
  await wasm.default({
    module_or_path: await readFile(join(host, 'crates/ecanvas-core/pkg/ecanvas_core_bg.wasm')),
  });
  const core = new wasm.WasmCanvasCore();
  let commits = 0;
  const world = new CanvasWorld({
    commitCanonicalBatch(bytes, origin) {
      commits++;
      core.commit_canonical_batch(bytes, origin);
    },
    updateSpatialBounds() {},
  });
  const compiler = new SceneVectorCompiler();
  world.registerCanonical({ id: 'core.transform', defaults: { x: 0, y: 0, rotation: 0 } });
  world.registerCanonical({ id: 'core.bounds', defaults: { width: 480 }, optionalFields: ['height'] });
  world.registerComputed({
    id: 'computed.layoutBounds',
    symbol: 'test:bounds',
    dependsOnCanonical: ['core.transform', 'core.bounds'],
    compute(id, view) {
      const t = view.getCanonical(id, 'core.transform');
      const b = view.getCanonical(id, 'core.bounds');
      return t && b ? { ...t, ...b } : undefined;
    },
  });

  const specs = [];
  for (const spec of plugin.aspects) {
    installPorcelainExtension(
      spec,
      world,
      {
        registerExtension(s) {
          specs.push(s);
          return compiler.registerExtension(s);
        },
      },
      'trusted-tier1',
    );
  }

  let selected = [];
  const runtime = plugin.activate({
    world,
    commands: { register() { return () => {}; } },
    services: {
      get(name) {
        if (name === 'canvas.creation') {
          return {
            create(request) {
              const id = `ent_map_${crypto.randomUUID()}`;
              world.validateCanonicalSnapshot({ [id]: request.aspects });
              core.begin_undo_group();
              try {
                world.applyCanonicalTransaction(request.caller, [
                  { id, aspect: 'core.transform', patch: { x: request.x ?? 80, y: request.y ?? 80, rotation: 0 } },
                  { id, aspect: 'core.bounds', patch: { width: request.width, ...(request.height !== undefined ? { height: request.height } : {}) } },
                  ...Object.entries(request.aspects).map(([aspect, patch]) => ({ id, aspect, patch })),
                ]);
                core.end_undo_group();
              } catch (error) {
                core.abort_undo_group();
                world.replaceCanonicalSnapshot(core.get_canonical_json());
                throw error;
              }
              selected = [id];
              return id;
            },
          };
        }
        if (name === 'canvas.active-tool-surface') {
          return {
            get: () => ({
              selection: { getSelection: () => selected, select(id) { selected = [id]; } },
              host: {
                history: {
                  begin() { core.begin_undo_group(); },
                  commit() { core.end_undo_group(); },
                  abort() { core.abort_undo_group(); world.replaceCanonicalSnapshot(core.get_canonical_json()); },
                },
              },
            }),
          };
        }
        return undefined;
      },
    },
  });

  const createdId = runtime.api.run('insert-map', { thematicId: 'csat-dongbei' });
  assert.ok(createdId, 'insert-map creates a white-map entity');
  assert.equal(commits, 1);

  const before = commits;
  const snapshot = core.dump_canonical_jsonl();
  const svg = compiler.compileToPureSvg(world);
  assert.ok(svg.includes('data-entity-id'));
  assert.ok(svg.includes('data-white-map="true"'));
  assert.ok(!svg.includes('foreignObject'));
  assert.ok(!svg.replace(/<style>[\s\S]*?<\/style>/g, '').includes('NaN'));
  assert.equal(core.dump_canonical_jsonl(), snapshot);
  assert.equal(commits, before);

  // Verify real Rust Undo / Redo
  assert.equal(core.undo(), true);
  world.replaceCanonicalSnapshot(core.get_canonical_json());
  assert.equal(world.listEntityIds().length, 0);
  assert.equal(core.redo(), true);
  world.replaceCanonicalSnapshot(core.get_canonical_json());
  assert.equal(core.dump_canonical_jsonl(), snapshot);

  // Verify Scratch Overlay isolation
  const preview = world.createScratchOverlay('test:preview');
  preview.set(createdId, 'core.transform', { x: 999999, y: 0, rotation: 0 });
  assert.equal(compiler.compileToPureSvg(world), svg);
  preview.dispose();

  // Verify Copilot WorkspaceToolRegistry + prepareChange approval flow
  const lifetime = new AbortController();
  const changes = createWorkspaceChanges(
    world,
    (caller, ops) => {
      core.begin_undo_group();
      try {
        world.applyCanonicalTransaction(caller, ops);
        core.end_undo_group();
      } catch (error) {
        core.abort_undo_group();
        world.replaceCanonicalSnapshot(core.get_canonical_json());
        throw error;
      }
    },
    () => ({ documentId: 'test-doc', viewId: 'main', signal: lifetime.signal }),
  );
  const toolRegistry = new WorkspaceToolRegistry(changes);
  const access = toolRegistry.forExtension(
    plugin.id,
    plugin.aspects.map(a => a.id),
    () => {},
    () => true,
  );
  const disposeTools = registerWhiteMapTools({
    world,
    services: { get: name => (name === 'workspace.tools' ? access : undefined) },
  });
  const beforePlan = core.dump_canonical_jsonl();
  const beforePlanCommits = commits;
  const proposal = await access.invoke(
    `${plugin.id}:plan-changes`,
    { actions: JSON.stringify([{ action: 'create', id: 'copilot-map-1', patch: { thematicId: 'csat-world-env', title: '세계 환경 분포' } }]) },
    lifetime.signal,
  );
  assert.equal(core.dump_canonical_jsonl(), beforePlan, 'planning must not mutate world');
  assert.equal(commits, beforePlanCommits);
  changes.apply(access.getChangeProposal(proposal.changeProposalId));
  assert.equal(commits, beforePlanCommits + 1, 'applying proposal commits atomically');
  assert.ok(compiler.compileToPureSvg(world).includes('세계 환경 분포'));
  assert.equal(core.undo(), true);
  world.replaceCanonicalSnapshot(core.get_canonical_json());
  assert.equal(core.dump_canonical_jsonl(), beforePlan, 'one Undo reverts the AI map batch');

  disposeTools();
  toolRegistry.dispose();
  lifetime.abort();
  runtime.dispose();
  core.free();

  // Verify ExtensionRuntimeRegistry install/activate/dispose lifecycle
  const world2 = new CanvasWorld({ commitCanonicalBatch() {}, updateSpatialBounds() {} });
  const services = new ServiceRegistry();
  const commands = new CommandRegistry(world2);
  const storage = new Map();
  const registry = new ExtensionRuntimeRegistry(
    { world: world2, compiler: new SceneVectorCompiler(), commands, services },
    { storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, workspaceId: 'integration' },
  );
  registry.registerPackages([{ spec: plugin, manifest: rawManifest }]);
  await registry.activateExtension(plugin.id);
  assert.equal(registry.getSnapshot()[0].state, 'active');
  registry.dispose();

  console.log('Host integration: repository manifest validator, real Rust Undo/Redo, pure SVG compilation, scratch overlay isolation, Copilot prepareChange approval flow, and ExtensionRuntimeRegistry passed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
