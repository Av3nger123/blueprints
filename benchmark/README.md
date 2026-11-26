# Benchmark

This benchmark asks one question: **does giving a coding agent a blueprint change the security and correctness of what it builds?**

**Status: no runs yet.** This directory holds the method, the task specs and the results template. It does not hold results yet. Published numbers will appear under `results/` together with the raw data that supports them.

## Design

Each run gives a coding agent a small existing app and one feature request. Two arms differ only in what is in the repository:

| Arm | Repository contents | Prompt |
|---|---|---|
| **baseline** | Starter app plus `docs/auth-api.md`, the HTTP contract | The task prompt, verbatim |
| **blueprint** | The same, after `blueprints add auth --stack <stack>`, which adds `.blueprints/auth/` and the managed blocks in `AGENTS.md` and `CLAUDE.md` | The same task prompt, verbatim |

An MCP variant of the blueprint arm uses an empty repository diff and the `blueprints-mcp` server instead. Report it as its own arm, never merged with the file-based arm.

Both arms get the HTTP contract, meaning the endpoint paths, the request and response shapes, and the error envelope. Without it, the verification suite would mostly measure whether the agent guessed the same URLs, which is not what we care about. The contract does carry some of the blueprint's knowledge, such as enumeration-safe responses. That makes the comparison conservative: it understates the blueprint's effect, which is the right direction to err.

## Tasks

| Task | Stack | Spec |
|---|---|---|
| `auth-express` | Express 5, Node 20+, Postgres | [tasks/auth-express.md](tasks/auth-express.md) |
| `auth-fastapi` | FastAPI, Python 3.12+, Postgres | [tasks/auth-fastapi.md](tasks/auth-fastapi.md) |

Starter apps will live in `benchmark/starters/<task>/`. They are not in the repository yet, and they must be committed before the first run so that every run starts from the same tree.

## Procedure

For every agent × task × arm cell:

1. **Fresh tree.** Copy the starter into a new directory and `git init` it. For the blueprint arm, run `blueprints add auth --stack <stack>` at the pinned registry commit.
2. **Pin everything.** Record the agent name and version, the model ID, the blueprint version and registry commit, and the OS. One setting changes per comparison, never several.
3. **Run the agent** with the task prompt, verbatim, in a new session with no memory or rules beyond what is in the repository. Use the agent's default settings, with approval set to automatic. Apply the time budget in the task spec. Do not intervene. If the agent stops and asks a question, answer only with the fixed reply in the task spec and count the event as an intervention.
4. **Start the app** using the task's run instructions. If it does not start, record `build_failed` and score every automated check as fail.
5. **Score automated checks:** `blueprints verify auth --base-url <url> --json`, with the task's env settings. Save the JSON as the run's raw result.
6. **Score manual checks.** A reviewer who does not know which arm produced the diff scores each `[manual]` item in `verify/checklist.md` as pass, fail or n/a, and writes a one-line justification. Strip the agent's own notes and `.blueprints/` from the diff before review so the arm stays hidden.
7. **Record** the run in `results/runs.csv` (see the template), plus the transcript and the final diff.

Run at least **5 repetitions per cell**. Agents are not deterministic, and one run per cell shows almost nothing.

## Metrics

| Metric | Definition |
|---|---|
| Automated pass rate | Passed ÷ (automated checks that apply to the run's mode). A skip counts as **not passed** unless the check does not apply, for example a token-only check in session mode. |
| Per-check pass rate | For each `AUTH-NN`, the share of runs that passed, per arm. This is the most useful view because it shows which mistakes the blueprint prevents. |
| Manual pass rate | Passed ÷ (manual checks scored pass or fail). |
| Critical failures | Runs that fail any of: password storage below the floor (AUTH-06), secrets in responses (AUTH-07), login enumeration (AUTH-10), session fixation (AUTH-18), or an unprotected admin route (AUTH-37/38). |
| Build success | The share of runs where the app starts and serves the contract. |
| Effort | Wall-clock time, interventions, and tokens or cost where the agent reports them. |

Report the median and the range per cell. Report differences only with the number of runs behind them. Do not report a difference that comes from fewer than 5 runs per arm.

## Threats to validity (read before quoting any result)

- **Teaching to the test.** The same people wrote the blueprint and the suite. A blueprint arm that passes more checks could just mean the blueprint lists the checks. The manual checks, the blind review and the per-check breakdown reduce this risk but do not remove it. An independently written suite would be stronger.
- **Contract leakage.** See the Design section above. It biases the comparison against the blueprint.
- **Starter realism.** Small starters are easier than real codebases. The integration guidance in the blueprint matters more in larger repositories, and this benchmark does not measure that.
- **Agent and model drift.** Results are valid only for the pinned versions. Re-run when versions change, and never compare across versions in one table.
- **Suite coverage.** Passing every automated check is not "secure". The suite tests black-box behavior on the contract. It cannot see code paths the contract does not expose.

## Rules for publishing results

- Publish every run, including crashes, timeouts and build failures. Never drop runs.
- Publish the raw `verify --json` output, the diffs and the transcripts next to the summary.
- State the agent versions, the model IDs, the blueprint version, the registry commit and the run dates.
- No numbers in the main README until a results file with its raw data is committed.

## Layout

```
benchmark/
  README.md            this file
  tasks/               one spec per task: starter, prompt, contract, run and score instructions
  starters/            starter apps (not yet added)
  results/
    TEMPLATE.md        copy to results/<date>-<agent>.md for a published run set
    runs.template.csv  column layout for raw per-run records
```
