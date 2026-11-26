import { describeSource, findEntry, readRegistry, searchRegistry, loadBlueprint, type BlueprintSource, type RegistryEntry } from '@your-npm-scope/blueprints-core';
import { type Io, paint, table, UsageError } from '../io.js';

function statusLabel(io: Io, status: string): string {
  const style = status === 'expert-reviewed' || status === 'verified' ? 'green' : status === 'community' ? 'cyan' : 'yellow';
  return paint(io, style, status);
}

function printEntries(io: Io, entries: RegistryEntry[]): void {
  const rows = [['NAME', 'VERSION', 'STATUS', 'STACKS', 'SUMMARY'], ...entries.map((e) => [e.name, e.version, e.status, e.stacks.join(','), e.summary])];
  const lines = table(rows);
  io.out(paint(io, 'bold', lines[0]!));
  // Colour the status column after alignment so ANSI codes do not break padding.
  lines.slice(1).forEach((line, i) => io.out(line.replace(entries[i]!.status, statusLabel(io, entries[i]!.status))));
}

export async function list(io: Io, source: BlueprintSource, json: boolean): Promise<number> {
  const registry = await readRegistry(source);
  if (json) {
    io.out(JSON.stringify(registry.blueprints, null, 2));
    return 0;
  }
  if (registry.blueprints.length === 0) {
    io.out(`No blueprints in ${describeSource(source)}.`);
    return 0;
  }
  printEntries(io, registry.blueprints);
  return 0;
}

export async function search(io: Io, source: BlueprintSource, query: string | undefined, stack: string | undefined, json: boolean): Promise<number> {
  if (!query && !stack) throw new UsageError('search needs a query, e.g. `blueprints search auth`');
  const results = searchRegistry(await readRegistry(source), query ?? '', stack);
  if (json) {
    io.out(JSON.stringify(results, null, 2));
    return 0;
  }
  if (results.length === 0) {
    io.out(`No blueprints match "${query ?? ''}"${stack ? ` for stack ${stack}` : ''}.`);
    return 0;
  }
  printEntries(io, results);
  return 0;
}

export async function info(io: Io, source: BlueprintSource, name: string | undefined, json: boolean): Promise<number> {
  if (!name) throw new UsageError('info needs a blueprint name, e.g. `blueprints info auth`');
  const registry = await readRegistry(source);
  const entry = findEntry(registry, name);
  const { manifest: m } = await loadBlueprint(source, name, { registry, only: ['blueprint.yaml'] });
  if (json) {
    io.out(JSON.stringify({ ...m, path: entry.path, files: entry.files }, null, 2));
    return 0;
  }
  const field = (k: string, v: string) => io.out(`${paint(io, 'dim', k.padEnd(14))}${v}`);
  io.out(`${paint(io, 'bold', m.title)} ${paint(io, 'dim', `(${m.name} v${m.version})`)}`);
  io.out(m.summary);
  io.out();
  field('status', statusLabel(io, m.status));
  field('category', m.category);
  field('stacks', m.stacks.join(', '));
  field('depends on', m.depends_on.length ? m.depends_on.map((d) => `${d.name}@${d.version}`).join(', ') : 'none');
  field('authors', m.authors.map((a) => a.name).join(', '));
  field('reviewers', m.reviewers.length ? m.reviewers.map((r) => `${r.name} (${r.role}, v${r.reviewed_version})`).join(', ') : 'none yet');
  field('last review', m.last_reviewed);
  field('verification', `${m.verification.command}  [${m.verification.framework}, ${m.verification.runtime}]`);
  field('sources', `${m.sources.length} cited`);
  io.out();
  io.out(`Add it: ${paint(io, 'cyan', `blueprints add ${m.name} --stack ${m.stacks[0]}`)}`);
  return 0;
}
