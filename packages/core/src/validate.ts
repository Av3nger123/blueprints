import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ADAPTER_SECTIONS, BLUEPRINT_SECTIONS, GENERATED_FILES, SPEC_VERSION } from './constants.js';
import { parseManifest } from './manifest.js';
import { checkSectionOrder, parseChecklist, parseHeadings, sectionBodies } from './markdown.js';
import { parseVersion } from './semver.js';
import { SKILL_MARKER } from './skill.js';
import { listFilesRecursive, localExists } from './source.js';
import type { BlueprintManifest, Issue, ValidationResult } from './types.js';

export interface ValidateOptions {
  /** Names of every blueprint in the registry, to check depends_on targets exist. */
  knownNames?: ReadonlySet<string>;
}

/**
 * Validate a blueprint directory against the spec: schema, required files and sections, adapters,
 * checklist, tests, and the machine-checkable trust-tier rules. Never throws for content problems.
 */
export async function validateBlueprintDir(dir: string, opts: ValidateOptions = {}): Promise<ValidationResult> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const result: ValidationResult = { dir, errors, warnings };
  const err = (message: string, file?: string) => errors.push(file ? { file, message } : { message });
  const warn = (message: string, file?: string) => warnings.push(file ? { file, message } : { message });

  if (!(await localExists(join(dir, 'blueprint.yaml')))) {
    err('missing blueprint.yaml', 'blueprint.yaml');
    return result;
  }
  const files = await listFilesRecursive(dir);
  const read = (rel: string) => readFile(join(dir, ...rel.split('/')), 'utf8');

  const parsed = parseManifest(await read('blueprint.yaml'));
  errors.push(...parsed.errors);
  const m = parsed.manifest;
  if (m) {
    result.manifest = m;
    result.name = m.name;
    if (m.name !== basename(dir)) err(`name "${m.name}" must match the directory name "${basename(dir)}"`, 'blueprint.yaml');
    if (m.spec_version !== SPEC_VERSION) warn(`targets spec ${m.spec_version}; this tool implements ${SPEC_VERSION}`, 'blueprint.yaml');
    if (m.status === 'draft') warn('status is draft: agents should warn before applying it', 'blueprint.yaml');
    for (const dep of m.depends_on) {
      if (dep.name === m.name) err('depends_on must not include the blueprint itself', 'blueprint.yaml');
      else if (opts.knownNames && !opts.knownNames.has(dep.name)) err(`depends_on "${dep.name}" is not in the registry`, 'blueprint.yaml');
    }
  }

  // BLUEPRINT.md
  if (!files.includes('BLUEPRINT.md')) {
    err('missing BLUEPRINT.md', 'BLUEPRINT.md');
  } else {
    const md = await read('BLUEPRINT.md');
    const h1 = parseHeadings(md).find((h) => h.level === 1);
    if (!h1) err('must start with a level-1 heading', 'BLUEPRINT.md');
    else if (m && h1.text !== m.title) err(`level-1 heading "${h1.text}" must equal title "${m.title}"`, 'BLUEPRINT.md');
    for (const p of checkSectionOrder(md, BLUEPRINT_SECTIONS)) err(p, 'BLUEPRINT.md');
    const decisions = sectionBodies(md).get('Decisions & tradeoffs');
    if (decisions) for (const p of checkDefaults(decisions)) err(p, 'BLUEPRINT.md');
  }

  // Adapters
  const adapterFiles = files.filter((f) => /^adapters\/[^/]+\.md$/.test(f));
  const adapterStacks = new Set(adapterFiles.map((f) => f.slice('adapters/'.length, -'.md'.length)));
  if (m) {
    for (const stack of m.stacks) {
      if (!adapterStacks.has(stack)) err(`stack "${stack}" has no adapters/${stack}.md`, `adapters/${stack}.md`);
    }
    for (const stack of adapterStacks) {
      if (!m.stacks.includes(stack)) err(`adapters/${stack}.md is not listed in stacks`, `adapters/${stack}.md`);
    }
  }
  for (const f of adapterFiles) {
    const md = await read(f);
    if (!parseHeadings(md).some((h) => h.level === 1)) err('must start with a level-1 heading', f);
    for (const p of checkSectionOrder(md, ADAPTER_SECTIONS)) err(p, f);
  }

  // Verification
  let automated = 0;
  if (!files.includes('verify/checklist.md')) {
    err('missing verify/checklist.md', 'verify/checklist.md');
  } else {
    const { items, problems } = parseChecklist(await read('verify/checklist.md'));
    for (const p of problems) err(p, 'verify/checklist.md');
    automated = items.filter((i) => i.kind === 'automated').length;
  }
  if (!files.some((f) => f.startsWith('verify/tests/'))) err('verify/tests/ must contain the runnable tests', 'verify/tests/');

  // Generated files must match what the build would produce; the build script checks content.
  for (const g of GENERATED_FILES) {
    if (files.includes(g) && m && !(await read(g)).includes(SKILL_MARKER)) {
      err(`${g} is generated; do not hand-write it`, g);
    }
  }

  if (m) checkTrustTier(m, automated, err);
  return result;
}

/** Each `###` decision needs its own `**Default:` marker; with no subsections, the section needs one. */
function checkDefaults(decisions: string): string[] {
  const DEFAULT = /\*\*Default:/;
  const subsections = decisions.split(/^(?=### )/m).filter((s) => s.startsWith('### '));
  if (subsections.length === 0) {
    return DEFAULT.test(decisions) ? [] : ['"## Decisions & tradeoffs" must mark a **Default:**'];
  }
  return subsections
    .filter((s) => !DEFAULT.test(s))
    .map((s) => `decision "${s.split('\n')[0]!.slice(4).trim()}" has no **Default:** marker`);
}

function checkTrustTier(m: BlueprintManifest, automated: number, err: (msg: string, file?: string) => void): void {
  if (m.status === 'draft') return;
  if (automated === 0) err(`status "${m.status}" requires at least one [automated] check`, 'verify/checklist.md');
  if (m.status === 'expert-reviewed') {
    const v = parseVersion(m.version);
    const ok = m.reviewers.some((r) => {
      const rv = parseVersion(r.reviewed_version);
      return v && rv && rv.major === v.major && rv.minor === v.minor;
    });
    if (!ok) err(`status "expert-reviewed" requires a reviewer whose reviewed_version matches ${m.version} (same MAJOR.MINOR)`, 'blueprint.yaml');
  }
}
