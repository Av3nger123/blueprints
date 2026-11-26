import type { ChecklistItem } from '@your-npm-scope/blueprints-core';

export type TestStatus = 'pass' | 'fail' | 'skip' | 'todo';

export interface TapTest {
  name: string;
  status: TestStatus;
  reason?: string;
  /** Checklist id found at the start of the test name, e.g. AUTH-07. */
  id?: string;
}

const LINE = /^\s*(not ok|ok)\s+\d+(?:\s+-)?\s*(.*?)(?:\s+#\s+(SKIP|TODO)\b\s*(.*))?$/i;
const ID = /^([A-Z][A-Z0-9]*-\d{2,})\b/;

/** Parse test points from TAP output, including indented subtests. */
export function parseTap(output: string): TapTest[] {
  const tests: TapTest[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[2]!.replace(/\\#/g, '#').trim();
    const directive = m[3]?.toUpperCase();
    const status: TestStatus = directive === 'SKIP' ? 'skip' : directive === 'TODO' ? 'todo' : m[1]!.toLowerCase() === 'ok' ? 'pass' : 'fail';
    const t: TapTest = { name, status };
    const reason = m[4]?.trim();
    if (reason) t.reason = reason;
    const id = ID.exec(name)?.[1];
    if (id) t.id = id;
    tests.push(t);
  }
  return tests;
}

export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'not-run';

export interface CheckResult {
  id: string;
  text: string;
  status: CheckStatus;
  reasons: string[];
}

/**
 * Fold test results into automated checklist items: a check fails if any of its tests failed, passes if
 * at least one passed and none failed, is skipped if all its tests were skipped, and is not-run otherwise.
 */
export function foldChecks(items: ChecklistItem[], tests: TapTest[]): CheckResult[] {
  return items
    .filter((i) => i.kind === 'automated')
    .map((item) => {
      const mine = tests.filter((t) => t.id === item.id);
      const reasons = [...new Set(mine.filter((t) => t.status === 'skip' && t.reason).map((t) => t.reason!))];
      let status: CheckStatus = 'not-run';
      if (mine.some((t) => t.status === 'fail')) status = 'fail';
      else if (mine.some((t) => t.status === 'pass')) status = 'pass';
      else if (mine.length) status = 'skipped';
      return { id: item.id, text: item.text, status, reasons };
    });
}
