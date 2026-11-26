import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseManifest } from './manifest.js';
import { validateBlueprintDir } from './validate.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = join(REPO, 'blueprints', 'auth');
const temps: string[] = [];
after(() => Promise.all(temps.map((t) => rm(t, { recursive: true, force: true }))));

/** Copy the auth blueprint into a temp dir named `auth`, apply edits, return the dir. */
async function mutated(edits: Record<string, (text: string) => string | null>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-validate-'));
  temps.push(root);
  const dir = join(root, 'auth');
  await cp(AUTH, dir, { recursive: true });
  for (const [rel, edit] of Object.entries(edits)) {
    const file = join(dir, rel);
    const next = edit(await readFile(file, 'utf8').catch(() => ''));
    if (next === null) await rm(file, { recursive: true, force: true });
    else await writeFile(file, next);
  }
  return dir;
}

const messages = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message);

test('the auth blueprint is valid', async () => {
  const r = await validateBlueprintDir(AUTH);
  assert.deepEqual(r.errors, []);
  assert.equal(r.name, 'auth');
});

test('every blueprint.yaml field rule in the schema is enforced', () => {
  const bad = parseManifest('spec_version: "0.1"\nname: Bad_Name\nversion: 1.0\nextra: x\n');
  const text = bad.errors.map((e) => e.message).join('\n');
  assert.match(text, /name: must match pattern/);
  assert.match(text, /version: must be string/);
  assert.match(text, /unknown field "extra"/);
  assert.match(text, /missing required field "title"/);
  assert.match(parseManifest('a: [').errors[0]!.message, /invalid YAML/);
});

test('reports missing sections, wrong title, and missing default', async () => {
  const dir = await mutated({
    'BLUEPRINT.md': (t) => t.replace('# Authentication & Authorization', '# Auth').replace('## Common mistakes', '## Pitfalls').replaceAll('**Default:', '**Choice:'),
  });
  const m = messages(await validateBlueprintDir(dir));
  assert.ok(m.includes('level-1 heading "Auth" must equal title "Authentication & Authorization"'), m.join('\n'));
  assert.ok(m.includes('missing section "## Common mistakes"'));
  assert.ok(m.includes('decision "D1. Session mechanism" has no **Default:** marker'), m.join('\n'));
});

test('adapters must match stacks both ways and have required sections', async () => {
  const dir = await mutated({
    'adapters/fastapi.md': () => null,
    'adapters/rails.md': () => '# Rails\n## Libraries\nx\n## Mapping\ny\n',
  });
  const m = messages(await validateBlueprintDir(dir));
  assert.ok(m.includes('stack "fastapi" has no adapters/fastapi.md'));
  assert.ok(m.includes('adapters/rails.md is not listed in stacks'));
  assert.ok(m.includes('missing section "## Configuration"'));
});

test('directory name must match manifest name; tests and checklist are required', async () => {
  const dir = await mutated({
    'blueprint.yaml': (t) => t.replace('name: auth', 'name: authn'),
    'verify/tests': () => null,
    'verify/checklist.md': () => '# empty\n',
  });
  const m = messages(await validateBlueprintDir(dir));
  assert.ok(m.includes('name "authn" must match the directory name "auth"'));
  assert.ok(m.includes('verify/tests/ must contain the runnable tests'));
  assert.ok(m.some((x) => x.startsWith('no checks found')));
});

test('trust tiers: expert-reviewed needs a reviewer of the same MAJOR.MINOR', async () => {
  const reviewer = (v: string) => `reviewers:\n  - name: R\n    role: Security engineer\n    reviewed_version: ${v}\n    date: "2026-11-01"\n`;
  const stale = await mutated({
    'blueprint.yaml': (t) => t.replace('status: draft', 'status: expert-reviewed').replace('reviewers: []\n', reviewer('0.0.9')),
  });
  assert.ok(messages(await validateBlueprintDir(stale)).some((x) => x.includes('requires a reviewer whose reviewed_version matches 0.1.0')));

  const fresh = await mutated({
    'blueprint.yaml': (t) => t.replace('status: draft', 'status: expert-reviewed').replace('reviewers: []\n', reviewer('0.1.0')),
  });
  assert.deepEqual(messages(await validateBlueprintDir(fresh)), []);
});

test('community and above require an automated check; hand-written SKILL.md is rejected', async () => {
  const dir = await mutated({
    'blueprint.yaml': (t) => t.replace('status: draft', 'status: community'),
    'verify/checklist.md': (t) => t.replaceAll('`[automated]`', '`[manual]`'),
    'SKILL.md': () => '---\nname: x\n---\nhand written',
  });
  const m = messages(await validateBlueprintDir(dir));
  assert.ok(m.includes('status "community" requires at least one [automated] check'));
  assert.ok(m.includes('SKILL.md is generated; do not hand-write it'));
});
