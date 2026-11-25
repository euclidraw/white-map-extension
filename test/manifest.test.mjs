import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../scripts/install-manifest.mjs';
import { validateConfig, validateRange } from '../scripts/validate-config.mjs';
import { createPackageManifest } from '../src/manifest.js';

test('extension.json validates cleanly and generates diagram.white-map.map aspect', async () => {
  const cfg = await readConfig();
  const manifest = createPackageManifest(cfg);
  assert.equal(manifest.id, 'diagram.white-map');
  assert.deepEqual(manifest.provides.aspects, ['diagram.white-map.map']);
});

test('config validation rejects reserved namespaces, invalid versions, and unsafe ranges', () => {
  assert.throws(() => validateConfig({ id: 'core.map', title: 'x', summary: 'x', version: '0.1.0', engine: '^0.1.0', dependencies: {}, optionalDependencies: {}, conflicts: [], provides: { services: [], hsmSlots: [] } }));
  assert.throws(() => validateRange('latest'));
  assert.doesNotThrow(() => validateRange('^0.1.1'));
});
