# Blueprint Specification v0.1

Status: draft · Spec version: `0.1`

A **blueprint** is expert engineering knowledge for implementing one standard capability correctly
(for example authentication and authorization), packaged so an AI coding agent can apply it to an
existing codebase and then **prove** the result with a verification suite.

A blueprint is four things:

1. **Knowledge**: decisions with defaults, non-negotiables, architecture, data model, API contract.
2. **Stack adapters**: how that knowledge maps onto a specific framework, and which proven libraries to use.
3. **A verification suite**: a checklist plus runnable tests that check the result from the outside.
4. **Provenance**: who wrote it, who reviewed it, which standards it rests on, and when it was last reviewed.

Everything is plain Markdown, YAML and runnable tests. There is no hosted backend: a registry is a Git
repository with a generated `registry.json`.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

## 1. Directory layout

```
blueprints/<name>/
├── blueprint.yaml          # REQUIRED  metadata, validated against blueprint.schema.json
├── BLUEPRINT.md            # REQUIRED  the knowledge, in the required sections (§3)
├── adapters/               # REQUIRED  one <stack>.md per entry in blueprint.yaml `stacks` (§4)
│   └── <stack>.md
├── reference/              # OPTIONAL  small illustrative snippets; never a full application
└── verify/
    ├── checklist.md        # REQUIRED  numbered checks, each marked automated or manual (§5)
    └── tests/              # REQUIRED  runnable black-box tests for the automated checks (§5)
```

- `<name>` MUST match `blueprint.yaml` `name` and the pattern `^[a-z][a-z0-9-]{1,48}[a-z0-9]$`.
- Every value in `stacks` MUST have a matching `adapters/<stack>.md`, and every adapter file MUST be listed in `stacks`.
- Generated files (for example `SKILL.md` wrappers) are written by `scripts/build-registry.ts` and MUST NOT be edited by hand.

## 2. `blueprint.yaml`

The machine-readable contract is `spec/blueprint.schema.json` (JSON Schema draft 2020-12). This table is the
human-readable summary; where they disagree, the schema wins and the disagreement is a bug.

| Field | Required | Type | Rules |
|---|---|---|---|
| `spec_version` | yes | string | Spec version the blueprint targets. `"0.1"` for this document. |
| `name` | yes | string | Unique registry id; same as the directory name. |
| `version` | yes | string | Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`). See §7. |
| `title` | yes | string | Human title, at most 80 characters. |
| `summary` | yes | string | One or two sentences, at most 280 characters. Shown in search results. |
| `category` | yes | string | Lowercase kebab-case, for example `security`, `payments`, `data`. |
| `status` | yes | enum | `draft` · `community` · `verified` · `expert-reviewed`. See §8. |
| `authors` | yes | list | At least one `{ name, github?, url? }`. |
| `reviewers` | yes | list | May be empty. Each `{ name, github?, url?, role, reviewed_version, date }`. |
| `stacks` | yes | list | At least one adapter id, lowercase kebab-case (`express`, `fastapi`, `nextjs`). |
| `depends_on` | yes | list | May be empty. Each `{ name, version }` where `version` is a range (§7). |
| `sources` | yes | list | At least one `{ title, url, kind }`, `kind` ∈ `standard`, `rfc`, `guide`, `paper`, `library-docs`. |
| `verification` | yes | object | `{ framework, command, runtime, env[] }`. See below. |
| `last_reviewed` | yes | date | ISO date (`YYYY-MM-DD`) of the last full content review. |
| `license` | no | string | SPDX id of the content license. Defaults to `CC-BY-4.0`. |
| `tags` | no | list | Free-form lowercase search keywords. |

`verification`:

| Field | Required | Rules |
|---|---|---|
| `framework` | yes | Test framework id, for example `node:test`, `pytest`. |
| `command` | yes | Shell command run **from the blueprint directory**. MUST exit `0` only when every automated check passed. |
| `runtime` | yes | Runtime the command needs, for example `node>=20`. |
| `env` | yes | List of `{ name, required, description, default? }`. `BASE_URL` is conventional for HTTP blueprints. |

Example:

```yaml
spec_version: "0.1"
name: auth
version: 0.1.0
title: Authentication & Authorization
summary: Session-based login, password storage, recovery and RBAC for first-party web apps.
category: security
status: draft
authors:
  - name: Jane Doe
    github: janedoe
reviewers: []
stacks: [express, fastapi, nextjs]
depends_on: []
sources:
  - title: OWASP Application Security Verification Standard 5.0
    url: https://owasp.org/www-project-application-security-verification-standard/
    kind: standard
verification:
  framework: node:test
  runtime: node>=20
  command: node verify/tests/run.mjs
  env:
    - name: BASE_URL
      required: true
      description: Origin of the running application under test.
last_reviewed: 2026-11-26
```

## 3. `BLUEPRINT.md`

`BLUEPRINT.md` MUST contain these level-2 headings, **in this order** and with these exact titles. Each section
MUST have content. Authors MAY add level-3 subsections and MAY add extra level-2 sections after
`## Verification`.

| # | Heading | What it MUST contain |
|---|---|---|
| 1 | `## Overview` | What capability this is, what it delivers, and the scope boundary (what is out of scope). |
| 2 | `## When to use` | Situations it fits, situations it does not, and what to use instead. |
| 3 | `## Decisions & tradeoffs` | Each real design choice as a `###` subsection with options, tradeoffs and **one marked default**: a paragraph starting `**Default:`. An agent MUST take the default unless the codebase or the user dictates otherwise, and MUST state any deviation. |
| 4 | `## Non-negotiables` | Numbered rules that hold no matter which option was chosen. Phrased as MUST / MUST NOT. Each SHOULD cite a source. |
| 5 | `## Architecture` | Modules or layers, their responsibilities, and a folder layout. Stack-neutral: adapters map it to conventions. |
| 6 | `## Data model` | Entities, fields, types, constraints and indexes, stack-neutral. |
| 7 | `## API contract` | Every endpoint or function surface: method, path, request shape, response shape, status codes and error codes. The verification tests are written against this contract. |
| 8 | `## Integration into an existing codebase` | Step-by-step procedure for an agent working in a brownfield repo: what to inspect first, how to reuse existing pieces, migration concerns, and what to ask the human. |
| 9 | `## Common mistakes` | Concrete anti-patterns and the fix for each. |
| 10 | `## Verification` | How to run the suite, what it covers, and the manual checks that remain. |

The file MUST start with a level-1 heading equal to `title` in `blueprint.yaml`.

## 4. Adapter files: `adapters/<stack>.md`

An adapter maps the stack-neutral blueprint onto one framework. It MUST NOT restate the knowledge; it MUST
NOT contradict a non-negotiable. It MUST start with a level-1 heading and contain these level-2 sections in order:

| Heading | What it MUST contain |
|---|---|
| `## Libraries` | A table of recommended libraries: purpose, package name, why it was chosen. Proven, maintained libraries over hand-rolled code, and never hand-rolled cryptography. |
| `## Mapping` | How each architecture module, the data model and the API contract map to the stack's conventions: file paths, middleware, dependency injection, ORM models. |
| `## Configuration` | Concrete settings (cookie options, hashing parameters, limits) expressed in the stack's idioms. |
| `## Gotchas` | Stack-specific pitfalls that break a non-negotiable if missed. |

Snippets in adapters and in `reference/` MUST be short and illustrative (roughly 40 lines or fewer each). They
are not a full application and MUST NOT be presented as one.

## 5. Verification

### 5.1 `verify/checklist.md`

- A numbered list of concrete, checkable statements. Each check has a stable id of the form `<PREFIX>-<NN>`
  (for example `AUTH-07`) that never changes meaning once published; retired ids are not reused.
- Each check MUST be tagged `[automated]` or `[manual]`. Automated checks MUST name the test that covers them.
- Each check SHOULD cite the standard requirement it maps to.

### 5.2 `verify/tests/`

- Tests are **black-box**: they exercise the running application through its public interface (for HTTP
  blueprints, a `BASE_URL`) and MUST NOT import application code. This keeps one suite valid for every stack.
- Tests MUST be runnable with `verification.command` and the variables in `verification.env` alone.
- Tests MUST print the checklist id at the start of each test name (for example `AUTH-07 session cookie is HttpOnly`).
- When the environment sets `BLUEPRINT_TEST_REPORTER=tap`, `verification.command` MUST write TAP (version 13 or
  14, nested subtests allowed) to stdout. It MUST exit non-zero if any test failed. `blueprints verify` uses this to
  map results onto checklist ids. Any test framework that can emit TAP works.
- A test whose preconditions are not configured (for example an optional admin account) MUST be reported as
  **skipped** with the reason, never as passed.
- Tests MUST be safe to run against a dedicated test or staging instance and MUST NOT be run against production.

## 6. How agents consume a blueprint

An agent applying a blueprint MUST follow this procedure:

1. **Read in order**: `blueprint.yaml` → `BLUEPRINT.md` (all of it) → the adapter for the project's stack →
   `verify/checklist.md`. If no adapter matches the stack, use `BLUEPRINT.md` alone and say so.
2. **Survey the codebase** using `## Integration into an existing codebase` before writing code. Reuse what
   exists when it meets the non-negotiables; replace it when it does not, and say why.
3. **Take the defaults** in `## Decisions & tradeoffs` unless the codebase or the human dictates otherwise. Record
   each deviation and its reason.
4. **Never violate a non-negotiable.** If a requirement from the human conflicts with one, stop and ask.
5. **Run verification at the end**: execute `verification.command` (or `blueprints verify <name> --base-url <url>`)
   against a running instance, then walk the manual checks in `checklist.md`.
6. **Report**: the decisions taken and deviations, files changed, the verification result per check id
   (passed / failed / skipped with reason), and the manual checks the human still has to confirm.
   An agent MUST NOT claim the capability is complete while an automated check fails.

## 7. Versioning

Blueprints use Semantic Versioning, applied to the **contract an agent relies on**:

| Bump | When |
|---|---|
| MAJOR | Breaking change to the API contract, data model or a non-negotiable; a changed default; a check id whose meaning changes. |
| MINOR | New decision options, new checks, new adapters, new sections; anything additive. |
| PATCH | Wording, typo, link or citation fixes that change no behavior. |

`depends_on[].version` accepts an exact version (`1.2.3`), a caret range, a tilde range, or `*`, with npm
semantics: `^1.2.0` means `>=1.2.0 <2.0.0`, `^0.2.0` means `>=0.2.0 <0.3.0`, and `~1.2.0` means `>=1.2.0 <1.3.0`.
Prereleases match only a range whose base is a prerelease of the same version. Dependency cycles are invalid.

## 8. Trust tiers

`status` tells a consumer how much scrutiny a blueprint has had. Tiers are cumulative: each one includes the
requirements of the tiers below it.

| Tier | Requirements | Who sets it |
|---|---|---|
| `draft` | Passes `blueprints validate`. Content may be incomplete. Agents SHOULD warn the human before applying it. | Author |
| `community` | Every required section and adapter is complete; the verification suite runs; at least one maintainer review of this MAJOR.MINOR. | Maintainer |
| `verified` | The verification suite has passed against a working implementation in **every** listed stack, and the evidence (commands, commit, results file) is linked from the pull request. | Maintainer |
| `expert-reviewed` | At least one reviewer listed in `reviewers` with a stated domain `role` has reviewed this MAJOR.MINOR (`reviewed_version`) and the review is linked from the pull request. | Maintainer, after the review |

Rules:

- A MAJOR or MINOR bump drops `verified` and `expert-reviewed` back to `community` until the evidence or review is
  redone for the new version. A PATCH bump keeps the tier.
- `blueprints validate` enforces the machine-checkable parts: `expert-reviewed` requires a reviewer whose
  `reviewed_version` has the same MAJOR.MINOR as `version`; `community` and above require at least one automated check.
- Tiers describe review effort, not a warranty. Blueprint content is provided under CC-BY-4.0 without warranty.

## 9. Registry

A registry is a Git repository (or any static host) that serves `registry.json` and the blueprint directories
at stable relative paths. `registry.json` is generated, never hand-edited:

```json
{
  "spec_version": "0.1",
  "blueprints": [
    {
      "name": "auth",
      "version": "0.1.0",
      "title": "Authentication & Authorization",
      "summary": "…",
      "category": "security",
      "stacks": ["express", "fastapi", "nextjs"],
      "status": "draft",
      "path": "blueprints/auth",
      "files": ["blueprint.yaml", "BLUEPRINT.md", "adapters/express.md", "…"]
    }
  ]
}
```

`files` lists every file of the blueprint relative to `path`, so clients can fetch a blueprint over plain HTTP
without a directory listing.
