import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  describeSource,
  findEntry,
  loadBlueprint,
  NotFoundError,
  parseChecklist,
  readRegistry,
  resolveDependencies,
  searchRegistry,
  SourceError,
  UnsupportedStackError,
  type BlueprintManifest,
  type BlueprintSource,
  type FetchLike,
  type Registry,
  type RegistryEntry,
} from '@your-npm-scope/blueprints-core';
import { z } from 'zod';

export const SERVER_NAME = 'blueprints';
export const SERVER_VERSION = '0.1.0';
export const CLI_PACKAGE = '@your-npm-scope/blueprints';

export interface ServerOptions {
  source: BlueprintSource;
  fetch?: FetchLike;
  /** How long to reuse a fetched registry.json. Default 5 minutes for remote sources, 0 for local. */
  registryTtlMs?: number;
}

const INSTRUCTIONS = `Blueprints are expert implementation guides for common features (e.g. auth), with stack adapters and a verification suite.
Before implementing a feature a blueprint covers, call search_blueprints, then get_blueprint with the project's stack, and follow it:
Decisions and Non-negotiables are requirements, not suggestions. When done, call get_verification and run the suite against the running app.
Report each checklist ID as pass, fail, or not verified. Never claim a check passed without evidence.`;

/** Build the MCP server. Transport-agnostic so tests can connect in memory. */
export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const readOpts = opts.fetch ? { fetch: opts.fetch } : {};
  const ttl = opts.registryTtlMs ?? (opts.source.kind === 'remote' ? 5 * 60_000 : 0);
  let cached: { at: number; registry: Registry } | undefined;

  async function registry(): Promise<Registry> {
    if (cached && Date.now() - cached.at < ttl) return cached.registry;
    const reg = await readRegistry(opts.source, readOpts);
    cached = { at: Date.now(), registry: reg };
    return reg;
  }

  server.registerTool(
    'search_blueprints',
    {
      title: 'Search blueprints',
      description:
        'Find expert implementation blueprints (e.g. "auth", "login", "csrf"). Returns name, version, status, supported stacks and a summary for each match. Pass an empty query to list everything.',
      inputSchema: {
        query: z.string().describe('Words to match against blueprint names, tags, titles and summaries. Empty lists all.'),
        stack: z.string().optional().describe('Only blueprints with an adapter for this stack, e.g. express, fastapi, nextjs.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query, stack }) =>
      guard(async () => {
        const reg = await registry();
        const hits = query.trim() ? searchRegistry(reg, query, stack) : reg.blueprints.filter((b) => !stack || b.stacks.includes(stack.toLowerCase()));
        if (hits.length === 0) {
          return text(`No blueprints match "${query}"${stack ? ` for stack ${stack}` : ''}. Available: ${reg.blueprints.map((b) => b.name).join(', ') || '(none)'}.`);
        }
        const lines = hits.map(
          (b) => `- ${b.name} v${b.version} [${b.status}] (${b.category}; stacks: ${b.stacks.join(', ')})\n  ${b.title}: ${b.summary}`,
        );
        return {
          content: [{ type: 'text', text: `${hits.length} blueprint(s):\n${lines.join('\n')}\n\nNext: get_blueprint(name, stack).` }],
          structuredContent: { blueprints: hits.map(summaryOf) },
        };
      }),
  );

  server.registerTool(
    'get_blueprint',
    {
      title: 'Get blueprint',
      description:
        'Return a blueprint to implement: BLUEPRINT.md (decisions, non-negotiables, architecture, data model, API contract, integration steps), the adapter for the given stack, and the verification checklist. Follow it when implementing the feature.',
      inputSchema: {
        name: z.string().describe('Blueprint name, e.g. "auth".'),
        stack: z.string().optional().describe('Project stack, e.g. express, fastapi, nextjs. Omit to see which stacks are available.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ name, stack }) =>
      guard(async () => {
        const reg = await registry();
        const entry = findEntry(reg, name);
        const deps = resolveDependencies(reg, entry.name);
        const files = ['BLUEPRINT.md', 'verify/checklist.md', ...(stack ? [`adapters/${stack.toLowerCase()}.md`] : [])];
        const bp = await loadBlueprint(opts.source, entry.name, { ...readOpts, registry: reg, only: files, ...(stack ? { stack } : {}) });
        const m = bp.manifest;
        const adapterPath = stack ? `adapters/${stack.toLowerCase()}.md` : undefined;

        const header = [
          `# Blueprint: ${m.title} (${m.name} v${m.version}, status: ${m.status})`,
          m.status === 'draft' ? 'Warning: this blueprint is a draft and has not had maintainer review. Tell the user before applying it.' : '',
          deps.length ? `Depends on: ${deps.map((d) => `${d.name} v${d.version}`).join(', ')}. Apply those first (get_blueprint for each).` : '',
          stack
            ? `Stack: ${stack.toLowerCase()}. Read BLUEPRINT.md, then the adapter. Where they disagree, the adapter wins on stack mechanics; BLUEPRINT.md wins on security requirements.`
            : `No stack given. Available stacks: ${entry.stacks.join(', ')}. Call get_blueprint again with stack to get the matching adapter.`,
          `Verification: after implementing, call get_verification("${m.name}") or run \`npx ${CLI_PACKAGE} verify ${m.name} --base-url <app-url>\`.`,
          `Source: ${describeSource(opts.source)}/${entry.path}`,
        ]
          .filter(Boolean)
          .join('\n');

        const content: CallToolResult['content'] = [
          { type: 'text', text: header },
          { type: 'text', text: fileBlock('BLUEPRINT.md', bp.files['BLUEPRINT.md']) },
        ];
        if (adapterPath) content.push({ type: 'text', text: fileBlock(adapterPath, bp.files[adapterPath]) });
        content.push({ type: 'text', text: fileBlock('verify/checklist.md', bp.files['verify/checklist.md']) });
        return { content, structuredContent: { ...summaryOf(entry), stack: stack?.toLowerCase() ?? null, depends_on: deps.map((d) => d.name) } };
      }),
  );

  server.registerTool(
    'get_verification',
    {
      title: 'Get verification suite',
      description:
        "Return how to verify an implementation of a blueprint: the checklist (automated and manual checks), the command and environment variables for the black-box test suite, and how to run it against the running app. Set include_tests to also get the test sources.",
      inputSchema: {
        name: z.string().describe('Blueprint name, e.g. "auth".'),
        include_tests: z.boolean().optional().describe('Also return the full test suite source files (large). Default false.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ name, include_tests }) =>
      guard(async () => {
        const reg = await registry();
        const entry = findEntry(reg, name);
        const testFiles = entry.files.filter((f) => f.startsWith('verify/tests/'));
        const bp = await loadBlueprint(opts.source, entry.name, {
          ...readOpts,
          registry: reg,
          only: ['blueprint.yaml', 'verify/checklist.md', ...(include_tests ? testFiles : [])],
        });
        const m = bp.manifest;
        const checklist = bp.files['verify/checklist.md'] ?? '';
        const { items } = parseChecklist(checklist);
        const automated = items.filter((i) => i.kind === 'automated').map((i) => i.id);
        const manual = items.filter((i) => i.kind === 'manual').map((i) => i.id);

        const howTo = [
          `# Verification: ${m.title} (${m.name} v${m.version})`,
          `${items.length} checks: ${automated.length} automated, ${manual.length} manual.`,
          '',
          '## Run the automated suite',
          'Start the app, then either:',
          `- \`npx ${CLI_PACKAGE} verify ${m.name} --base-url http://localhost:3000\` (fetches the suite if it is not installed and reports each check ID), or`,
          `- from the installed blueprint directory (\`${CLI_PACKAGE} add ${m.name}\` puts it in .blueprints/${m.name}): \`BASE_URL=http://localhost:3000 ${m.verification.command}\``,
          `Framework: ${m.verification.framework}; runtime: ${m.verification.runtime}.`,
          '',
          '## Environment',
          envTable(m),
          '',
          '## Reporting',
          'Report every checklist ID as pass, fail, or not verified. A skipped test is not a pass: configure it (see the env table) and run again.',
          `Manual checks need code review or a human: ${manual.join(', ') || '(none)'}.`,
          '',
          `Test files: ${testFiles.join(', ')}`,
        ].join('\n');

        const content: CallToolResult['content'] = [
          { type: 'text', text: howTo },
          { type: 'text', text: fileBlock('verify/checklist.md', checklist) },
        ];
        if (include_tests) for (const f of testFiles) content.push({ type: 'text', text: fileBlock(f, bp.files[f]) });
        return {
          content,
          structuredContent: {
            name: m.name,
            version: m.version,
            command: m.verification.command,
            env: m.verification.env,
            automated,
            manual,
            test_files: testFiles,
          },
        };
      }),
  );

  return server;
}

function summaryOf(e: RegistryEntry) {
  return { name: e.name, version: e.version, title: e.title, summary: e.summary, category: e.category, status: e.status, stacks: e.stacks, tags: e.tags };
}

function envTable(m: BlueprintManifest): string {
  const rows = m.verification.env.map(
    (e) => `| ${e.name} | ${e.required ? 'yes' : 'no'} | ${e.default ?? ''} | ${e.description.replace(/\|/g, '\\|')} |`,
  );
  return ['| Variable | Required | Default | Description |', '|---|---|---|---|', ...rows].join('\n');
}

function fileBlock(path: string, body: string | undefined): string {
  return `===== ${path} =====\n${body ?? '(missing)'}`;
}

function text(t: string): CallToolResult {
  return { content: [{ type: 'text', text: t }] };
}

/** Turn expected failures (unknown name, unsupported stack, unreachable source) into tool errors the model can read. */
async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof UnsupportedStackError || e instanceof SourceError) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
