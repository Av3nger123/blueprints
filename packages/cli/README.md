# @your-npm-scope/blueprints

The `blueprints` CLI installs expert implementation [blueprints](https://github.com/Av3nger123/blueprints) into your project so that your AI coding agent builds the feature right. It then verifies the result against your running app.

```sh
npx @your-npm-scope/blueprints add auth --stack express   # or fastapi, nextjs; omit to auto-detect
# ...ask your agent to implement auth, start the app, then:
npx @your-npm-scope/blueprints verify auth --base-url http://localhost:3000
```

The `add` command:

- copies `BLUEPRINT.md`, the adapter for your stack, and the verification suite into `.blueprints/<name>/`
- adds or updates a marked block in `AGENTS.md` and `CLAUDE.md` that points the agent at them

Running it again updates the block in place and never duplicates it. Content outside the block is never touched.

## Commands

| Command | What it does |
|---|---|
| `list` | List the blueprints in the registry |
| `search <query> [--stack s]` | Search names, tags, titles and summaries |
| `info <name>` | Show versions, stacks, sources, reviewers and the install command |
| `add <name> [--stack s] [--dir .blueprints] [--no-instructions]` | Install a blueprint and its dependencies |
| `verify <name> --base-url <url> [--env K=V ...] [--verbose]` | Run the suite and report per checklist ID. Exits 1 if any check fails. |
| `validate [path]` | Check blueprints against the spec |

Global options:

- `--source <url-or-path>`: a fork, a pinned ref (`https://raw.githubusercontent.com/Av3nger123/blueprints/<tag>`), or a local checkout
- `--json`: machine-readable output

`verify` prefers the copy installed in `.blueprints/`. It fetches the suite only if that copy is missing. Skipped checks are reported as skipped, never as passed.

Requires Node 20.19+. MIT licensed. The blueprint content it downloads is CC BY 4.0.
