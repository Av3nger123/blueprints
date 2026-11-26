import type { ChecklistItem } from './types.js';

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** ATX headings outside fenced code blocks. */
export function parseHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      const marker = f[1]!;
      if (fence === null) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      return;
    }
    if (fence !== null) return;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) out.push({ level: h[1]!.length, text: h[2]!.trim(), line: i + 1 });
  });
  return out;
}

/** Body text of each level-2 section, keyed by heading text. */
export function sectionBodies(markdown: string): Map<string, string> {
  const lines = markdown.split(/\r?\n/);
  const h2 = parseHeadings(markdown).filter((h) => h.level === 2);
  const map = new Map<string, string>();
  h2.forEach((h, i) => {
    const end = i + 1 < h2.length ? h2[i + 1]!.line - 1 : lines.length;
    map.set(h.text, lines.slice(h.line, end).join('\n').trim());
  });
  return map;
}

/**
 * Check that `required` level-2 headings appear in order (extra headings allowed only after the last
 * required one). Returns human-readable problems.
 */
export function checkSectionOrder(markdown: string, required: readonly string[]): string[] {
  const problems: string[] = [];
  const h2 = parseHeadings(markdown).filter((h) => h.level === 2).map((h) => h.text);
  const bodies = sectionBodies(markdown);
  let cursor = 0;
  for (const name of required) {
    const idx = h2.indexOf(name);
    if (idx === -1) {
      problems.push(`missing section "## ${name}"`);
      continue;
    }
    if (idx < cursor) problems.push(`section "## ${name}" is out of order`);
    cursor = Math.max(cursor, idx);
    if (!bodies.get(name)) problems.push(`section "## ${name}" is empty`);
  }
  const lastRequired = Math.max(...required.map((r) => h2.indexOf(r)));
  h2.forEach((name, i) => {
    if (!required.includes(name) && i < lastRequired) {
      problems.push(`extra section "## ${name}" must come after "## ${required[required.length - 1]}"`);
    }
  });
  return problems;
}

const CHECK_RE = /^\s*(?:\d+\.\s+|[-*]\s+)?(?:\*\*)?([A-Z][A-Z0-9]*-\d{2,})(?:\*\*)?\s+`?\[(automated|manual)\]`?\s*(.*)$/;
const ID_ONLY_RE = /^\s*(?:\d+\.\s+|[-*]\s+)(?:\*\*)?([A-Z][A-Z0-9]*-\d{2,})(?:\*\*)?(?!\S)/;

export interface ParsedChecklist {
  items: ChecklistItem[];
  problems: string[];
}

/** Parse checklist items of the form `1. **AUTH-01** `[automated]` text`. */
export function parseChecklist(markdown: string): ParsedChecklist {
  const items: ChecklistItem[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const m = CHECK_RE.exec(line);
    if (m) {
      const id = m[1]!;
      if (seen.has(id)) problems.push(`duplicate check id ${id}`);
      seen.add(id);
      items.push({ id, kind: m[2] as ChecklistItem['kind'], text: m[3]!.trim() });
      continue;
    }
    const bare = ID_ONLY_RE.exec(line);
    if (bare) problems.push(`check ${bare[1]} is not tagged [automated] or [manual]`);
  }
  if (items.length === 0) problems.push('no checks found (expected lines like "1. **ID-01** `[automated]` ...")');
  return { items, problems };
}
