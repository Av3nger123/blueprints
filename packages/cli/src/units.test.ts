import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { chooseStack, detectStacks } from './detect-stack.js';
import { upsertBlock } from './instructions.js';
import { table } from './io.js';
import { foldChecks, parseTap } from './tap.js';

const temps: string[] = [];
after(() => Promise.all(temps.map((t) => rm(t, { recursive: true, force: true }))));

const BLOCK_A = '<!-- BEGIN blueprints:auth (managed by `blueprints add`; edits inside this block are overwritten) -->\nA1\n<!-- END blueprints:auth -->';
const BLOCK_B = BLOCK_A.replace('A1', 'A2');

test('upsertBlock appends with one blank line, replaces in place, and is idempotent', () => {
  const first = upsertBlock('# Notes\n\nkeep me\n', 'auth', BLOCK_A);
  assert.equal(first.result, 'appended');
  assert.equal(first.text, `# Notes\n\nkeep me\n\n${BLOCK_A}\n`);

  const same = upsertBlock(first.text, 'auth', BLOCK_A);
  assert.equal(same.result, 'unchanged');
  assert.equal(same.text, first.text);

  const withTail = `${first.text}\n## After\ntext\n`;
  const updated = upsertBlock(withTail, 'auth', BLOCK_B);
  assert.equal(updated.result, 'updated');
  assert.equal(updated.text, withTail.replace(BLOCK_A, BLOCK_B), 'content around the block is untouched');

  assert.equal(upsertBlock('', 'auth', BLOCK_A).text, `${BLOCK_A}\n`);
  assert.equal(upsertBlock('no newline', 'auth', BLOCK_A).text, `no newline\n\n${BLOCK_A}\n`);
});

test('upsertBlock keeps other blueprints blocks separate and refuses a broken block', () => {
  const other = BLOCK_A.replaceAll('blueprints:auth', 'blueprints:payments');
  const both = upsertBlock(upsertBlock('', 'payments', other).text, 'auth', BLOCK_A).text;
  assert.ok(both.includes(other) && both.includes(BLOCK_A));
  assert.throws(() => upsertBlock(BLOCK_A.split('\n')[0]!, 'auth', BLOCK_B), /without a matching END marker/);
});

test('detectStacks and chooseStack read package.json and Python manifests', async () => {
  const mk = async (files: Record<string, string>) => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-detect-'));
    temps.push(dir);
    for (const [f, c] of Object.entries(files)) await writeFile(join(dir, f), c);
    return dir;
  };
  const express = await mk({ 'package.json': JSON.stringify({ dependencies: { express: '^5' } }) });
  const next = await mk({ 'package.json': JSON.stringify({ dependencies: { next: '16', express: '5' } }) });
  const fastapi = await mk({ 'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.110", "uvicorn"]\n' });
  const both = await mk({ 'package.json': JSON.stringify({ dependencies: { express: '5' } }), 'requirements.txt': 'fastapi==0.115\n' });
  const none = await mk({});

  assert.deepEqual(await detectStacks(express), ['express']);
  assert.deepEqual(await detectStacks(fastapi), ['fastapi']);
  const supported = ['express', 'fastapi', 'nextjs'];
  assert.equal((await chooseStack(next, supported)).stack, 'nextjs');
  assert.deepEqual((await chooseStack(both, supported)).ambiguous, ['express', 'fastapi']);
  assert.equal((await chooseStack(none, supported)).stack, undefined);
  assert.equal((await chooseStack(none, supported, 'FastAPI')).stack, 'fastapi');
});

test('parseTap reads nested points, skips and todos; foldChecks maps them to checks', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: session cookie attributes',
    '    ok 1 - AUTH-14 session cookie is HttpOnly',
    '    ok 2 - AUTH-15 session cookie is Secure # SKIP BASE_URL is http://',
    '    not ok 3 - AUTH-16 SameSite',
    '      ---',
    '      error: nope',
    '      ...',
    'ok 1 - session cookie attributes',
    'ok 2 - AUTH-37 one',
    'ok 3 - AUTH-37 two # SKIP PROTECTED_PATH not set',
    'ok 4 - AUTH-99 todo thing # TODO later',
    '1..4',
  ].join('\n');
  const tests = parseTap(tap);
  assert.deepEqual(
    tests.map((t) => `${t.id ?? '-'}:${t.status}`),
    ['AUTH-14:pass', 'AUTH-15:skip', 'AUTH-16:fail', '-:pass', 'AUTH-37:pass', 'AUTH-37:skip', 'AUTH-99:todo'],
  );
  assert.equal(tests[1]!.reason, 'BASE_URL is http://');

  const items = ['14', '15', '16', '37', '40'].map((n) => ({ id: `AUTH-${n}`, kind: 'automated' as const, text: n }));
  items.push({ id: 'AUTH-50', kind: 'automated', text: 'x' });
  const checks = foldChecks([...items, { id: 'AUTH-60', kind: 'manual', text: 'm' }], tests);
  assert.deepEqual(
    checks.map((c) => `${c.id}:${c.status}`),
    ['AUTH-14:pass', 'AUTH-15:skipped', 'AUTH-16:fail', 'AUTH-37:pass', 'AUTH-40:not-run', 'AUTH-50:not-run'],
  );
});

test('table aligns columns and leaves the last one unpadded', () => {
  assert.deepEqual(table([['A', 'BB', 'x'], ['CCC', 'D', 'yy']]), ['A    BB  x', 'CCC  D   yy']);
});
