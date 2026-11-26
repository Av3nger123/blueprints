/**
 * Generate registry.json and a SKILL.md wrapper for every blueprint.
 *
 *   pnpm registry          write the generated files
 *   pnpm registry:check    exit 1 if any generated file is stale or a blueprint is invalid (CI)
 *
 * Runs from source (tsx), so it does not need a prior build.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry, REGISTRY_FILE, renderSkill, serializeRegistry, type ValidationResult } from '../packages/core/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');

const readOrNull = (p: string) => readFile(p, 'utf8').catch(() => null);
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');

async function main(): Promise<number> {
  const stale: string[] = [];

  // SKILL.md first: registry.json lists every file in a blueprint, SKILL.md included.
  const first = await buildRegistry(ROOT);
  for (const r of first.results) {
    if (!r.manifest) continue;
    const path = join(r.dir, 'SKILL.md');
    const expected = renderSkill(r.manifest);
    if ((await readOrNull(path)) === expected) continue;
    stale.push(rel(path));
    if (!check) await writeFile(path, expected);
  }

  const { registry, results } = check ? first : await buildRegistry(ROOT);
  if (report(results)) return 1;

  const registryPath = join(ROOT, REGISTRY_FILE);
  const serialized = serializeRegistry(registry);
  if ((await readOrNull(registryPath)) !== serialized) {
    stale.push(REGISTRY_FILE);
    if (!check) await writeFile(registryPath, serialized);
  }

  const names = registry.blueprints.map((b) => `${b.name}@${b.version}`).join(', ') || '(none)';
  if (check) {
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}\nRun \`pnpm registry\` and commit the result.`);
      return 1;
    }
    console.log(`registry.json and SKILL.md wrappers are up to date (${names}).`);
  } else {
    console.log(stale.length ? `Wrote ${stale.join(', ')}` : 'Nothing to update.');
    console.log(`${registry.blueprints.length} blueprint(s): ${names}`);
  }
  return 0;
}

/** Print validation problems; true if any blueprint has errors. */
function report(results: ValidationResult[]): boolean {
  let failed = false;
  for (const r of results) {
    const label = r.name ?? rel(r.dir);
    for (const w of r.warnings) console.warn(`warn   ${label}: ${w.file ? `${w.file}: ` : ''}${w.message}`);
    for (const e of r.errors) {
      failed = true;
      console.error(`error  ${label}: ${e.file ? `${e.file}: ` : ''}${e.message}`);
    }
  }
  if (failed) console.error('Fix the errors above; registry.json was not updated.');
  return failed;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  },
);
