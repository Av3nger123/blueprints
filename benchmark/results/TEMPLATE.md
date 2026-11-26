# Results: <task(s)>, <agent> <agent version>, <YYYY-MM-DD>

> Copy this file to `results/<YYYY-MM-DD>-<agent>.md`. Fill in every field from the raw data committed next to it.
> Leave a cell as `n/a` rather than estimating it. Do not publish a summary without its raw data.

## Setup

| | |
|---|---|
| Agent | <name> <exact version> |
| Model | <model ID> |
| Blueprint | `auth` v<x.y.z> at registry commit `<sha>` |
| Tasks | <auth-express, auth-fastapi> (starter commit `<sha>`) |
| Arms | baseline, blueprint (files), <blueprint (MCP)> |
| Repetitions per cell | <n ≥ 5> |
| Run dates | <from> – <to> |
| Runner OS / hardware | <...> |
| Reviewer(s) for manual checks | <name(s)>, blind to arm: <yes/no> |
| Deviations from `benchmark/README.md` | <none, or list> |

## Summary

Values are the median (min–max) across repetitions.

| Task | Arm | Runs | Build ok | Automated pass rate | Manual pass rate | Runs with a critical failure | Interventions | Wall clock |
|---|---|---|---|---|---|---|---|---|
| auth-express | baseline | | | | | | | |
| auth-express | blueprint | | | | | | | |
| auth-fastapi | baseline | | | | | | | |
| auth-fastapi | blueprint | | | | | | | |

## Per-check pass rate

Each cell is the share of runs that passed the check: passed ÷ runs where the check applies.

| Check | Description | express baseline | express blueprint | fastapi baseline | fastapi blueprint |
|---|---|---|---|---|---|
| AUTH-01 | | | | | |
| … | | | | | |
| AUTH-40 | | | | | |

## Failures worth reading

List the runs whose diffs best show a typical failure in each arm, with links to the diff and transcript. Describe what happened; do not speculate about why.

## Raw data

- `runs.csv`: one row per run, using the `runs.template.csv` columns
- `raw/<run-id>.json`: `blueprints verify --json` output
- `diffs/<run-id>.patch`, `transcripts/<run-id>.*`
- `manual/<run-id>.md`: the reviewer's per-check verdicts and justifications

## Threats to validity specific to this run set

<Anything beyond the standing list in `benchmark/README.md`, e.g. an agent update mid-run.>
