// Just enough Semantic Versioning for blueprint dependencies: exact, ^caret, ~tilde and *.
// Caret and tilde follow npm semantics, including the 0.x rules.

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(v: string): SemVer | null {
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, prerelease: m[4] ? m[4].split('.') : [] };
}

export function compareVersions(a: SemVer, b: SemVer): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  // A version without prerelease ranks higher than one with it.
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length;
  const n = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return +x - +y;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** True if `version` satisfies `range`. Unparseable input never satisfies. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === '*') return v.prerelease.length === 0;
  const op = r[0] === '^' || r[0] === '~' ? r[0] : '';
  const base = parseVersion(op ? r.slice(1) : r);
  if (!base) return false;
  if (!op) return compareVersions(v, base) === 0;
  if (compareVersions(v, base) < 0) return false;
  // Prereleases only match a range whose base is a prerelease of the same major.minor.patch.
  if (v.prerelease.length && !(base.prerelease.length && v.major === base.major && v.minor === base.minor && v.patch === base.patch)) {
    return false;
  }
  if (op === '~') return v.major === base.major && v.minor === base.minor;
  if (base.major > 0) return v.major === base.major;
  if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
  return v.major === 0 && v.minor === 0 && v.patch === base.patch;
}
