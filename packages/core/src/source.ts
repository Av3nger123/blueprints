import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DEFAULT_SOURCE } from './constants.js';

export type BlueprintSource =
  | { kind: 'local'; root: string }
  | { kind: 'remote'; baseUrl: string };

/**
 * Turn a user-supplied `--source` into a source. No value means DEFAULT_SOURCE. Anything starting with
 * http:// or https:// is remote; everything else is a local directory resolved against `cwd`.
 */
export function resolveSource(input?: string, cwd: string = process.cwd()): BlueprintSource {
  const value = input?.trim() || DEFAULT_SOURCE;
  if (/^https?:\/\//i.test(value)) return { kind: 'remote', baseUrl: value.replace(/\/+$/, '') };
  return { kind: 'local', root: isAbsolute(value) ? value : resolve(cwd, value) };
}

export function describeSource(source: BlueprintSource): string {
  return source.kind === 'remote' ? source.baseUrl : source.root;
}

export class SourceError extends Error {
  override name = 'SourceError';
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ReadOptions {
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Read one text file at a posix path relative to the source root. */
export async function readSourceText(source: BlueprintSource, relPath: string, opts: ReadOptions = {}): Promise<string> {
  assertSafeRelative(relPath);
  if (source.kind === 'local') {
    const file = join(source.root, ...relPath.split('/'));
    try {
      return await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new SourceError(`Not found: ${file}`);
      throw err;
    }
  }
  const url = `${source.baseUrl}/${relPath.split('/').map(encodeURIComponent).join('/')}`;
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let res;
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  } catch (err) {
    throw new SourceError(`Could not fetch ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new SourceError(`Could not fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

export async function localExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** All files under `dir`, as sorted posix paths relative to `dir`. Skips dotfiles and node_modules. */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(current, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

/** Reject absolute paths and `..` segments so registry data can never escape the source root. */
export function assertSafeRelative(relPath: string): void {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\\') || relPath.split('/').some((s) => s === '..' || s === '')) {
    throw new SourceError(`Unsafe path in registry: ${JSON.stringify(relPath)}`);
  }
}
