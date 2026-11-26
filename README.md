# blueprints

**Expert implementation blueprints for AI coding agents.** A blueprint gives your agent a senior engineer's playbook for one capability, such as authentication. It holds the decisions, the non-negotiables and the stack-specific wiring, plus a test suite that proves the result.

```sh
npx @your-npm-scope/blueprints add auth --stack express
```

> **Status: early.** The spec is v0.1. `auth` is the first blueprint and is a **draft**: it has not yet had independent expert review. The npm packages are not published yet; until they are, run from source (see [Development](#development)).

## The problem

Ask a coding agent to "add login" and you get code that works in the demo. Whether it is secure depends on what the model absorbed from its training data. The well-known failure classes all look fine until someone attacks them:

- a session ID that survives login (session fixation)
- "user not found" next to "wrong password" (account enumeration)
- a fast or unsalted password hash
- no CSRF defense or brute-force throttling
- authorization checked in the UI but not on the server

Agents also tend to report "done" with no evidence.

Generic rules files don't solve this. They are too short to carry the decisions that matter, and nothing checks that they were followed.

## What a blueprint is

A blueprint is a directory of Markdown, YAML and runnable tests:

| Part | File | What it gives the agent |
|---|---|---|
| Knowledge | `BLUEPRINT.md` | Decisions with tradeoffs and one marked default each, numbered non-negotiables citing their sources (OWASP ASVS, NIST, RFCs), the architecture, the data model, the API contract, a brownfield integration procedure, and common mistakes |
| Stack adapters | `adapters/<stack>.md` | Which maintained libraries to use (never hand-rolled crypto), how the architecture maps onto the framework, exact configuration, and stack-specific gotchas |
| Verification | `verify/checklist.md`, `verify/tests/` | Numbered checks, each marked `[automated]` or `[manual]`. The automated checks are black-box HTTP tests you run against the running app. |
| Provenance | `blueprint.yaml` | Authors, reviewers, sources, version, trust tier (`draft` → `community` → `verified` → `expert-reviewed`), and the date of the last review |

The format is defined in [`spec/blueprint-spec.md`](spec/blueprint-spec.md) and [`spec/blueprint.schema.json`](spec/blueprint.schema.json).

GitHub is the registry. There is no backend, database or account. The tools read [`registry.json`](registry.json) and the blueprint files straight from this repository, or from your fork, a pinned tag, or a local checkout via `--source`.

## Install in 30 seconds

### Option A: drop it into your repository (works with any agent)

```sh
cd your-app
npx @your-npm-scope/blueprints add auth --stack express    # or fastapi, nextjs; omit to auto-detect
```

This command:

- copies `BLUEPRINT.md`, the adapter for your stack, and the verification suite into `.blueprints/auth/`
- adds a marked block to `AGENTS.md` and `CLAUDE.md` telling the agent to read them before touching auth

Re-running the command updates the block in place and never duplicates it. Then ask your agent to implement auth, start the app, and check the result:

```sh
npx @your-npm-scope/blueprints verify auth --base-url http://localhost:3000
```

```
PASS  AUTH-07  No response contains a plaintext password, a password hash, or secret-named fields.
FAIL  AUTH-20  Logout returns 204, expires the cookie, and invalidates the session on the server…
SKIP  AUTH-15  The session cookie is Secure. Skipped over http://; it must pass once against HTTPS.
...
```

Skipped checks are never counted as passes, and the report lists the manual checks still to review. A blueprint directory also contains a generated `SKILL.md`, so it works as an Agent Skill too.

### Option B: MCP server (Claude Code, Cursor, Codex)

```sh
# Claude Code
claude mcp add blueprints -- npx -y @your-npm-scope/blueprints-mcp

# Codex
codex mcp add blueprints -- npx -y @your-npm-scope/blueprints-mcp
```

Cursor: add this to `.cursor/mcp.json`:

```json
{ "mcpServers": { "blueprints": { "command": "npx", "args": ["-y", "@your-npm-scope/blueprints-mcp"] } } }
```

The server exposes three tools:

- `search_blueprints(query, stack?)`
- `get_blueprint(name, stack?)`: returns `BLUEPRINT.md`, the adapter and the checklist
- `get_verification(name)`

See [`packages/mcp-server`](packages/mcp-server/README.md) for options.

## Blueprints

| Name | Version | Status | Stacks | Summary |
|---|---|---|---|---|
| [`auth`](blueprints/auth/BLUEPRINT.md) | 0.1.0 | draft | express, fastapi, nextjs | Email-and-password authentication with server-side sessions, argon2id password storage, recovery, brute-force and CSRF protection, and deny-by-default RBAC in the service layer. It has 40 checks: 28 automated and 12 manual. |

## CLI reference

| Command | What it does |
|---|---|
| `blueprints list` | List the blueprints in the registry |
| `blueprints search <query> [--stack s]` | Search names, tags, titles and summaries |
| `blueprints info <name>` | Show versions, stacks, sources, reviewers and the install command |
| `blueprints add <name> [--stack s] [--dir .blueprints] [--no-instructions]` | Install a blueprint and its adapter, and update `AGENTS.md` and `CLAUDE.md` |
| `blueprints verify <name> --base-url <url> [--env K=V]` | Run the suite against a running app and report per check (exit 1 on failure) |
| `blueprints validate [path]` | Check a blueprint against the spec |

Every command accepts `--source <url-or-path>`, and most accept `--json`.

## Benchmark

Does a blueprint actually change what agents build? [`benchmark/`](benchmark/README.md) defines the method: baseline and blueprint arms with identical prompts, scoring by the verification suite plus blind manual review, and every run published with raw data. Tasks exist for Express and FastAPI.

**Results coming.** No runs have been published yet, and this README will not quote numbers until they have been, with the raw data next to them.

## Repository layout

```
spec/                 blueprint format (Markdown spec + JSON Schema)
blueprints/<name>/    the blueprints themselves
registry.json         generated index (pnpm registry)
packages/core         @your-npm-scope/blueprints-core: load, validate, resolve dependencies
packages/cli          @your-npm-scope/blueprints: the `blueprints` command
packages/mcp-server   @your-npm-scope/blueprints-mcp: stdio MCP server
scripts/              registry and SKILL.md generator
benchmark/            methodology, tasks, results template
```

## Development

Requires Node 20.19+ and pnpm 10.

```sh
pnpm i && pnpm build && pnpm test
node packages/cli/dist/index.js add auth --stack express --source /path/to/this/repo   # from inside your app
node packages/mcp-server/dist/index.js --source .                                     # MCP server on the local checkout
```

Other scripts: `pnpm lint`, `pnpm typecheck`, `pnpm validate`, `pnpm registry` (regenerate `registry.json` and the `SKILL.md` files), and `pnpm registry:check`.

## Contributing

New blueprints, adapters for more stacks, extra checks, and reviews by domain experts are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code (`packages/`, `scripts/`, and the runnable tests under `blueprints/*/verify/tests/`) is [MIT](LICENSE). Blueprint content (everything else under `blueprints/`, `spec/blueprint-spec.md`, and the benchmark task prompts) is [CC BY 4.0](LICENSE-CONTENT). Blueprints are guidance, not a warranty. Review what your agent builds.
