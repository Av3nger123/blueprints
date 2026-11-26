/** Output and environment seams so commands are testable without spawning processes. */
export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out(line?: string): void;
  err(line?: string): void;
  color: boolean;
}

export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (line = '') => process.stdout.write(`${line}\n`),
    err: (line = '') => process.stderr.write(`${line}\n`),
    color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  };
}

export class UsageError extends Error {
  override name = 'UsageError';
}

const codes = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39] } as const;
export type Style = keyof typeof codes;

export function paint(io: Io, style: Style, text: string): string {
  if (!io.color) return text;
  const [open, close] = codes[style];
  return `\u001b[${open}m${text}\u001b[${close}m`;
}

/** Render rows as an aligned plain-text table. The last column is not padded. */
export function table(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd());
}
