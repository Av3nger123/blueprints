# FastAPI adapter

For FastAPI on Python 3.10+ with Pydantic v2. It assumes SQLAlchemy 2.x (sync or async), but any ORM works; the
session store is an ordinary table from the [Data model](../BLUEPRINT.md#data-model).

## Libraries

| Purpose | Package | Why |
|---|---|---|
| Password hashing | `argon2-cffi` | Maintained binding to the reference implementation. `PasswordHasher` takes explicit parameters and has `check_needs_rehash`. (`pwdlib[argon2]`, which FastAPI's docs now use, wraps it and is also fine.) |
| Sessions | none: a small module over `secrets` and `hashlib` | Starlette's `SessionMiddleware` is a **signed client-side cookie** that cannot be revoked, so it fails D1 A. Server-side sessions need only `secrets.token_urlsafe(32)`, a SHA-256, and a table. |
| Rate limiting | `limits` (Redis storage) | Moving-window limits with composite keys (`"login", email, ip`), `test()` before acting, and `get_window_stats()` for `Retry-After`. `slowapi` builds on it for simple per-route IP limits. |
| Validation | `pydantic` v2 and `email-validator` (`EmailStr`) | DTOs with `extra="forbid"` block mass assignment. |
| JWT (token mode only) | `PyJWT` | Explicit `algorithms=[...]`, `audience` and `issuer` on decode. |
| ABAC rules (optional) | `casbin` | Only if policy functions outgrow plain Python. |

Do not use `passlib` (unmaintained, and it breaks with current `bcrypt` releases), `python-jose` (stale), or
`itsdangerous` or `SessionMiddleware` as the session store.

## Mapping

| Blueprint module | FastAPI location |
|---|---|
| `http/auth` | `app/http/auth.py`: `APIRouter(prefix="/auth")`. Handlers stay thin and call `AuthService`. |
| `http/middleware` | `app/http/middleware.py`: pure ASGI or `@app.middleware("http")` for `no-store`, JSON-only and the CSRF guard. `Depends` functions handle `current_subject` and `require_auth`. |
| `auth/service` | `app/auth/service.py`: framework-free and unit-testable |
| `auth/sessions` | `app/auth/sessions.py`: `create`, `validate`, `rotate`, `revoke`, `revoke_all_for_user` over the `sessions` table |
| `authz/policy` | `app/authz/policy.py`: `authorize(subject, action, resource=None)` raises `Forbidden`. A `require_permission("x:y")` dependency is the route-level layer **in addition to** service calls. |
| Error envelope | Exception handlers for your domain errors, `HTTPException` and `RequestValidationError`, all returning `{"error": {...}}` |

```python
# app/auth/sessions.py
import hashlib, secrets
from datetime import datetime, timedelta, timezone

IDLE, ABSOLUTE = timedelta(hours=1), timedelta(hours=24)

def _h(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()

def create(db, user_id, ip: str | None, ua: str | None) -> str:
    raw = secrets.token_urlsafe(32)  # 256 bits from the OS CSPRNG
    now = datetime.now(timezone.utc)
    db.add(Session(id_hash=_h(raw), user_id=user_id, created_at=now, last_seen_at=now,
                   idle_expires_at=now + IDLE, absolute_expires_at=now + ABSOLUTE, ip=ip, user_agent=ua))
    return raw  # only the cookie ever holds the raw value

def validate(db, raw: str | None):
    if not raw:
        return None
    s = db.get(Session, _h(raw))  # lookup by hash: timing reveals nothing about the raw ID
    now = datetime.now(timezone.utc)
    if s is None or now >= s.idle_expires_at or now >= s.absolute_expires_at:
        return None
    if now - s.last_seen_at > timedelta(minutes=1):  # slide idle window, at most once a minute
        s.last_seen_at, s.idle_expires_at = now, min(now + IDLE, s.absolute_expires_at)
    return s
```

## Configuration

```python
from argon2 import PasswordHasher
ph = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)  # argon2id by default; raise if hardware allows

PROD = settings.env == "production"
COOKIE = dict(key="__Host-session" if PROD else "session", httponly=True, secure=PROD,
              samesite="lax", path="/")           # never pass domain=
# response.set_cookie(value=raw, max_age=int(IDLE.total_seconds()), **COOKIE)
# logout: response.delete_cookie(**COOKIE)        # same name, path and flags, or the browser keeps it
```

Request guard (D5 option A, and the JSON-only rule):

```python
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

@app.middleware("http")
async def auth_guard(request: Request, call_next):
    if request.method in UNSAFE:
        site, origin = request.headers.get("sec-fetch-site"), request.headers.get("origin")
        if (site and site not in ("same-origin", "none")) or (origin and origin not in settings.allowed_origins):
            return error(403, "csrf_failed", "Cross-site request rejected.")
        if not request.headers.get("content-type", "").startswith("application/json"):
            return error(415, "unsupported_media_type", "Expected application/json.")
    response = await call_next(request)
    if request.url.path.startswith("/auth"):
        response.headers["Cache-Control"] = "no-store"
    return response
```

Run Uvicorn behind your proxy with `--proxy-headers --forwarded-allow-ips=<proxy IPs>`, never `*` on a host
reachable directly, so `request.client.host` is the trusted client IP.

## Gotchas

- **FastAPI answers validation errors with `422`** and its own body shape. Register a `RequestValidationError`
  handler that returns `400 validation_failed` in the contract envelope. Do not echo the submitted values back:
  the default handler includes the input, which can contain the password.
- **Hashing blocks the event loop.** `ph.hash` and `ph.verify` are CPU-bound (tens to hundreds of ms). Declare
  those endpoints with `def` (FastAPI runs them in a threadpool), or wrap the call in
  `await run_in_threadpool(...)` inside `async def`. Otherwise one login stalls every request.
- **`ph.verify` raises** `VerifyMismatchError` on a wrong password and `InvalidHashError` on a corrupt hash.
  Catch `argon2.exceptions.VerificationError` and `InvalidHashError` and treat both as a failure. On success,
  call `ph.check_needs_rehash(hash)`.
- **Unknown emails** must still run `ph.verify(DUMMY_HASH, password)`, with `DUMMY_HASH` computed at startup
  (AUTH-11).
- **`model_config = ConfigDict(extra="forbid")`** on request models makes `{"roles": ["admin"]}` a `400`, which is
  what AUTH-13 accepts. Never build ORM objects with `User(**payload.model_dump())` from a model that has privileged fields.
- **Sync SQLAlchemy sessions in `async def` routes** block the loop too. Pick one style per app.
- **Return `UserOut`, not the ORM object.** Set `response_model=UserOut`, or `password_hash` leaks through
  automatic serialisation (AUTH-07).
- **`limits` storage** must be Redis (or Memcached) in production. The in-memory storage is per-worker, and
  Gunicorn or Uvicorn workers multiply the limit.
