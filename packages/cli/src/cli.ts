import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { NotFoundError, resolveSource, SourceError, UnsupportedStackError } from '@your-npm-scope/blueprints-core';
import { add } from './commands/add.js';
import { info, list, search } from './commands/browse.js';
import { validate } from './commands/validate.js';
import { verify } from './commands/verify.js';
import { type Io, paint, UsageError } from './io.js';

const HELP = `blueprints: expert implementation blueprints for AI coding agents

Usage:
  blueprints list                              List available blueprints
  blueprints search <query> [--stack <s>]      Search by name, title, tags or summary
  blueprints info <name>                       Show a blueprint's details
  blueprints add <name> [--stack <s>] [--dir .blueprints]
                                               Copy a blueprint (and its adapter) into this project
                                               and point AGENTS.md / CLAUDE.md at it
  blueprints verify <name> --base-url <url> [--env NAME=value ...]
                                               Run the blueprint's tests against your running app
  blueprints validate [path]                   Lint a blueprint (or a directory of them)

Options:
  --source <path|url>   Registry to read from (default: the official GitHub registry)
  --json                Machine-readable output
  --verbose             Stream test output (verify)
  --no-instructions     Do not touch AGENTS.md / CLAUDE.md (add)
  -h, --help            Show this help
  -v, --version         Show the version
`;

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        source: { type: 'string' },
        stack: { type: 'string' },
        dir: { type: 'string', default: '.blueprints' },
        'base-url': { type: 'string' },
        env: { type: 'string', multiple: true, default: [] },
        json: { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
        'no-instructions': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (err) {
    io.err(`${(err as Error).message}\n`);
    io.err(HELP);
    return 2;
  }
  const { values: o, positionals } = parsed;
  const [command, arg, ...rest] = positionals;
  if (o.version) {
    io.out(version());
    return 0;
  }
  if (o.help || !command) {
    io.out(HELP);
    return command || o.help ? 0 : 2;
  }

  const source = resolveSource(o.source, io.cwd);
  try {
    switch (command) {
      case 'list':
        return await list(io, source, o.json);
      case 'search':
        return await search(io, source, [arg, ...rest].filter(Boolean).join(' ') || undefined, o.stack, o.json);
      case 'info':
        return await info(io, source, arg, o.json);
      case 'add':
        return await add(io, source, arg, { dir: o.dir, noInstructions: o['no-instructions'], ...(o.stack ? { stack: o.stack } : {}) });
      case 'verify':
        return await verify(io, source, arg, { dir: o.dir, env: o.env, verbose: o.verbose, json: o.json, ...(o['base-url'] ? { baseUrl: o['base-url'] } : {}) });
      case 'validate':
        return await validate(io, arg, o.json);
      default:
        io.err(`Unknown command "${command}".\n`);
        io.err(HELP);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError || err instanceof NotFoundError || err instanceof UnsupportedStackError) {
      io.err(paint(io, 'red', `error: ${err.message}`));
      return 2;
    }
    if (err instanceof SourceError) {
      io.err(paint(io, 'red', `error: ${err.message}`));
      io.err('Check your network connection or pass --source <path|url>.');
      return 1;
    }
    throw err;
  }
}
