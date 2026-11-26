# @your-npm-scope/blueprints-mcp

An [MCP](https://modelcontextprotocol.io) server (stdio) that serves [blueprints](https://github.com/Av3nger123/blueprints) to AI coding agents. A blueprint is an expert implementation guide for a common feature, such as authentication. It holds the decisions, non-negotiables, data model and API contract, plus an adapter for your stack and a black-box verification suite.

The server reads `registry.json` and blueprint files straight from GitHub. It has no backend and no account.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_blueprints` | `query`, `stack?` | Matching blueprints with version, status, stacks and summary. An empty query lists all. |
| `get_blueprint` | `name`, `stack?` | `BLUEPRINT.md`, the adapter for `stack`, and `verify/checklist.md`. Without `stack` it lists the available stacks. |
| `get_verification` | `name`, `include_tests?` | The checklist, the test command and its environment variables, and how to run the suite against your app. Set `include_tests` to also get the test sources. |

Unknown names and unsupported stacks come back as tool errors with suggestions, so the agent can correct itself.

## Setup

Every client runs the same command: `npx -y @your-npm-scope/blueprints-mcp`.

### Claude Code

```sh
claude mcp add blueprints -- npx -y @your-npm-scope/blueprints-mcp
```

To share the server with your team, add `--scope project`. This writes `.mcp.json`:

```json
{
  "mcpServers": {
    "blueprints": { "command": "npx", "args": ["-y", "@your-npm-scope/blueprints-mcp"] }
  }
}
```

### Cursor

Add the server to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "blueprints": { "command": "npx", "args": ["-y", "@your-npm-scope/blueprints-mcp"] }
  }
}
```

### Codex

```sh
codex mcp add blueprints -- npx -y @your-npm-scope/blueprints-mcp
```

You can also add it to `~/.codex/config.toml` by hand:

```toml
[mcp_servers.blueprints]
command = "npx"
args = ["-y", "@your-npm-scope/blueprints-mcp"]
```

## Options

| Flag / env | Default | Purpose |
|---|---|---|
| `--source <url-or-path>` / `BLUEPRINTS_SOURCE` | `https://raw.githubusercontent.com/Av3nger123/blueprints/main` | The registry to serve. This can be a fork, a pinned tag or commit (`.../blueprints/v0.1.0`), or a local checkout (`--source ./path/to/blueprints`). |

Logs go to stderr, because stdout carries the protocol. The server caches `registry.json` for 5 minutes for remote sources and re-reads it on every call for local ones.

## How agents should use it

The server sends these instructions to the client when it starts:

1. Before you build a feature that a blueprint covers, call `search_blueprints`, then call `get_blueprint` with the project's stack.
2. Treat Decisions and Non-negotiables as requirements. Where the blueprint and the adapter disagree, the adapter wins on stack mechanics and `BLUEPRINT.md` wins on security.
3. When you finish, run the suite against the running app. Use `npx @your-npm-scope/blueprints verify <name> --base-url <url>`, or see `get_verification`.
4. Report each checklist ID as pass, fail or not verified. A skipped test does not count as a pass.

## Development

```sh
pnpm build
node packages/mcp-server/dist/index.js --source .   # serve the local checkout
pnpm --filter @your-npm-scope/blueprints-mcp test
```

You can inspect the server interactively with `npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js --source .`.
