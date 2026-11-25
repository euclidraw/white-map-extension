import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENSION_ID, MAP_ASPECT_ID, registerWhiteMapTools } from '../dist/plugin.js';

test('workspace.tools registers catalog, search, and prepareChange approval plan without mutating world', async () => {
  const entities = new Map();
  const tools = new Map();
  const descriptors = [];
  const proposals = [];

  const world = {
    listEntityIds: () => [...entities.keys()],
    isAlive: id => entities.has(id),
    getCanonical: (id, aspect) => entities.get(id)?.[aspect],
    applyCanonicalTransaction(_caller, ops) {
      for (const op of ops) {
        if (op.patch === null) entities.delete(op.id);
        else {
          const entry = entities.get(op.id) ?? {};
          entry[op.aspect] = { ...(entry[op.aspect] ?? {}), ...op.patch };
          entities.set(op.id, entry);
        }
      }
    },
  };

  const service = {
    register(spec) { tools.set(spec.id, spec); return () => tools.delete(spec.id); },
    registerDescriptor(desc) { descriptors.push(desc); return () => {}; },
    prepareChange(ops) {
      const p = { changeProposalId: `p-${proposals.length + 1}`, operations: ops };
      proposals.push(p);
      return p;
    },
  };

  const dispose = registerWhiteMapTools({
    world,
    services: { get: name => (name === 'workspace.tools' ? service : undefined) },
  });

  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].aspect, MAP_ASPECT_ID);

  const catalogRes = await tools.get(`${EXTENSION_ID}:catalog`).execute({}, {});
  assert.ok(catalogRes.regions.length >= 10);
  assert.equal(catalogRes.stylePresets.length, 5);
  assert.equal(catalogRes.thematicPresets.length, 5);

  const proposal = await tools.get(`${EXTENSION_ID}:plan-changes`).execute({
    actions: JSON.stringify([
      { action: 'create', id: 'map-1', x: 60, y: 80, width: 480, height: 340, patch: { thematicId: 'csat-ea-countries', title: '동아시아' } },
    ]),
  }, {});
  assert.equal(world.listEntityIds().length, 0);
  assert.equal(proposal.operations.length, 3);

  world.applyCanonicalTransaction('test:approve', proposal.operations);
  const searchRes = await tools.get(`${EXTENSION_ID}:search`).execute({ query: '동아시아' }, {});
  assert.equal(searchRes.total, 1);
  assert.equal(searchRes.maps[0].id, 'map-1');

  dispose();
});
