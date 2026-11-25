import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import config, { sharedImports } from '../vite.config.js';

async function bundle(source) {
  const directory = await mkdtemp(join(tmpdir(), 'alid-white-map-bundle-'));
  try {
    const entry = join(directory, 'entry.js');
    await writeFile(entry, source);
    const result = await build({
      ...config,
      configFile: false,
      logLevel: 'silent',
      build: { ...config.build, write: false, lib: { ...config.build.lib, entry } },
    });
    return (Array.isArray(result) ? result[0] : result).output;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('SDK and React imports stay external and resolve through host sharedImports', async () => {
  const imports = sharedImports.map((id, i) => `import * as s${i} from '${id}';`).join('\n');
  const output = await bundle(`${imports}\nexport default [${sharedImports.map((_, i) => `s${i}`).join(',')}];`);
  assert.equal(output.length, 1);
  assert.deepEqual([...output[0].imports].sort(), [...sharedImports].sort());
  const executable = output[0].code.replace(/^\s*\/\*![\s\S]*?\*\//, '');
  assert.ok(executable.length < 4000);
});

test('built dist/plugin.js stays under 5 MiB and only imports from host sharedImports', async () => {
  const url = new URL('../dist/plugin.js', import.meta.url);
  const info = await stat(url);
  assert.ok(info.size < 5 * 1024 * 1024, `Bundle size ${info.size} must stay under 5 MiB`);
  const code = await readFile(url, 'utf8');
  const staticImports = [...code.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm)].map(m => m[1]);
  for (const spec of staticImports) {
    assert.ok(sharedImports.includes(spec), `Unexpected external import "${spec}"`);
  }
  assert.ok(!code.includes('__require("react")'));
});
