# Next.js adapter

For Next.js 15 and 16 with the App Router, on the **Node.js runtime**. Argon2 and most database drivers do not run
on the Edge runtime. It assumes an ORM such as Prisma or Drizzle for the [Data model](../BLUEPRINT.md#data-model).

## Libraries

| Purpose | Package | Why |
|---|---|---|
| Password hashing | `argon2` (or `@node-rs/argon2`, which ships prebuilt binaries) | Reference argon2id with explicit parameters. `argon2` needs `serverExternalPackages` if your Next version does not already list it. |
| Sessions | none: a small module over `crypto.randomBytes`, `crypto.createHash` and `cookies()` | Matches the server-side session pattern in the Next.js authentication guide. Keeps sessions revocable (D1 A). |
| Rate limiting | `rate-limiter-flexible` with Redis, or `@upstash/ratelimit` on serverless | A shared store is mandatory: serverless instances share no memory. |
| Validation | `zod` | DTOs with `.strict()`. Server Actions receive untrusted input exactly like route handlers. |
| JWT (token mode only) | `jose` | Explicit algorithm allowlists. |
| Full framework (if already present) | `better-auth` | Supports database sessions. If the codebase already uses it, keep it: set argon2id hashing, check enumeration behaviour, and expose the contract through thin handlers. |

**Auth.js (NextAuth) note.** Its Credentials provider works only with the JWT session strategy, which conflicts
with D1 A (no server-side revocation). If the codebase uses Auth.js with Credentials, report the conflict and ask
the human. The options are to move password login to the session module below, or to accept token-mode rules
and add a revocation check.

## Mapping

| Blueprint module | Next.js location |
|---|---|
| `http/auth` | Route Handlers: `app/auth/login/route.ts`, `app/auth/logout/route.ts`, `app/auth/me/route.ts` and so on, each exporting `POST` or `GET`. If `/auth` is taken, use `app/api/auth/...` and set `AUTH_PREFIX=/api/auth`. |
| `http/middleware` | A `withAuthRoute()` wrapper around each handler for the JSON-only check, CSRF guard, `no-store` and error envelope. `proxy.ts` (`middleware.ts` before Next 16) does **optimistic** redirects only. |
| `auth/service`, `auth/*` | `lib/auth/*.ts`, importing `'server-only'` so it can never be bundled for the client |
| Data Access Layer | `lib/dal.ts`: `verifySession()` wrapped in React `cache()`, called by every Server Component, Server Action and Route Handler that needs the user |
| `authz/policy` | `lib/authz/policy.ts`: `authorize()` is called inside DAL and service functions, never only in layouts or `proxy.ts` |
| Data model | Prisma schema or Drizzle tables |

```ts
// lib/auth/session.ts
import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';

const NAME = process.env.NODE_ENV === 'production' ? '__Host-session' : 'session';
const IDLE_MS = 60 * 60 * 1000, ABSOLUTE_MS = 24 * 60 * 60 * 1000;
const h = (raw: string) => createHash('sha256').update(raw).digest('hex');

export async function createSession(userId: string) {
  const raw = randomBytes(32).toString('base64url');       // 256-bit CSPRNG token
  const now = Date.now();
  await db.session.create({ data: { idHash: h(raw), userId, idleExpiresAt: new Date(now + IDLE_MS),
    absoluteExpiresAt: new Date(now + ABSOLUTE_MS), lastSeenAt: new Date(now) } });
  (await cookies()).set(NAME, raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: IDLE_MS / 1000 });
}

export async function destroySession() {
  const jar = await cookies();
  const raw = jar.get(NAME)?.value;
  if (raw) await db.session.deleteMany({ where: { idHash: h(raw) } });
  jar.delete(NAME);
}
```

```ts
// lib/dal.ts
import 'server-only';
import { cache } from 'react';
export const verifySession = cache(async () => {
  const raw = (await cookies()).get(NAME)?.value;
  const s = raw ? await validateSession(raw) : null;  // checks idle + absolute expiry, slides idle window
  return s ? { userId: s.userId, permissions: await loadPermissions(s.userId) } : null;
});
```

## Configuration

- `next.config.ts`: `serverExternalPackages: ['argon2']` if needed. `experimental.serverActions.allowedOrigins`
  only for origins you really serve from (it widens the built-in Server Action origin check).
- Hashing: `argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })`.
- Route Handlers under `/auth` declare `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`,
  and every response sets `Cache-Control: no-store`.
- Security headers (HSTS) go in `next.config.ts` `headers()` or at the edge proxy.
- `ALLOWED_ORIGINS` and `APP_URL` come from the environment. Build email links from `APP_URL`, never from
  `headers().get('host')`.

## Gotchas

- **`proxy.ts` / `middleware.ts` is not an authorization layer.** CVE-2025-29927 let attackers skip Next.js
  middleware entirely with a crafted header. Use it for optimistic redirects, and check sessions and permissions
  in the DAL and in every Server Action and Route Handler.
- **Server Actions are public POST endpoints.** Anyone can call them with any arguments, whether or not your UI
  renders the form. Each action must call `verifySession()` and `authorize()` itself and validate its input with zod.
- **Server Actions get an Origin-versus-Host CSRF check from Next.js; Route Handlers do not.** Wrap every
  cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` Route Handler in the D5 guard (`Sec-Fetch-Site` and `Origin`
  allowlist) and reject non-JSON bodies with `415` (AUTH-27, AUTH-28).
- **Layouts do not re-render on client navigation**, so an auth check placed only in `layout.tsx` can be skipped
  for nested pages. Check in the page or the data access, not the layout.
- **`cookies()` is async in Next 15+**, and cookies can be set only in Server Actions and Route Handlers, not
  while rendering Server Components. Sliding the idle window therefore happens in the DB row (`validateSession`),
  with the cookie re-issued at the next action or handler.
- **Caching can leak one user's data to another.** Mark auth-dependent routes dynamic, never put
  user-specific data behind `'use cache'` or `unstable_cache` keyed without the user, and send `no-store` on `/auth`.
- **Never pass the full user record to Client Components.** Props are serialised into the HTML. Pass a DTO
  (`id`, `email`, `roles`), or `password_hash` ships to the browser (AUTH-07). The `server-only` import catches
  accidental client imports of `lib/auth`.
- **Serverless cold starts plus argon2.** Keep the parameters at or above the floor anyway. If latency hurts,
  give the auth routes more memory rather than lowering `memoryCost`.
- **Client IP on serverless platforms** comes from a platform-specific header. Use the one your host documents
  as trustworthy, never the first entry of a client-supplied `X-Forwarded-For`.
