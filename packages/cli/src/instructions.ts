import { readFile, writeFile } from 'node:fs/promises';
import type { BlueprintManifest } from '@your-npm-scope/blueprints-core';

export const CLI_PACKAGE = '@your-npm-scope/blueprints';

const begin = (name: string) => `<!-- BEGIN blueprints:${name} (managed by \`blueprints add\`; edits inside this block are overwritten) -->`;
const end = (name: string) => `<!-- END blueprints:${name} -->`;

export interface BlockInput {
  manifest: BlueprintManifest;
  /** Blueprint directory relative to the project root, posix separators, e.g. `.blueprints/auth`. */
  dir: string;
  /** Adapter installed alongside, if any. */
  stack?: string;
}

/** The instruction block for AGENTS.md / CLAUDE.md. */
export function renderBlock({ manifest: m, dir, stack }: BlockInput): string {
  const readOrder = [`\`${dir}/BLUEPRINT.md\``];
  if (stack) readOrder.push(`\`${dir}/adapters/${stack}.md\``);
  else readOrder.push(`the matching file in \`${dir}/adapters/\``);
  readOrder.push(`\`${dir}/verify/checklist.md\``);
  const draft = m.status === 'draft' ? ' This blueprint is a **draft**: mention that to the user before applying it.' : '';
  return [
    begin(m.name),
    `## Blueprint: ${m.title}`,
    '',
    `When implementing or changing ${m.title.toLowerCase()} in this project, follow the \`${m.name}\` blueprint ` +
      `(v${m.version}, status: ${m.status}) in \`${dir}/\`.${draft}`,
    '',
    `1. Read ${readOrder.join(', then ')}.`,
    '2. Survey the codebase as described in "Integration into an existing codebase" before writing code.',
    '3. Take the defaults in "Decisions & tradeoffs" unless this codebase dictates otherwise, and record each deviation.',
    '4. Never violate a "Non-negotiable". If a request conflicts with one, stop and ask.',
    `5. When done, start the app and run \`npx ${CLI_PACKAGE} verify ${m.name} --base-url <app-url>\`, then walk the \`[manual]\` checks.`,
    '6. Report every check id as pass, fail or skipped (with reason). Do not claim completion while an automated check fails.',
    end(m.name),
  ].join('\n');
}

export type UpsertResult = 'created' | 'appended' | 'updated' | 'unchanged';

/** Insert or replace a blueprint's block in `text`, leaving everything else byte-for-byte intact. */
export function upsertBlock(text: string, name: string, block: string): { text: string; result: Exclude<UpsertResult, 'created'> } {
  const b = begin(name);
  const e = end(name);
  const start = text.indexOf(b);
  if (start !== -1) {
    const stop = text.indexOf(e, start);
    if (stop === -1) throw new Error(`found "${b}" without a matching END marker; fix the file by hand`);
    const next = text.slice(0, start) + block + text.slice(stop + e.length);
    return { text: next, result: next === text ? 'unchanged' : 'updated' };
  }
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { text: `${text}${sep}${block}\n`, result: 'appended' };
}

/** Upsert the block into a file, creating it if needed. */
export async function upsertFile(path: string, name: string, block: string): Promise<UpsertResult> {
  let current: string | null = null;
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const { text, result } = upsertBlock(current ?? '', name, block);
  if (result !== 'unchanged') await writeFile(path, text);
  return current === null ? 'created' : result;
}
