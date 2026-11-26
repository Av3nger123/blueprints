# Express adapter

For Express 5 on Node 20+, in TypeScript or JavaScript. It assumes an existing database layer (Prisma, Drizzle,
Knex, TypeORM or raw `pg`) and adds session storage beside it.

## Libraries

| Purpose | Package | Why |
|---|---|---|
| Password hashing | `argon2` | Maintained native binding to the reference argon2 implementation. Exposes `hash`, `verify` and `needsRehash` with explicit parameters. |
| Sessions | `express-session` | The standard Express session middleware. Provides `regenerate()` (fixation-safe login), `destroy()` and cookie handling. |
| Session store | `connect-pg-simple` (Postgres) or `connect-redis` (Redis) | Shared server-side store, so revocation works across instances. Never use the default `MemoryStore`. |
| Rate limiting | `rate-limiter-flexible` | Supports composite keys (email + IP), Redis and Postgres backends, `Retry-After` data, and the login-protection pattern D6 needs. |
| Input validation | `zod` | Explicit DTOs with `.strict()` to block mass assignment. |
| Security headers | `helmet` | HSTS and sensible defaults. Add `Cache-Control: no-store` yourself on `/auth`. |
| JWT (token mode only) | `jose` | Maintained, standards-complete, with explicit algorithm allowlists. |
| CSRF option B only | `csrf-sync` | Synchronizer-token pattern that stores the token in the session. |
| ABAC rules (optional) | `@casl/ability` | Only if per-resource policy functions get complex. Hand-written policy functions are fine to start. |

Do not use `bcrypt-nodejs`, `crypto-js`, `jsonwebtoken` with an algorithm allowlist left out, or any
cookie-session (client-side session) package for D1 A.

## Mapping

| Blueprint module | Express location |
|---|---|
| `http/auth` | `src/http/auth/routes.ts`: an `express.Router()` mounted at `app.use('/auth', authRouter)` |
| `http/middleware` | `src/http/middleware/{require-json,csrf-guard,load-session,require-auth,rate-limit,no-store}.ts` |
| `auth/service` | `src/auth/service.ts`. Plain functions or a class taking repositories, so it stays framework-free and unit-testable. |
| `auth/sessions` | `src/auth/sessions.ts`: the `express-session` config, `HashedStore` and `revokeAllForUser` |
| `authz/policy` | `src/authz/policy.ts`: `authorize(subject, action, resource?)`. Services call it, never routes alone. |
| Data model `sessions` | The store's table (`sid`, `sess`, `expire`). `sid` holds the **SHA-256 of the session ID** (see `HashedStore`), and `sess` contains `userId` and `absoluteExpiresAt`. |
| Other tables | Your existing ORM's migrations |
| `req.subject` | Declare `userId` and `absoluteExpiresAt` on `SessionData` through module augmentation, and set `req.subject` in `load-session`. |

Store only hashed session IDs. `express-session` uses the raw ID as the store key, so wrap the store:

```ts
// src/auth/sessions.ts
import session from 'express-session';
import { createHash } from 'node:crypto';

const h = (sid: string) => createHash('sha256').update(sid).digest('hex');

/** Persists sessions under sha256(sid): a leaked sessions table cannot be replayed. */
export class HashedStore extends session.Store {
  constructor(private inner: session.Store) { super(); }
  get(sid: string, cb: (err: unknown, s?: session.SessionData | null) => void) { this.inner.get(h(sid), cb); }
  set(sid: string, s: session.SessionData, cb?: (err?: unknown) => void) { this.inner.set(h(sid), s, cb); }
  destroy(sid: string, cb?: (err?: unknown) => void) { this.inner.destroy(h(sid), cb); }
  touch(sid: string, s: session.SessionData, cb?: () => void) {
    this.inner.touch ? this.inner.touch(h(sid), s, cb) : cb?.();
  }
}

// connect-pg-simple stores `sess` as JSON, so revoking every session of a user is one statement.
export const revokeAllForUser = (pool: import('pg').Pool, userId: string, exceptSid?: string) =>
  pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [userId, exceptSid ? h(exceptSid) : null]);
```

Login handler, keeping the route thin:

```ts
router.post('/login', loginLimiter.check, async (req, res) => {
  const input = LoginInput.parse(req.body);              // zod; ZodError -> 400 validation_failed
  const user = await auth.login(input, reqContext(req)); // throws InvalidCredentials | RateLimited
  await new Promise<void>((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
  req.session.userId = user.id;
  req.session.absoluteExpiresAt = Date.now() + ABSOLUTE_MS;
  res.json({ user: toUserDto(user) });
});
```

## Configuration

```ts
const prod = process.env.NODE_ENV === 'production';
app.set('trust proxy', Number(process.env.TRUSTED_PROXY_HOPS ?? 1)); // exact hop count, never `true`
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true } }));
app.use('/auth', noStore, requireJsonOnUnsafe, csrfGuard);       // csrfGuard: D5 option A
app.use(express.json({ limit: '10kb' }));
app.use(session({
  name: prod ? '__Host-session' : 'session',
  secret: process.env.SESSION_SECRETS!.split(','),  // newest first; old ones still verify during rotation
  store: new HashedStore(new PgStore({ pool, tableName: 'sessions' })),
  resave: false, saveUninitialized: false, rolling: true, unset: 'destroy',
  cookie: { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: IDLE_MS },
}));

export const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
```

`csrfGuard` for D5 option A:

```ts
const ALLOWED = new Set(process.env.ALLOWED_ORIGINS!.split(','));
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const site = req.get('sec-fetch-site');
  const origin = req.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && !ALLOWED.has(origin))) {
    return res.status(403).json({ error: { code: 'csrf_failed', message: 'Cross-site request rejected.' } });
  }
  next();
}
```

The login throttle follows the `rate-limiter-flexible` "login endpoint protection" pattern. Call `get()` on the
`email|ip` and `email` keys *before* verifying, `consume()` on failure, and `delete()` the `email|ip` key on
success. Turn `msBeforeNext` into `Retry-After` seconds.

## Gotchas

- **`express.json()` silently skips other content types**, leaving `req.body` undefined. It does not reject them.
  Add `requireJsonOnUnsafe`, which answers `415` for any unsafe request without `application/json`, or form-encoded
  CSRF gets through (AUTH-28).
- **`cookie.secure: true` behind a TLS-terminating proxy** sends no cookie at all unless `trust proxy` is set. Set
  the exact hop count. `trust proxy: true` lets clients spoof `X-Forwarded-For` and walk past the rate limiter.
- **`express-session` has no absolute timeout.** `rolling` only slides the idle window. Store
  `absoluteExpiresAt` at login and destroy the session in `load-session` once it has passed (AUTH-23).
- **`req.session.regenerate` on login is mandatory.** Assigning `userId` to the existing session is session
  fixation (AUTH-18). Use regenerate again after a role change.
- **Logout** must call `req.session.destroy()` *and* `res.clearCookie(name, sameOptions)`. `clearCookie` needs
  the same `path`, and the same `__Host-` name, or the browser keeps the cookie.
- **The default `MemoryStore`** leaks memory and is per-process, which breaks revocation across instances.
  `express-session` warns about it in production; treat that warning as an error.
- **Express 5** forwards rejected promises from async handlers to the error middleware. Write one error handler
  that maps domain errors to the contract envelope and logs everything else as `500 internal_error` with no details.
- **`argon2.verify(digest, password)`** takes the stored digest first. It throws on a malformed digest, so wrap
  the call and treat any exception as a failed verification, never a success.
- **Run argon2 for unknown emails too.** Verify against a `DUMMY_HASH` computed once at startup with the same
  parameters (AUTH-11).
