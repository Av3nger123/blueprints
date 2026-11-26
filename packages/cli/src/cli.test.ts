import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from './cli.js';
import type { Io } from './io.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./test-fixtures/insecure-auth-server.mjs', import.meta.url));
const temps: string[] = [];
const children: ChildProcess[] = [];
after(async () => {
  for (const c of children) c.kill();
  await Promise.all(temps.map((t) => rm(t, { recursive: true, force: true })));
});

async function tempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Run the CLI in-process and capture its output. */
async function cli(args: string[], cwd: string = REPO, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { cwd, env: { PATH: process.env.PATH, ...env }, out: (l = '') => out.push(l), err: (l = '') => err.push(l), color: false };
  const code = await main(args, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function startFixture(env: Record<string, string> = {}): Promise<string> {
  const child = spawn(process.execPath, [FIXTURE], { env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const port = await new Promise<string>((resolve, reject) => {
    child.stdout!.on('data', (d: Buffer) => {
      const m = /listening (\d+)/.exec(d.toString());
      if (m) resolve(m[1]!);
    });
    child.on('exit', (code) => reject(new Error(`fixture exited with ${code}`)));
  });
  return `http://127.0.0.1:${port}`;
}

test('help, version and unknown commands', async () => {
  assert.match((await cli(['--help'])).out, /blueprints add <name>/);
  assert.match((await cli(['--version'])).out, /^\d+\.\d+\.\d+$/);
  const bad = await cli(['frobnicate']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /Unknown command "frobnicate"/);
  assert.equal((await cli([])).code, 2);
});

test('list, search and info read a local source', async () => {
  const list = await cli(['list', '--source', REPO, '--json']);
  assert.equal(list.code, 0);
  assert.equal(JSON.parse(list.out)[0].name, 'auth');
  assert.match((await cli(['search', 'csrf', '--source', REPO])).out, /^NAME.*\nauth\s+0\.1\.0/m);
  assert.match((await cli(['search', 'kubernetes', '--source', REPO])).out, /No blueprints match/);
  const info = await cli(['info', 'auth', '--source', REPO]);
  assert.equal(info.code, 0);
  assert.match(info.out, /Authentication & Authorization \(auth v0\.1\.0\)/);
  assert.match(info.out, /blueprints add auth --stack express/);
  const missing = await cli(['info', 'nope', '--source', REPO]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /No blueprint named "nope"/);
});

test('add copies the blueprint with only the chosen adapter and updates AGENTS.md and CLAUDE.md idempotently', async () => {
  const project = await tempDir('bp-add-');
  await writeFile(join(project, 'package.json'), JSON.stringify({ dependencies: { express: '^5.1.0' } }));
  await writeFile(join(project, 'AGENTS.md'), '# Project notes\n\nUse pnpm.\n');

  const first = await cli(['add', 'auth', '--stack', 'express', '--source', REPO], project);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /added auth v0\.1\.0 \(express adapter\) -> \.blueprints\/auth\//);
  const installed = join(project, '.blueprints', 'auth');
  assert.deepEqual(await readdir(join(installed, 'adapters')), ['express.md']);
  for (const f of ['BLUEPRINT.md', 'blueprint.yaml', 'verify/checklist.md', 'verify/tests/run.mjs']) {
    await readFile(join(installed, f)); // throws if missing
  }

  const agents = await readFile(join(project, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Project notes\n\nUse pnpm.\n\n<!-- BEGIN blueprints:auth'), 'existing content kept, block appended');
  assert.match(agents, /`\.blueprints\/auth\/BLUEPRINT\.md`, then `\.blueprints\/auth\/adapters\/express\.md`/);
  assert.match(agents, /verify auth --base-url/);
  const claude = await readFile(join(project, 'CLAUDE.md'), 'utf8');
  assert.equal(claude.match(/BEGIN blueprints:auth/g)?.length, 1);

  const again = await cli(['add', 'auth', '--stack', 'express', '--source', REPO], project);
  assert.equal(again.code, 0);
  assert.match(again.out, /updated auth/);
  assert.equal(await readFile(join(project, 'AGENTS.md'), 'utf8'), agents, 'second run leaves AGENTS.md unchanged');
  assert.equal((await readFile(join(project, 'CLAUDE.md'), 'utf8')).match(/BEGIN blueprints:auth/g)?.length, 1);

  // Switching stacks replaces the adapter rather than accumulating them.
  await cli(['add', 'auth', '--stack', 'fastapi', '--source', REPO], project);
  assert.deepEqual(await readdir(join(installed, 'adapters')), ['fastapi.md']);
  assert.match(await readFile(join(project, 'AGENTS.md'), 'utf8'), /adapters\/fastapi\.md/);
});

test('add detects the stack, rejects unknown stacks, and never overwrites unrelated directories', async () => {
  const project = await tempDir('bp-add2-');
  await writeFile(join(project, 'package.json'), JSON.stringify({ dependencies: { next: '16.0.0' } }));
  const detected = await cli(['add', 'auth', '--source', REPO, '--no-instructions'], project);
  assert.equal(detected.code, 0, detected.err);
  assert.match(detected.out, /Detected stack: nextjs/);
  await assert.rejects(readFile(join(project, 'AGENTS.md')), 'no-instructions leaves AGENTS.md alone');

  assert.equal((await cli(['add', 'auth', '--stack', 'rails', '--source', REPO], project)).code, 2);

  await mkdir(join(project, 'vendor', 'auth'), { recursive: true });
  await writeFile(join(project, 'vendor', 'auth', 'important.txt'), 'keep');
  const refused = await cli(['add', 'auth', '--dir', 'vendor', '--source', REPO], project);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /not an installed blueprint; refusing to overwrite/);
  assert.equal(await readFile(join(project, 'vendor', 'auth', 'important.txt'), 'utf8'), 'keep');

  assert.equal((await cli(['add', 'auth', '--dir', '../outside', '--source', REPO], project)).code, 2);
});

test('validate passes the repository and reports errors for a broken blueprint', async () => {
  const ok = await cli(['validate', 'blueprints']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /ok\s+auth/);

  const root = await tempDir('bp-val-');
  await cp(join(REPO, 'blueprints', 'auth'), join(root, 'auth'), { recursive: true });
  await rm(join(root, 'auth', 'adapters', 'nextjs.md'));
  const bad = await cli(['validate', join(root, 'auth')]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /stack "nextjs" has no adapters\/nextjs\.md/);
  assert.equal((await cli(['validate', join(root, 'missing')])).code, 2);
});

test('verify runs the suite against a running app and reports per check', { timeout: 120_000 }, async () => {
  const project = await tempDir('bp-verify-');
  await cli(['add', 'auth', '--stack', 'express', '--source', REPO, '--no-instructions'], project);
  const good = await startFixture();
  const env = ['--env', 'PROTECTED_PATH=/admin/ping', '--env', 'ADMIN_EMAIL=admin@example.com', '--env', 'ADMIN_PASSWORD=admin-password-long-enough'];

  const pass = await cli(['verify', 'auth', '--base-url', good, ...env, '--json'], project);
  const report = JSON.parse(pass.out);
  assert.equal(pass.code, 0, JSON.stringify(report.checks.filter((c: { status: string }) => c.status === 'fail')));
  assert.equal(report.passed, true);
  const status = (id: string) => report.checks.find((c: { id: string }) => c.id === id)?.status;
  assert.equal(status('AUTH-20'), 'pass');
  assert.equal(status('AUTH-38'), 'pass');
  assert.equal(status('AUTH-15'), 'skipped', 'Secure flag cannot be checked over http');
  assert.equal(status('AUTH-24'), 'skipped', 'token-mode check in session mode');
  assert.equal(report.manual.length, 12);

  const broken = await startFixture({ BREAK: 'logout,massassign' });
  const fail = await cli(['verify', 'auth', '--base-url', broken, '--source', REPO], project);
  assert.equal(fail.code, 1);
  assert.match(fail.out, /FAIL {2}AUTH-20/);
  assert.match(fail.out, /FAIL {2}AUTH-13/);
  assert.match(fail.out, /FAILED {2}\d+ passed, 2 failed/);
});

test('verify fetches the blueprint from the source when it is not installed, and validates input', async () => {
  const empty = await tempDir('bp-verify2-');
  const missingUrl = await cli(['verify', 'auth', '--source', REPO], empty);
  assert.equal(missingUrl.code, 2);
  assert.match(missingUrl.err, /needs --base-url/);
  assert.equal((await cli(['verify', 'auth', '--base-url', 'not a url', '--source', REPO], empty)).code, 2);
  assert.equal((await cli(['verify', 'auth', '--base-url', 'http://x', '--env', 'BAD', '--source', REPO], empty)).code, 2);

  const url = await startFixture({ MODE: 'token' });
  const res = await cli(['verify', 'auth', '--base-url', url, '--env', 'AUTH_MODE=token', '--source', REPO, '--json'], empty);
  const report = JSON.parse(res.out);
  assert.equal(res.code, 0, JSON.stringify(report.checks.filter((c: { status: string }) => c.status === 'fail')));
  assert.equal(report.checks.find((c: { id: string }) => c.id === 'AUTH-24').status, 'pass');
  assert.equal(report.checks.find((c: { id: string }) => c.id === 'AUTH-14').status, 'skipped');
});
