#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeSource, resolveSource } from '@your-npm-scope/blueprints-core';
import { createServer, SERVER_VERSION } from './server.js';

const USAGE = `blueprints-mcp: MCP server (stdio) for expert implementation blueprints

Usage: blueprints-mcp [--source <url-or-path>]

  --source   Registry to serve: a GitHub raw base URL or a local checkout.
             Defaults to $BLUEPRINTS_SOURCE, then the public registry.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { source: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
  if (values.help) return void process.stdout.write(USAGE);
  if (values.version) return void process.stdout.write(`${SERVER_VERSION}\n`);
  const source = resolveSource(values.source ?? process.env.BLUEPRINTS_SOURCE);
  const server = createServer({ source });
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; logs go to stderr.
  process.stderr.write(`blueprints-mcp ${SERVER_VERSION} serving ${describeSource(source)}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`blueprints-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
