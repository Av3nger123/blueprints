import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SOURCE } from './constants.js';
import { loadBlueprint, UnsupportedStackError } from './load.js';
import { buildRegistry, findEntry, NotFoundError, readRegistry, resolveDependencies, searchRegistry, serializeRegistry } from './registry.js';
import { type FetchLike, resolveSource, SourceError } from './source.js';
import type { Registry, RegistryEntry } from './types.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** A fetch that serves the repository checkout as if it were the remote registry. */
function repoFetch(log: string[] = []): FetchLike {
  return async (url) => {
    log.push(url);
    const prefix = 'https://example.test/reg/';
    if (!url.startsWith(prefix)) return { ok: false, status: 404, text: async () => 'not found' };
    const rel = decodeURIComponent(url.slice(prefix.length));
    if (rel === 'registry.json') {
      // Serve a freshly built registry so this test does not depend on the committed file being current.
      const body = serializeRegistry((await buildRegistry(REPO)).registry);
      return { ok: true, status: 200, text: async () => body };
    }
    try {
      const body = await readFile(join(REPO, rel), 'utf8');
      return { ok: true, status: 200, text: async () => body };
    } catch {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
  };
}

test('resolveSource: default, URL and local path', () => {
  assert.deepEqual(resolveSource(), { kind: 'remote', baseUrl: DEFAULT_SOURCE });
  assert.deepEqual(resolveSource('https://x.test/reg/'), { kind: 'remote', baseUrl: 'https://x.test/reg' });
  assert.deepEqual(resolveSource('./bp', '/work'), { kind: 'local', root: '/work/bp' });
  assert.deepEqual(resolveSource('/abs/bp'), { kind: 'local', root: '/abs/bp' });
});

test('DEFAULT_SOURCE points at the GitHub raw registry', () => {
  assert.equal(DEFAULT_SOURCE, 'https://raw.githubusercontent.com/Av3nger123/blueprints/main');
});

test('buildRegistry produces a clean entry for auth with every file listed', async () => {
  const { registry, results } = await buildRegistry(REPO);
  assert.deepEqual(results.flatMap((r) => r.errors), []);
  const auth = findEntry(registry, 'auth');
  assert.equal(auth.path, 'blueprints/auth');
  assert.deepEqual(auth.stacks, ['express', 'fastapi', 'nextjs']);
  for (const f of ['blueprint.yaml', 'BLUEPRINT.md', 'adapters/express.md', 'verify/checklist.md', 'verify/tests/run.mjs']) {
    assert.ok(auth.files.includes(f), f);
  }
  assert.ok(serializeRegistry(registry).endsWith('}\n'));
});

test('readRegistry and loadBlueprint over HTTP fetch only what is needed', async () => {
  const log: string[] = [];
  const source = resolveSource('https://example.test/reg');
  const fetch = repoFetch(log);
  const registry = await readRegistry(source, { fetch });
  const bp = await loadBlueprint(source, 'auth', { fetch, registry, stack: 'express', skipGenerated: true });
  assert.ok(bp.files['BLUEPRINT.md']?.startsWith('# Authentication & Authorization'));
  assert.ok(bp.files['adapters/express.md']);
  assert.equal(bp.files['adapters/fastapi.md'], undefined);
  assert.equal(bp.files['SKILL.md'], undefined);
  assert.equal(bp.manifest.name, 'auth');
  assert.ok(!log.some((u) => u.includes('fastapi')), 'must not fetch other adapters');
});

test('loadBlueprint with `only` returns just those files', async () => {
  const bp = await loadBlueprint(resolveSource(REPO), 'auth', { only: ['BLUEPRINT.md', 'verify/checklist.md'] });
  assert.deepEqual(Object.keys(bp.files).sort(), ['BLUEPRINT.md', 'verify/checklist.md']);
});

test('errors: unknown blueprint, unsupported stack, HTTP failure, unsafe registry paths', async () => {
  const source = resolveSource(REPO);
  await assert.rejects(loadBlueprint(source, 'authz'), (e: Error) => e instanceof NotFoundError && /Did you mean: auth/.test(e.message));
  await assert.rejects(loadBlueprint(source, 'auth', { stack: 'rails' }), UnsupportedStackError);
  await assert.rejects(readRegistry(resolveSource('https://example.test/nope'), { fetch: repoFetch() }), SourceError);

  const evil: FetchLike = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ blueprints: [{ name: 'x', path: '../etc', files: ['passwd'] }] }),
  });
  await assert.rejects(readRegistry(resolveSource('https://example.test/reg'), { fetch: evil }), /Unsafe path/);
});

const entry = (name: string, version: string, deps: [string, string][] = [], extra: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name, version, title: name, summary: `${name} summary`, category: 'security', stacks: ['express'], status: 'draft',
  tags: [], depends_on: deps.map(([n, v]) => ({ name: n, version: v })), path: `blueprints/${name}`, files: [], ...extra,
});

test('resolveDependencies orders dependencies first and rejects bad graphs', () => {
  const reg: Registry = {
    spec_version: '0.1',
    blueprints: [entry('app', '1.0.0', [['auth', '^1.0.0'], ['audit', '~2.1.0']]), entry('auth', '1.4.0', [['audit', '^2.0.0']]), entry('audit', '2.1.3')],
  };
  assert.deepEqual(resolveDependencies(reg, 'app').map((e) => e.name), ['audit', 'auth']);
  assert.deepEqual(resolveDependencies(reg, 'audit'), []);

  const missing: Registry = { spec_version: '0.1', blueprints: [entry('a', '1.0.0', [['ghost', '*']])] };
  assert.throws(() => resolveDependencies(missing, 'a'), /not in the registry/);
  const old: Registry = { spec_version: '0.1', blueprints: [entry('a', '1.0.0', [['b', '^2.0.0']]), entry('b', '1.9.0')] };
  assert.throws(() => resolveDependencies(old, 'a'), /needs b@\^2.0.0 but the registry has 1.9.0/);
  const cycle: Registry = { spec_version: '0.1', blueprints: [entry('a', '1.0.0', [['b', '*']]), entry('b', '1.0.0', [['a', '*']])] };
  assert.throws(() => resolveDependencies(cycle, 'a'), /dependency cycle: a -> b -> a/);
});

test('searchRegistry matches all words across fields and filters by stack', () => {
  const reg: Registry = {
    spec_version: '0.1',
    blueprints: [
      entry('auth', '0.1.0', [], { title: 'Authentication & Authorization', tags: ['sessions', 'rbac'], stacks: ['express', 'fastapi'] }),
      entry('payments', '0.1.0', [], { title: 'Payments', category: 'billing', tags: ['stripe'], stacks: ['express'] }),
    ],
  };
  assert.deepEqual(searchRegistry(reg, 'auth').map((e) => e.name), ['auth']);
  assert.deepEqual(searchRegistry(reg, 'rbac sessions').map((e) => e.name), ['auth']);
  assert.deepEqual(searchRegistry(reg, 'auth stripe').map((e) => e.name), []);
  assert.deepEqual(searchRegistry(reg, '', 'fastapi').map((e) => e.name), ['auth']);
  assert.deepEqual(searchRegistry(reg, '').map((e) => e.name), ['auth', 'payments']);
});
