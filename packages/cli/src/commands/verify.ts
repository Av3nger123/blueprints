import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describeSource, loadBlueprint, parseChecklist, parseManifest, type BlueprintManifest, type BlueprintSource } from '@your-npm-scope/blueprints-core';
import { type Io, paint, UsageError } from '../io.js';
import { type CheckResult, foldChecks, parseTap, type TapTest } from '../tap.js';

export interface VerifyOptions {
  baseUrl?: string;
  dir: string;
  env: string[];
  verbose: boolean;
  json: boolean;
}

export interface VerifyReport {
  blueprint: string;
  version: string;
  base_url: string;
  passed: boolean;
  exit_code: number;
  checks: CheckResult[];
  manual: { id: string; text: string }[];
  tests: TapTest[];
}

export async function verify(io: Io, source: BlueprintSource, name: string | undefined, opts: VerifyOptions): Promise<number> {
  if (!name) throw new UsageError('verify needs a blueprint name, e.g. `blueprints verify auth --base-url http://localhost:3000`');
  const baseUrl = opts.baseUrl ?? io.env.BASE_URL;
  if (!baseUrl) throw new UsageError('verify needs --base-url (the running app to test), e.g. --base-url http://localhost:3000');
  try {
    new URL(baseUrl);
  } catch {
    throw new UsageError(`--base-url is not a valid URL: ${baseUrl}`);
  }
  const extraEnv = parseEnvPairs(opts.env);

  const { dir, cleanup, origin } = await locateBlueprint(io, source, name, opts.dir);
  try {
    const manifest = mustParse(await readFile(join(dir, 'blueprint.yaml'), 'utf8'), dir);
    const { items } = parseChecklist(await readFile(join(dir, 'verify', 'checklist.md'), 'utf8').catch(() => ''));
    const env: NodeJS.ProcessEnv = { ...io.env, ...extraEnv, BASE_URL: baseUrl, BLUEPRINT_TEST_REPORTER: 'tap' };
    const missing = manifest.verification.env.filter((e) => e.required && !env[e.name]).map((e) => e.name);
    if (missing.length) throw new UsageError(`missing required variable(s): ${missing.join(', ')} (pass with --env NAME=value)`);

    if (!opts.json) {
      io.out(`Verifying ${paint(io, 'bold', `${manifest.name} v${manifest.version}`)} against ${baseUrl}`);
      io.out(paint(io, 'dim', `  tests from ${origin}`));
      io.out(paint(io, 'dim', `  $ ${manifest.verification.command}`));
      io.out();
    }
    const { code, stdout, stderr } = await run(manifest.verification.command, dir, env, opts.verbose && !opts.json ? io : undefined);
    const tests = parseTap(stdout);
    const checks = foldChecks(items, tests);
    const manual = items.filter((i) => i.kind === 'manual').map(({ id, text }) => ({ id, text }));
    const passed = code === 0 && !checks.some((c) => c.status === 'fail');
    const report: VerifyReport = { blueprint: manifest.name, version: manifest.version, base_url: baseUrl, passed, exit_code: code, checks, manual, tests };

    if (opts.json) io.out(JSON.stringify(report, null, 2));
    else printReport(io, report, tests.length === 0 ? `${stdout}\n${stderr}` : undefined);
    return passed ? 0 : 1;
  } finally {
    await cleanup();
  }
}

/** Prefer the copy installed in the project (what the agent followed); otherwise fetch from the source. */
async function locateBlueprint(io: Io, source: BlueprintSource, name: string, installDir: string) {
  const installed = resolve(io.cwd, installDir, name);
  const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);
  if ((await isFile(join(installed, 'blueprint.yaml'))) && (await stat(join(installed, 'verify', 'tests')).then(() => true, () => false))) {
    return { dir: installed, origin: relative(io.cwd, installed) || '.', cleanup: async () => {} };
  }
  const bp = await loadBlueprint(source, name, { skipGenerated: true });
  const tmp = await mkdtemp(join(tmpdir(), `blueprints-verify-${name}-`));
  for (const [rel, content] of Object.entries(bp.files)) {
    const file = join(tmp, ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { dir: tmp, origin: describeSource(source), cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

function mustParse(text: string, dir: string): BlueprintManifest {
  const parsed = parseManifest(text);
  if (!parsed.manifest) throw new UsageError(`${join(dir, 'blueprint.yaml')} is invalid: ${parsed.errors.map((e) => e.message).join('; ')}`);
  return parsed.manifest;
}

function parseEnvPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i <= 0) throw new UsageError(`--env expects NAME=value, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

function run(command: string, cwd: string, env: NodeJS.ProcessEnv, echo?: Io): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (echo) process.stdout.write(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (echo) process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

function printReport(io: Io, r: VerifyReport, rawWhenUnparsed?: string): void {
  const mark = { pass: paint(io, 'green', 'PASS'), fail: paint(io, 'red', 'FAIL'), skipped: paint(io, 'yellow', 'SKIP'), 'not-run': paint(io, 'dim', '----') };
  for (const c of r.checks) {
    io.out(`${mark[c.status]}  ${c.id}  ${truncate(c.text, 90)}`);
    for (const reason of c.reasons) io.out(paint(io, 'dim', `            skipped: ${reason}`));
    if (c.status === 'fail') {
      for (const t of r.tests.filter((t) => t.id === c.id && t.status === 'fail')) io.out(paint(io, 'red', `            failed: ${t.name}`));
    }
  }
  if (rawWhenUnparsed !== undefined) {
    io.out(paint(io, 'yellow', 'No TAP results were parsed from the test command; showing its output:'));
    io.out(rawWhenUnparsed.trim() || '(no output)');
  }
  const count = (s: CheckResult['status']) => r.checks.filter((c) => c.status === s).length;
  io.out();
  io.out(
    `${r.passed ? paint(io, 'green', 'PASSED') : paint(io, 'red', 'FAILED')}  ` +
      `${count('pass')} passed, ${count('fail')} failed, ${count('skipped')} skipped, ${count('not-run')} not run ` +
      `(automated checks)${r.exit_code !== 0 && count('fail') === 0 ? `; test command exited with ${r.exit_code}` : ''}`,
  );
  if (r.manual.length) {
    io.out();
    io.out(`${r.manual.length} manual check(s) still need review (see verify/checklist.md): ${r.manual.map((m) => m.id).join(', ')}`);
  }
  if (count('skipped') || count('not-run')) {
    io.out(paint(io, 'dim', 'Skipped and not-run checks are not passes. Configure them (see BLUEPRINT.md, Verification) and run again.'));
  }
}

function truncate(s: string, n: number): string {
  const plain = s.replace(/\s+/g, ' ');
  return plain.length > n ? `${plain.slice(0, n - 1)}…` : plain;
}
