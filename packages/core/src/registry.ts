import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BLUEPRINTS_DIR, REGISTRY_FILE, SPEC_VERSION } from './constants.js';
import { satisfies } from './semver.js';
import { type BlueprintSource, type ReadOptions, SourceError, assertSafeRelative, listFilesRecursive, localExists, readSourceText } from './source.js';
import type { Registry, RegistryEntry, ValidationResult } from './types.js';
import { validateBlueprintDir } from './validate.js';

export interface BuildResult {
  registry: Registry;
  results: ValidationResult[];
}

/**
 * Scan `<root>/blueprints/*` and build the registry. Every blueprint is validated; entries are produced
 * only for blueprints whose manifest is schema-valid. Callers decide whether errors are fatal.
 */
export async function buildRegistry(root: string): Promise<BuildResult> {
  const base = join(root, BLUEPRINTS_DIR);
  const dirs = (await localExists(base))
    ? (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort()
    : [];
  const knownNames = new Set(dirs);
  const results: ValidationResult[] = [];
  const blueprints: RegistryEntry[] = [];
  for (const name of dirs) {
    const dir = join(base, name);
    const result = await validateBlueprintDir(dir, { knownNames });
    results.push(result);
    const m = result.manifest;
    if (!m) continue;
    blueprints.push({
      name: m.name,
      version: m.version,
      title: m.title,
      summary: m.summary,
      category: m.category,
      stacks: [...m.stacks],
      status: m.status,
      tags: [...(m.tags ?? [])],
      depends_on: m.depends_on.map((d) => ({ ...d })),
      path: `${BLUEPRINTS_DIR}/${name}`,
      files: await listFilesRecursive(dir),
    });
  }
  const registry: Registry = { spec_version: SPEC_VERSION, blueprints };
  // Dependency problems (missing, unsatisfied, cycles) are registry-level errors.
  for (const entry of blueprints) {
    try {
      resolveDependencies(registry, entry.name);
    } catch (e) {
      results.find((r) => r.name === entry.name)?.errors.push({ file: 'blueprint.yaml', message: (e as Error).message });
    }
  }
  return { registry, results };
}

/** Stable JSON for committing: two-space indent and a trailing newline. */
export function serializeRegistry(registry: Registry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

/**
 * Read registry.json from a source. A local directory without registry.json is scanned instead, so
 * authors can point `--source` at a work-in-progress checkout.
 */
export async function readRegistry(source: BlueprintSource, opts: ReadOptions = {}): Promise<Registry> {
  if (source.kind === 'local' && !(await localExists(join(source.root, REGISTRY_FILE)))) {
    return (await buildRegistry(source.root)).registry;
  }
  const text = await readSourceText(source, REGISTRY_FILE, opts);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SourceError(`${REGISTRY_FILE} is not valid JSON`);
  }
  return checkRegistryShape(data);
}

function checkRegistryShape(data: unknown): Registry {
  const reg = data as Registry;
  if (!reg || typeof reg !== 'object' || !Array.isArray(reg.blueprints)) {
    throw new SourceError(`${REGISTRY_FILE} has no "blueprints" array`);
  }
  for (const e of reg.blueprints) {
    if (typeof e?.name !== 'string' || typeof e.path !== 'string' || !Array.isArray(e.files)) {
      throw new SourceError(`${REGISTRY_FILE} has a malformed entry: ${JSON.stringify(e).slice(0, 120)}`);
    }
    assertSafeRelative(e.path);
    e.files.forEach(assertSafeRelative);
    e.stacks ??= [];
    e.tags ??= [];
    e.depends_on ??= [];
  }
  return reg;
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

export function findEntry(registry: Registry, name: string): RegistryEntry {
  const entry = registry.blueprints.find((b) => b.name === name);
  if (entry) return entry;
  const close = registry.blueprints.filter((b) => b.name.includes(name) || name.includes(b.name)).map((b) => b.name);
  const hint = close.length ? ` Did you mean: ${close.join(', ')}?` : ` Available: ${registry.blueprints.map((b) => b.name).join(', ') || '(none)'}.`;
  throw new NotFoundError(`No blueprint named "${name}".${hint}`);
}

/**
 * Rank blueprints against a free-text query. Every query word must match name, title, summary, category
 * or tags. An empty query returns everything. `stack` filters to blueprints with that adapter.
 */
export function searchRegistry(registry: Registry, query: string, stack?: string): RegistryEntry[] {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const scored: { entry: RegistryEntry; score: number }[] = [];
  for (const entry of registry.blueprints) {
    if (stack && !entry.stacks.includes(stack.toLowerCase())) continue;
    let score = 0;
    let all = true;
    for (const w of words) {
      const s =
        (entry.name === w ? 10 : entry.name.includes(w) ? 6 : 0) +
        (entry.tags.some((t) => t === w) ? 5 : entry.tags.some((t) => t.includes(w)) ? 3 : 0) +
        (entry.title.toLowerCase().includes(w) ? 4 : 0) +
        (entry.category.includes(w) ? 2 : 0) +
        (entry.summary.toLowerCase().includes(w) ? 1 : 0);
      if (s === 0) all = false;
      score += s;
    }
    if (all) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).map((s) => s.entry);
}

/**
 * Transitive dependencies of `name`, dependencies first, excluding `name` itself. Throws on a missing
 * dependency, an unsatisfied version range, or a cycle.
 */
export function resolveDependencies(registry: Registry, name: string): RegistryEntry[] {
  const order: RegistryEntry[] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (entry: RegistryEntry) => {
    if (done.has(entry.name)) return;
    if (stack.includes(entry.name)) {
      throw new Error(`dependency cycle: ${[...stack.slice(stack.indexOf(entry.name)), entry.name].join(' -> ')}`);
    }
    stack.push(entry.name);
    for (const dep of entry.depends_on) {
      const target = registry.blueprints.find((b) => b.name === dep.name);
      if (!target) throw new Error(`${entry.name} depends on "${dep.name}", which is not in the registry`);
      if (!satisfies(target.version, dep.version)) {
        throw new Error(`${entry.name} needs ${dep.name}@${dep.version} but the registry has ${target.version}`);
      }
      visit(target);
    }
    stack.pop();
    done.add(entry.name);
    order.push(entry);
  };
  visit(findEntry(registry, name));
  return order.filter((e) => e.name !== name);
}
