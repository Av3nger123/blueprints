import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildRegistry, resolveSource, serializeRegistry, type FetchLike } from '@your-npm-scope/blueprints-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from './server.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

async function connect(opts: Parameters<typeof createServer>[0] = { source: resolveSource(REPO) }) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(opts).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { res, text };
}

test('lists the three tools with input schemas', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_blueprint', 'get_verification', 'search_blueprints']);
  const get = tools.find((t) => t.name === 'get_blueprint')!;
  assert.deepEqual(get.inputSchema.required, ['name']);
  assert.ok(client.getInstructions()?.includes('search_blueprints'));
});

test('search_blueprints matches by keyword and stack', async () => {
  const client = await connect();
  const hit = await call(client, 'search_blueprints', { query: 'login', stack: 'fastapi' });
  assert.match(hit.text, /- auth v0\.1\.0 \[draft\]/);
  assert.equal((hit.res.structuredContent as { blueprints: { name: string }[] }).blueprints[0]!.name, 'auth');
  assert.match((await call(client, 'search_blueprints', { query: '' })).text, /auth/);
  assert.match((await call(client, 'search_blueprints', { query: 'login', stack: 'rails' })).text, /No blueprints match/);
});

test('get_blueprint returns BLUEPRINT.md, only the requested adapter, and the checklist', async () => {
  const client = await connect();
  const { res, text } = await call(client, 'get_blueprint', { name: 'auth', stack: 'express' });
  assert.ok(!res.isError);
  assert.match(text, /# Blueprint: Authentication & Authorization \(auth v0\.1\.0, status: draft\)/);
  assert.match(text, /Warning: this blueprint is a draft/);
  assert.match(text, /===== BLUEPRINT\.md =====\n# Authentication & Authorization/);
  assert.match(text, /===== adapters\/express\.md =====/);
  assert.doesNotMatch(text, /adapters\/fastapi\.md =====/);
  assert.match(text, /===== verify\/checklist\.md =====/);
  assert.match(text, /AUTH-40/);

  const noStack = await call(client, 'get_blueprint', { name: 'auth' });
  assert.match(noStack.text, /Available stacks: express, fastapi, nextjs/);
  assert.doesNotMatch(noStack.text, /===== adapters\//);
});

test('get_blueprint reports unknown names and stacks as tool errors', async () => {
  const client = await connect();
  const unknown = await call(client, 'get_blueprint', { name: 'authn' });
  assert.equal(unknown.res.isError, true);
  assert.match(unknown.text, /No blueprint named "authn"\. Did you mean: auth\?/);
  const stack = await call(client, 'get_blueprint', { name: 'auth', stack: 'rails' });
  assert.equal(stack.res.isError, true);
  assert.match(stack.text, /no adapter for "rails"/);
});

test('get_verification returns command, env, and check split; tests on request', async () => {
  const client = await connect();
  const { res, text } = await call(client, 'get_verification', { name: 'auth' });
  assert.match(text, /40 checks: 28 automated, 12 manual/);
  assert.match(text, /\| BASE_URL \| yes \|/);
  assert.match(text, /BASE_URL=http:\/\/localhost:3000 node verify\/tests\/run\.mjs/);
  assert.doesNotMatch(text, /===== verify\/tests\/run\.mjs =====/);
  const sc = res.structuredContent as { manual: string[]; test_files: string[] };
  assert.equal(sc.manual.length, 12);
  assert.ok(sc.test_files.includes('verify/tests/run.mjs'));

  const full = await call(client, 'get_verification', { name: 'auth', include_tests: true });
  assert.match(full.text, /===== verify\/tests\/run\.mjs =====\n/);
  assert.match(full.text, /===== verify\/tests\/lib\/client\.mjs =====/);
});

test('works against a remote source over fetch and caches registry.json', async () => {
  const { registry } = await buildRegistry(REPO);
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const rel = url.replace('https://example.test/bp/', '');
    const body = rel === 'registry.json' ? serializeRegistry(registry) : await readFile(join(REPO, rel), 'utf8').catch(() => null);
    return { ok: body !== null, status: body === null ? 404 : 200, statusText: '', text: async () => body ?? '' };
  };
  const client = await connect({ source: resolveSource('https://example.test/bp'), fetch });
  assert.match((await call(client, 'get_blueprint', { name: 'auth', stack: 'nextjs' })).text, /===== adapters\/nextjs\.md =====/);
  await call(client, 'search_blueprints', { query: 'auth' });
  assert.equal(urls.filter((u) => u.endsWith('/registry.json')).length, 1);
  assert.ok(urls.includes('https://example.test/bp/blueprints/auth/adapters/nextjs.md'));
});

test('the built stdio binary starts and serves get_blueprint', { timeout: 30_000 }, async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const bin = fileURLToPath(new URL('./index.ts', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', bin, '--source', REPO],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    const { text } = await call(client, 'get_blueprint', { name: 'auth', stack: 'fastapi' });
    assert.match(text, /===== adapters\/fastapi\.md =====/);
  } finally {
    await client.close();
  }
});
