# Contributing

Thanks for helping. This project is only useful if its blueprints are right, so the bar for content is high and the process is explicit. Please read the [spec](spec/blueprint-spec.md) before opening a pull request that adds or changes a blueprint.

## Ways to contribute

| Contribution | Where to start |
|---|---|
| Fix an error in a blueprint: a wrong default, an outdated library, a broken citation | Open a pull request with a source for the correction. |
| Add an adapter for a new stack (Django, Rails, Spring, NestJS…) | [Adding an adapter](#adding-an-adapter) |
| Add or sharpen a check, or make a test catch more | [Verification suites](#verification-suites) |
| Write a new blueprint | Open an issue first with the scope and the main decisions, then see [Writing a blueprint](#writing-a-blueprint). |
| Review a blueprint as a domain expert | [Expert review](#expert-review) |
| Run the benchmark | [`benchmark/README.md`](benchmark/README.md). Follow the procedure exactly and publish every run. |
| Improve the CLI, MCP server or core | [Tooling](#tooling) |

## Ground rules

1. **Cite sources.** Every non-negotiable and every non-obvious default should point to a primary source, such as OWASP ASVS, a NIST SP, an RFC, or the framework's or library's own documentation. "Everyone does it" is not a source.
2. **Never hand-roll cryptography.** Adapters and snippets use well-known, maintained libraries for hashing, tokens, sessions and signing. A pull request that implements a primitive by hand will be declined.
3. **Snippets stay small.** Code in adapters and `reference/` is illustrative, about 40 lines or fewer per snippet, never a full application.
4. **No invented claims.** Do not add benchmark numbers, adoption figures, endorsements or reviewer names that cannot be backed up. Results go in `benchmark/results/` with their raw data, or nowhere.
5. **Respect the tiers.** Only maintainers change `status` above `draft`, and only with the evidence the spec requires.
6. **Report vulnerabilities privately.** If a blueprint's guidance would lead to a vulnerability, use GitHub's private vulnerability reporting on this repository rather than a public issue.

## Setup

Requires Node 20.19+ and pnpm 10.

```sh
pnpm i && pnpm build && pnpm test
```

Before you push, run the same checks as CI:

```sh
pnpm lint && pnpm typecheck && pnpm validate && pnpm registry:check && pnpm test
```

## Writing a blueprint

1. Create `blueprints/<name>/` with the layout from spec §1: `blueprint.yaml`, `BLUEPRINT.md`, `adapters/<stack>.md`, and `verify/checklist.md` plus `verify/tests/`. Copying `blueprints/auth` and replacing its content is the quickest start.
2. Fill in `blueprint.yaml`. Use `status: draft`, `version: 0.1.0`, yourself in `authors`, an empty `reviewers`, and every source you rely on.
3. Write `BLUEPRINT.md` with the ten required sections in order. In **Decisions & tradeoffs**, each `###` decision lists its options and tradeoffs and ends with exactly one paragraph that starts with `**Default:`. **Non-negotiables** are numbered MUST / MUST NOT rules that hold whatever the decisions are.
4. Write the **API contract** precisely: methods, paths, request and response shapes, status codes and error codes. The tests are written against it, and agents implement it.
5. Write the checklist and the tests (see below).
6. Run `pnpm validate`. Fix every error, and read every warning.
7. Run `pnpm registry` to regenerate `registry.json` and `blueprints/<name>/SKILL.md`. Commit both. Never edit generated files by hand.

What makes a blueprint good, beyond passing the validator:

- **Decisions are real choices** with an honest tradeoff, not a strawman next to the right answer.
- **Defaults fit the common case.** That is someone adding the capability to an ordinary web app, not a bank or a demo.
- **The integration section is written for a brownfield repository.** It says what to inspect first, what to reuse, what to migrate, and when to stop and ask the human.
- **Common mistakes are mistakes agents actually make**, each with its fix.

## Adding an adapter

1. Add the stack to `stacks` in `blueprint.yaml`, and create `adapters/<stack>.md` with the sections `## Libraries`, `## Mapping`, `## Configuration` and `## Gotchas`, in that order.
2. **Libraries** is a table: purpose, package, and why this package. Prefer libraries that are maintained, widely used and well documented. Pin a minimum version where it matters for security.
3. **Mapping** shows where each architecture module, table and endpoint lives in the stack's conventions.
4. **Gotchas** lists the stack-specific ways to break a non-negotiable. This is usually the most valuable section.
5. An adapter must not restate or contradict `BLUEPRINT.md`. If the stack cannot meet a non-negotiable, raise it in an issue. Do not weaken the rule in the adapter.
6. Bump the blueprint's MINOR version, then run `pnpm validate` and `pnpm registry`.

## Verification suites

The suite is what turns a blueprint from advice into something an agent can be held to. See spec §5 for the requirements:

- Each check in `verify/checklist.md` has a permanent ID (`PREFIX-NN`) and is marked `[automated]` or `[manual]`. Automated checks name their test. Manual checks say what evidence to look at.
- Tests are **black-box**. They exercise the running app through the contract (`BASE_URL`) and never import app code, so one suite serves every stack.
- Each test name starts with its check ID, for example `AUTH-07 no response contains…`, so `blueprints verify` can report per check.
- If a precondition is not configured, the test **skips with a reason**. It never passes.
- Under `BLUEPRINT_TEST_REPORTER=tap`, the command writes TAP to stdout and exits non-zero on failure. The `auth` suite uses only `node:test` and `fetch`, with no dependencies, and that is the recommended approach.

**Prove that each automated check can fail.** A test that never fails proves nothing. The `auth` suite is exercised against [`packages/cli/src/test-fixtures/insecure-auth-server.mjs`](packages/cli/src/test-fixtures/insecure-auth-server.mjs). This in-memory server implements the contract, and its `BREAK=` flags switch on one defect at a time. Each defect must make its check fail, and a correct server must pass everything that applies.

```sh
PORT=4600 node packages/cli/src/test-fixtures/insecure-auth-server.mjs &                 # correct
PORT=4601 BREAK=logout,fixation node packages/cli/src/test-fixtures/insecure-auth-server.mjs &
node packages/cli/dist/index.js verify auth --base-url http://127.0.0.1:4601 --source .   # expect AUTH-18, AUTH-20 to fail
```

When you add an automated check, add a matching `BREAK` flag to the fixture, or a fixture of your own for a new blueprint. Also extend the end-to-end tests in `packages/cli/src/cli.test.ts` if the check matters to the overall pass/fail result.

Changing what an existing check ID means is a MAJOR change. Retire the old ID instead, and never reuse it.

## Versioning

Follow spec §7. In short:

- **PATCH**: wording or citation fixes that change no behavior.
- **MINOR**: additive changes, such as new options, checks, adapters or sections.
- **MAJOR**: a breaking change to the contract, the data model, a non-negotiable, a default, or the meaning of a check.

A MAJOR or MINOR bump drops `verified` and `expert-reviewed` back to `community` until the evidence is redone.

## Expert review

An `expert-reviewed` blueprint has been read end to end by someone with real domain experience, such as an application security engineer for `auth`. To review:

1. Read `BLUEPRINT.md`, every adapter and the checklist at a specific version.
2. File your findings as an issue, or as review comments on a pull request.
3. Once the findings are resolved, open a pull request that adds you to `reviewers` with your `role`, the `reviewed_version`, and the `date`. Link the review from the pull request.

A review covers one MAJOR.MINOR. Listing yourself as a reviewer means you checked the content, not that you endorse any product. Maintainers will not list a reviewer who has not done this.

## Tooling

- `packages/core`: loading, validation, the registry, and dependency resolution. Most logic and most unit tests live here.
- `packages/cli`: the `blueprints` command. Its end-to-end tests run `add` and `verify` against temporary projects and the fixture server.
- `packages/mcp-server`: the stdio MCP server. Its tests connect a real MCP client in memory and over stdio.
- `scripts/build-registry.ts`: generates `registry.json` and the `SKILL.md` files.

Dependencies are kept to a minimum on purpose. Runtime dependencies are limited to the MCP SDK, a YAML parser, a JSON Schema validator and zod. If you need another one, open an issue first.

## Pull request checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm validate && pnpm registry:check && pnpm test` passes
- [ ] Generated files (`registry.json`, `SKILL.md`) were regenerated with `pnpm registry` and committed
- [ ] The version was bumped according to spec §7, and `last_reviewed` was updated for content changes
- [ ] New claims cite sources, and new automated checks have a way to fail (a `BREAK` flag or a fixture)
- [ ] No hand-rolled cryptography; snippets stay short

## License of contributions

By contributing, you agree that your code contributions are licensed under [MIT](LICENSE) and your blueprint content under [CC BY 4.0](LICENSE-CONTENT), matching the files you change.
