import { GENERATED_FILES } from './constants.js';
import { parseManifest } from './manifest.js';
import { findEntry, readRegistry } from './registry.js';
import { type BlueprintSource, type ReadOptions, SourceError, readSourceText } from './source.js';
import type { LoadedBlueprint, Registry, RegistryEntry } from './types.js';

export interface LoadOptions extends ReadOptions {
  /** Keep only this stack's adapter. Throws if the blueprint has no adapter for it. */
  stack?: string;
  /** Load only these files (relative to the blueprint). Missing ones are skipped. */
  only?: string[];
  /** Skip generated files such as SKILL.md (default false). */
  skipGenerated?: boolean;
  /** Reuse an already-fetched registry. */
  registry?: Registry;
}

export class UnsupportedStackError extends Error {
  override name = 'UnsupportedStackError';
}

/** Which of an entry's files to load, given a stack filter. */
export function selectFiles(entry: RegistryEntry, opts: Pick<LoadOptions, 'stack' | 'only' | 'skipGenerated'> = {}): string[] {
  let files = entry.files;
  if (opts.stack) {
    const stack = opts.stack.toLowerCase();
    if (!entry.stacks.includes(stack)) {
      throw new UnsupportedStackError(`Blueprint "${entry.name}" has no adapter for "${opts.stack}". Available: ${entry.stacks.join(', ')}.`);
    }
    files = files.filter((f) => !f.startsWith('adapters/') || f === `adapters/${stack}.md`);
  }
  if (opts.skipGenerated) files = files.filter((f) => !(GENERATED_FILES as readonly string[]).includes(f));
  if (opts.only) {
    const only = new Set(opts.only);
    files = files.filter((f) => only.has(f));
  }
  return files;
}

/** Fetch a blueprint's files from a source and parse its manifest. */
export async function loadBlueprint(source: BlueprintSource, name: string, opts: LoadOptions = {}): Promise<LoadedBlueprint> {
  const registry = opts.registry ?? (await readRegistry(source, opts));
  const entry = findEntry(registry, name);
  const wanted = new Set(selectFiles(entry, opts));
  wanted.add('blueprint.yaml');

  const files: Record<string, string> = {};
  await Promise.all(
    [...wanted].map(async (rel) => {
      files[rel] = await readSourceText(source, `${entry.path}/${rel}`, opts);
    }),
  );
  const parsed = parseManifest(files['blueprint.yaml']!);
  if (!parsed.manifest) {
    throw new SourceError(`${entry.path}/blueprint.yaml is invalid: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }
  if (opts.only && !opts.only.includes('blueprint.yaml')) delete files['blueprint.yaml'];
  return { entry, manifest: parsed.manifest, files };
}
