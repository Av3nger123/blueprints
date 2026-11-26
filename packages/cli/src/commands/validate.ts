import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { buildRegistry, validateBlueprintDir, type ValidationResult } from '@your-npm-scope/blueprints-core';
import { type Io, paint } from '../io.js';

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);
const fileExists = (p: string) => stat(p).then((s) => s.isFile(), () => false);

/**
 * Validate one blueprint directory, a registry root (with blueprints/), or a directory of blueprints.
 * Exit code 1 if any blueprint has errors.
 */
export async function validate(io: Io, pathArg: string | undefined, json: boolean): Promise<number> {
  const target = resolve(io.cwd, pathArg ?? '.');
  let results: ValidationResult[];
  if (await fileExists(join(target, 'blueprint.yaml'))) {
    results = [await validateBlueprintDir(target)];
  } else if (await isDir(join(target, 'blueprints'))) {
    results = (await buildRegistry(target)).results;
  } else if (await isDir(target)) {
    const subdirs = (await readdir(target, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(target, d.name));
    const withManifest = [];
    for (const d of subdirs) if (await fileExists(join(d, 'blueprint.yaml'))) withManifest.push(d);
    const names = new Set(withManifest.map((d) => d.split(/[\\/]/).pop()!));
    results = await Promise.all(withManifest.map((d) => validateBlueprintDir(d, { knownNames: names })));
  } else {
    io.err(`Not found: ${target}`);
    return 2;
  }

  if (json) {
    io.out(JSON.stringify(results.map(({ manifest: _m, ...r }) => r), null, 2));
    return results.some((r) => r.errors.length) ? 1 : 0;
  }
  if (results.length === 0) {
    io.err(`No blueprints found in ${target} (looked for blueprint.yaml).`);
    return 2;
  }
  let failed = 0;
  for (const r of results) {
    const label = r.name ?? relative(io.cwd, r.dir);
    if (r.errors.length === 0) io.out(`${paint(io, 'green', 'ok')}    ${label}`);
    else {
      failed++;
      io.out(`${paint(io, 'red', 'fail')}  ${label}`);
    }
    for (const e of r.errors) io.out(`      ${paint(io, 'red', 'error')}  ${e.file ? `${e.file}: ` : ''}${e.message}`);
    for (const w of r.warnings) io.out(`      ${paint(io, 'yellow', 'warn')}   ${w.file ? `${w.file}: ` : ''}${w.message}`);
  }
  io.out();
  io.out(`${results.length - failed}/${results.length} blueprint(s) valid`);
  return failed ? 1 : 0;
}
