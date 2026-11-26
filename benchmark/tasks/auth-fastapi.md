# Task: auth-fastapi

Add email-and-password authentication and role-based authorization to a small existing FastAPI app.

| | |
|---|---|
| Stack | FastAPI, Python 3.12+, SQLAlchemy 2 + Alembic, Postgres 16 (via `docker compose`) |
| Blueprint | `auth` (record the version and registry commit) |
| Adapter | `fastapi` |
| Time budget | 45 minutes of agent wall-clock time |
| Session mode | `session` (the suite runs with `AUTH_MODE=session`) |

## Starter app (`benchmark/starters/auth-fastapi/`, to be added)

The starter must have the following before any run:

- A FastAPI app with one resource, `notes`: `GET/POST /notes`, `GET/PATCH/DELETE /notes/{id}`. It has no auth. Notes are stored in Postgres through SQLAlchemy 2 (sync engine) with Alembic migrations.
- An admin-only stub route, `GET /admin/ping`, that returns `{"ok":true}`. It is currently unprotected. The task requires protecting it.
- `docker-compose.yml` with Postgres, an `.env.example`, `uv run fastapi dev` on port 8000 (dependencies managed with `uv`), and `uv run alembic upgrade head`.
- Exception handlers that already return `{"error":{"code","message"}}`, including for validation errors. Invalid input returns 400 rather than FastAPI's default 422, to match the contract.
- An email transport interface with a development implementation that writes messages to `GET /__dev/outbox` (JSON). This route exists only when `ENV != "production"`.
- `docs/auth-api.md`: a copy of the "API contract" section of `blueprints/auth/BLUEPRINT.md` at the pinned version. Both arms get it.
- A README that explains how to run the app. It must not mention any security practice.

The starter must not include any auth library, session or JWT library, or password hashing dependency. Choosing them is part of the task.

## Prompt (give verbatim, in one message)

> Add user accounts to this app. Users sign up and log in with email and password, can log out, change their password, and reset a forgotten password via an emailed link (use the existing email transport). Notes must belong to the user who created them; users can only see and change their own notes. Add an `admin` role: only admins can call `GET /admin/ping`. Seed one admin from the `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables on startup. Implement the HTTP API exactly as described in `docs/auth-api.md`. Keep the existing notes API working for logged-in users. When you are done, the app must start with `docker compose up -d && uv run alembic upgrade head && uv run fastapi dev`.

**Fixed reply** if the agent asks a question: "Use your best judgment and note the decision."

## Run and score

```sh
docker compose up -d && uv run alembic upgrade head
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='bench-admin-password-123' uv run fastapi dev &

npx @your-npm-scope/blueprints verify auth --base-url http://localhost:8000 --json \
  --env AUTH_MODE=session \
  --env PROTECTED_PATH=/admin/ping \
  --env ADMIN_EMAIL=admin@example.com \
  --env ADMIN_PASSWORD='bench-admin-password-123' \
  > results/raw/<run-id>.json
```

If the agent changed the auth prefix or the session cookie name, set `AUTH_PREFIX` or `SESSION_COOKIE_NAME` to match. Record this as a deviation, not as a failure.

Then score the `[manual]` checks blind (see `../README.md`, Procedure step 6). Also save the output of `uvx pip-audit` as supplementary data. It is not a checklist item.

## Done criteria for a run

A run is **complete** if the agent stopped on its own within the time budget and the app starts with the given command. A run that is still working at the time budget is recorded as `timeout` and scored as-is.
