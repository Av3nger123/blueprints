import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Best-effort guess of the project's stacks from its manifests. Returns every stack it finds evidence
 * for, most specific first (a Next.js app that also depends on express is a Next.js app).
 */
export async function detectStacks(projectDir: string): Promise<string[]> {
  const found: string[] = [];
  const pkgText = await readText(join(projectDir, 'package.json'));
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as Record<string, Record<string, string> | undefined>;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) found.push('nextjs');
      if (deps.express) found.push('express');
    } catch {
      // unreadable package.json: no evidence
    }
  }
  const py = (await Promise.all(['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.cfg'].map((f) => readText(join(projectDir, f)))))
    .filter(Boolean)
    .join('\n');
  if (/(^|[\s"'[,])fastapi\b/im.test(py)) found.push('fastapi');
  return found;
}

/**
 * Pick the adapter to install: the explicit choice, else the single detected stack the blueprint supports.
 * Returns `{ stack: undefined }` when nothing matches (install all adapters), or `ambiguous` candidates.
 */
export async function chooseStack(
  projectDir: string,
  supported: string[],
  explicit?: string,
): Promise<{ stack?: string; detected: string[]; ambiguous?: string[] }> {
  if (explicit) return { stack: explicit.toLowerCase(), detected: [] };
  const detected = await detectStacks(projectDir);
  const candidates = detected.filter((s) => supported.includes(s));
  if (candidates.length === 1) return { stack: candidates[0], detected };
  // Next.js projects commonly carry express as a dev/server dependency; prefer the framework.
  if (candidates.includes('nextjs')) return { stack: 'nextjs', detected };
  if (candidates.length > 1) return { detected, ambiguous: candidates };
  return { detected };
}
