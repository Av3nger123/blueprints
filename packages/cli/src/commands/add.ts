import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findEntry, loadBlueprint, readRegistry, resolveDependencies, type BlueprintSource, type LoadedBlueprint } from '@your-npm-scope/blueprints-core';
import { chooseStack } from '../detect-stack.js';
import { renderBlock, upsertFile } from '../instructions.js';
import { type Io, paint, UsageError } from '../io.js';

export interface AddOptions {
  stack?: string;
  dir: string;
  /** Skip AGENTS.md / CLAUDE.md updates. */
  noInstructions?: boolean;
}

export const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

export async function add(io: Io, source: BlueprintSource, name: string | undefined, opts: AddOptions): Promise<number> {
  if (!name) throw new UsageError('add needs a blueprint name, e.g. `blueprints add auth --stack express`');
  const project = io.cwd;
  const installRoot = isAbsolute(opts.dir) ? opts.dir : resolve(project, opts.dir);
  if (relative(project, installRoot).startsWith('..')) throw new UsageError(`--dir must be inside the project (${project})`);

  const registry = await readRegistry(source);
  const target = findEntry(registry, name);
  const deps = resolveDependencies(registry, name).map((e) => e.name);

  const choice = await chooseStack(project, target.stacks, opts.stack);
  if (choice.ambiguous) {
    throw new UsageError(`This project looks like more than one stack (${choice.ambiguous.join(', ')}). Pick one with --stack.`);
  }
  if (!choice.stack) {
    io.err(paint(io, 'yellow', `No supported stack detected (${target.stacks.join(', ')}); installing every adapter. Use --stack to pick one.`));
  } else if (!opts.stack) {
    io.out(`Detected stack: ${choice.stack}`);
  }

  for (const bpName of [...deps, name]) {
    const entry = registry.blueprints.find((b) => b.name === bpName)!;
    const stack = choice.stack && entry.stacks.includes(choice.stack) ? choice.stack : undefined;
    if (bpName === name && choice.stack && !stack) {
      throw new UsageError(`Blueprint "${name}" has no adapter for "${choice.stack}". Available: ${entry.stacks.join(', ')}.`);
    }
    const bp = await loadBlueprint(source, bpName, { registry, skipGenerated: true, ...(stack ? { stack } : {}) });
    const dest = join(installRoot, bpName);
    const verb = await writeBlueprint(dest, bp);
    const rel = relative(project, dest).split(sep).join('/');
    io.out(`${paint(io, 'green', verb)} ${bpName} v${bp.manifest.version}${stack ? ` (${stack} adapter)` : ''} -> ${rel}/`);
    if (bp.manifest.status === 'draft') io.out(paint(io, 'yellow', `  note: ${bpName} is a draft blueprint and has not had maintainer review yet`));

    if (!opts.noInstructions) {
      const block = renderBlock({ manifest: bp.manifest, dir: rel, ...(stack ? { stack } : {}) });
      for (const file of INSTRUCTION_FILES) {
        const result = await upsertFile(join(project, file), bpName, block);
        if (result !== 'unchanged') io.out(`  ${result} ${file}`);
      }
    }
  }
  io.out();
  io.out(`Next: ask your agent to implement ${name} following ${relative(project, join(installRoot, name)).split(sep).join('/')}/BLUEPRINT.md,`);
  io.out(`then check the result with: ${paint(io, 'cyan', `blueprints verify ${name} --base-url http://localhost:3000`)}`);
  return 0;
}

/**
 * Replace the blueprint directory with fresh content. Refuses to delete a directory that does not look
 * like an installed blueprint, so a mistyped --dir cannot wipe unrelated files.
 */
async function writeBlueprint(dest: string, bp: LoadedBlueprint): Promise<'added' | 'updated'> {
  const existing = await readFile(join(dest, 'blueprint.yaml'), 'utf8').catch(() => null);
  if (existing === null) {
    const empty = await isMissingOrEmpty(dest);
    if (!empty) throw new UsageError(`${dest} exists and is not an installed blueprint; refusing to overwrite it`);
  } else {
    await rm(dest, { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(bp.files)) {
    const file = join(dest, ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return existing === null ? 'added' : 'updated';
}

async function isMissingOrEmpty(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return true;
  }
}
