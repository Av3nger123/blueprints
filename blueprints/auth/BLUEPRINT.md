# Authentication & Authorization

> Blueprint `auth` v0.1.0 · status **draft** · spec v0.1 · last reviewed 2026-11-26
> Requirement IDs such as `ASVS 7.2.4` refer to OWASP ASVS 5.0.0. Full citations are in [References](#references).

## Overview

This blueprint adds email-and-password authentication and role-based authorization to a first-party web
application, or brings an existing implementation up to standard. It delivers:

- **Account lifecycle**: registration, email verification, login, logout, session refresh, password change,
  and password reset.
- **Credential storage**: argon2id password hashing with explicit parameters, a password policy and a breached-password check.
- **Sessions**: opaque server-side sessions in hardened cookies, with idle and absolute timeouts and
  revocation on logout and credential change. Token mode (short-lived access tokens with rotating refresh
  tokens) is the documented alternative for non-browser clients.
- **Abuse resistance**: CSRF protection, rate limiting, account-enumeration-safe responses, and constant-time secret handling.
- **Authorization**: deny-by-default RBAC behind a single policy layer, enforced in the service layer, with
  extension points for attribute-based (ABAC) and relationship-based (ReBAC) rules.
- **Audit hooks**: a structured event for every security-relevant action.

**Out of scope**, each a candidate for its own blueprint: federated login (OIDC and SAML, "Sign in with…"),
multi-factor authentication and passkeys, organisations and multi-tenancy, machine-to-machine API keys, and
admin user-management UIs. The [Architecture](#architecture) leaves a seam for each. Where this blueprint touches
MFA, it is to keep the seam open, for example "do not let password reset bypass MFA".

## When to use

**Use it when:**

- You run a first-party web app (server-rendered, or a SPA served from the same site as its API) and want to own
  user credentials.
- An existing codebase has home-grown auth that needs an audit and hardening. Apply the blueprint as a gap
  analysis: keep what meets the non-negotiables and replace what does not.
- You need a clear, testable authorization model and today's checks live only in route handlers or the UI.

**Do not use it when:**

| Situation | Use instead |
|---|---|
| Users sign in only through an enterprise IdP (Okta, Entra ID, Google Workspace) | An OIDC relying-party integration. Do not store passwords at all. |
| You would rather not hold credentials or run account recovery | A managed identity provider. Still apply the [Authorization](#d8-authorization-model) and session sections. |
| Pure machine-to-machine API with no human users | API keys or the OAuth client-credentials grant. |
| A mobile-only or third-party-client API | This blueprint in **token mode** ([D1](#d1-session-mechanism)). |

If the codebase already uses an auth framework (Auth.js, Better Auth, Passport, Devise, Django auth, FastAPI
Users and so on), keep it. Use this blueprint to configure it correctly and to close the gaps; the verification
suite works the same either way.

## Decisions & tradeoffs

Take each **Default** unless the codebase or the human dictates otherwise, and record every deviation in your
final report.

### D1. Session mechanism

| Option | Strengths | Weaknesses |
|---|---|---|
| **A. Opaque server-side session in a cookie** | Instant revocation on logout, password change, admin kill or account disable. The token is a random reference that carries no data. With HttpOnly, JavaScript never sees it. Simple to reason about. | One lookup per request (an indexed primary-key read, or a Redis GET). Needs a shared store when there are several app instances. |
| B. JWT access token plus rotating refresh token | No lookup to verify the access token. Works for native apps, third-party clients and service-to-service. | Revocation needs a denylist or cutoff, which makes it stateful anyway (ASVS 7.4.1). It also brings algorithm and key-confusion pitfalls (ASVS 9.1.2) and larger requests, and browser storage tempts teams into `localStorage`, where XSS can read it. |
| C. Stateless encrypted or signed cookie (the whole session in the cookie) | No store at all. | Cannot be revoked before it expires. Fails ASVS 7.4.1 unless you add a server-side cutoff, at which point it is option A. |

**Default: A.** For a first-party browser app the client and server share a site, so cookies are the platform's
native credential. The deciding factor is revocation: ASVS 7.4.1 requires that logout and expiry fully disable
the session, and 7.4.2 requires killing all sessions when an account is disabled. Option A satisfies both with a
row delete, while B needs extra machinery to reach the same place. The per-request lookup costs well under a
millisecond on an indexed table or Redis, which is negligible next to a typical request.

**Choose B (token mode) when** clients are native mobile apps, third-party integrations, or several services that
must verify credentials without calling home. In token mode:

- **Access token**: JWT, lifetime 10 minutes (range 5–15). Signed with an asymmetric algorithm (EdDSA or ES256)
  from an explicit allowlist; `exp`, `iss` and `aud` are validated on every request (ASVS 9.1.1, 9.1.2, 9.2.1, 9.2.3).
  It carries a `sid` (token family) claim so logout can disable it: check a per-family revocation set, or keep
  only a short lifetime plus a denylist of `jti` values until `exp`.
- **Refresh token**: opaque, at least 256 bits of randomness, stored only as a hash. It rotates on every use, and
  reuse of an already-rotated token revokes the whole family (RFC 9700 §4.14; ASVS 10.4.5). The family has an
  absolute expiry of 30 days that sliding refresh cannot extend (ASVS 10.4.8).
- **Browser clients in token mode** keep tokens on the server through a backend-for-frontend (BFF) and hold only
  a session cookie (ASVS 10.1.1). Never put tokens in `localStorage` or `sessionStorage`.

### D2. Session lifetime

ASVS 7.1.1, 7.3.1 and 7.3.2 require documented idle and absolute timeouts chosen by risk.

| Profile | Idle timeout | Absolute lifetime | Use for |
|---|---|---|---|
| **Standard** | 1 hour | 24 hours | Most business apps |
| Sensitive | 15 minutes | 12 hours | Finance, health, admin consoles |
| Remember-me (opt-in checkbox) | 7 days | 30 days | Low-risk consumer apps. Pair it with re-authentication for sensitive actions (ASVS 7.5.1). |

**Default: Standard.** The idle window slides on activity, but at most once a minute to limit writes. The
absolute lifetime never slides. Expiry is enforced on the server by stored timestamps; the cookie's `Max-Age`
is only a convenience.

### D3. Password hashing

| Option | Parameters | Notes |
|---|---|---|
| **argon2id** | Floor: `m=19456 KiB (19 MiB), t=2, p=1`. Equivalent floors: `m=47104, t=1, p=1` or `m=12288, t=3, p=1`. | OWASP's first choice; ASVS Appendix C floor. If hardware allows, move toward RFC 9106's second recommendation, `m=65536 (64 MiB), t=3, p=4`. |
| scrypt | `N=2^17, r=8, p=1` | Acceptable when argon2 is unavailable. |
| bcrypt | cost **≥ 12** (ASVS minimum 10) | Legacy fallback only. Inputs over **72 bytes** must be rejected with `validation_failed`; do not pre-hash, because pre-hashing invites null-byte and password-shucking problems (OWASP). |
| PBKDF2-HMAC-SHA-256 | ≥ 600,000 iterations | Only when FIPS-140 validation is required. |

**Default: argon2id at `m=19456, t=2, p=1` as the minimum**, raised as far as login latency allows (aim for
under 500 ms on production hardware). Use a 16-byte random salt (the library does this) and the encoded
PHC-string format, so parameters travel with the hash. On every successful login, call `needsRehash` and
transparently upgrade hashes created with older parameters or algorithms.

**Option: pepper.** An HMAC key kept outside the database (KMS or secret manager), applied before hashing, so a
stolen database alone cannot be cracked offline. It adds key-rotation work, so it is not the default; consider
it for high-value systems.

### D4. Password policy

| Rule | Default | Source |
|---|---|---|
| Minimum length | **15** characters when the password is the only factor. **8** only if MFA is enforced for every account. | NIST SP 800-63B-4 §3.1.1.2; ASVS 6.2.1 (8 minimum, 15 strongly recommended) |
| Maximum length | Accept at least 64 and cap at **128** characters (or 72 bytes with bcrypt), so hashing cost stays bounded | ASVS 6.2.9 |
| Composition rules | **None.** Any Unicode, including spaces. Normalise to NFC before hashing. | ASVS 6.2.5; NIST 800-63B-4 |
| Blocklist | Reject the 10,000 most common passwords (ASVS asks for at least 3,000), plus context words such as the app name and the user's email | ASVS 6.2.4, 6.2.11 |
| Breached passwords | Check the Have I Been Pwned range API (k-anonymity: only a 5-hex-character SHA-1 prefix leaves your server). Time out after 2 s and fail open, but log it. | ASVS 6.2.12 |
| Rotation | Never forced. Change only on suspected compromise. | ASVS 6.2.10 |
| Paste and password managers | Allowed. Offer a show-password toggle. | ASVS 6.2.6, 6.2.7 |

Apply the policy at registration, password change and password reset.

### D5. CSRF strategy

| Option | How | Notes |
|---|---|---|
| **A. Cross-origin request rejection** | On every unsafe method (POST, PUT, PATCH, DELETE), reject when `Sec-Fetch-Site` is present and not `same-origin` (or `none`), or when `Origin` is present and not in the allowlist. Accept only `application/json` request bodies. Cookies are `SameSite=Lax`. | Stateless, no client changes, and covers login CSRF. Modern browsers send `Sec-Fetch-Site` and `Origin`, and requiring JSON forces a CORS preflight for cross-origin calls (ASVS 3.5.2). |
| B. Synchronizer token, plus A | `GET /auth/csrf` returns a per-session token (bound to the pre-auth session before login). Clients echo it in `X-CSRF-Token` on unsafe methods and the server compares in constant time. | **Required** if any cookie-authenticated endpoint accepts HTML form posts or other "simple" content types, or must serve old browsers that omit both headers. |

**Default: A.** Never change state on GET or HEAD (ASVS 3.5.3). If the app has server-rendered HTML forms, use B.
Never rely on `SameSite` alone: it is defence in depth, and `Lax` still allows top-level cross-site GET requests.

### D6. Brute-force protection

**Default: progressive throttling, not hard lockout.** A hard lockout ("locked after 5 attempts until an
admin unlocks it") lets anyone deny service to any user whose email they know; ASVS 6.1.1 requires documenting
how you prevent that. Count failures only, in a shared store such as Redis or a database table, never in
process memory once there is more than one instance:

| Key | Limit | Response |
|---|---|---|
| (normalised email, client IP) | 5 failures in 15 minutes | `429 rate_limited` with `Retry-After`. Backoff doubles per further failure, capped at 1 hour. |
| normalised email, across all IPs | 50 failures in 1 hour | `429`, emit a `credential_attack_suspected` audit event, and alert. Password reset stays available. |
| client IP, across all emails | 100 failures in 1 hour | `429`. This is the credential-stuffing signal. |
| `register`, `password/forgot`, `email/resend` per IP | 20 per hour | `429` |
| `password/forgot`, `email/resend` per target email | 3 per hour | Same `202` response but no email sent, so there is no enumeration and no inbox flooding |

The limiter keys on the **submitted** email whether or not the account exists, so unknown emails are throttled
identically (ASVS 6.3.8). A throttled account rejects even the correct password until the window passes.
"Client IP" means the address taken from your trusted proxy configuration, never a raw `X-Forwarded-For` value a
client can forge.

Extension point: after the per-email threshold, instead of `429` you can require a challenge (CAPTCHA,
proof-of-work, or a "trusted device" cookie set at a previous successful login) so attacks on one account cannot
lock its owner out.

### D7. Email verification

| Option | Behaviour |
|---|---|
| **A. Soft gate** | Unverified users can sign in, but get only the base `user` role. Actions marked `requires_verified_email` are refused with `403 email_not_verified`; mark at least email change, inviting users, any role grant, and linking external identities. Unverified accounts are deleted after 7 days. |
| B. Hard gate | Login returns `403 email_not_verified` until the user verifies. |

**Default: A**, because it gives the better onboarding flow. It is safe because registration never reveals
whether an address exists, re-registering cannot change an existing account's password, and password reset
revokes every session. That last point defeats account pre-hijacking, where an attacker registers the victim's
email before the victim does. Choose B when an unverified account would be able to do something harmful.

### D8. Authorization model

| Model | Use when |
|---|---|
| **RBAC**: users have roles, roles grant permissions named `resource:action` | Default. Covers most apps. |
| ABAC: rules over subject, resource and context attributes ("owner may edit", "only during business hours") | Add per resource type as policy functions. |
| ReBAC: permissions derived from relationships ("editor of the folder that contains this doc") | Sharing graphs. Use a Zanzibar-style engine (OpenFGA, SpiceDB) behind the same `authorize()` interface. |

**Default: RBAC behind one policy function**, `authorize(subject, action, resource?)`, that every service method
calls. Code checks **permissions**, never role names (`can(user, 'invoice:approve')`, not
`user.role === 'admin'`), so roles can be reshaped without touching code. Resource-level rules (ownership,
tenant) live in per-resource policy functions that the same `authorize()` dispatches to. That is the ABAC
extension point, and the ReBAC engine plugs in at the same seam. Unknown actions, and any resource type without
a policy, are **denied**.

### D9. Account identifier

**Default: email is the login identifier**, unique case-insensitively. Store it as entered for display and
compare it trimmed and lowercased. Use a `citext` column or a unique index on `lower(email)`. Do not apply
provider-specific rules (Gmail dots, `+tags`) to uniqueness. Users are referenced internally by an opaque
`id` (UUIDv7 or bigint), never by email, so changing an email is a single-column update.

## Non-negotiables

These hold whichever options you chose. If a requirement from the human conflicts with one, stop and ask.

1. Passwords **MUST** be hashed with argon2id, scrypt, bcrypt or PBKDF2 at or above the [D3](#d3-password-hashing)
   parameters, through a maintained library. Never encrypt them, store them in plaintext, use a fast hash
   (MD5, SHA-x), or hand-roll the algorithm. (ASVS 11.4.2, Appendix C)
2. Passwords **MUST** be verified exactly as received: no truncation, no case-folding, and no silent trimming.
   NFC normalisation is the only transformation allowed. (ASVS 6.2.8)
3. Session IDs, refresh tokens, and reset and verification tokens **MUST** come from the platform CSPRNG with at
   least 128 bits of entropy (use 256), and **MUST** be stored only as a SHA-256 hash. UUIDs are not tokens.
   (ASVS 7.2.3, 11.5.1)
4. Login and any privilege change **MUST** issue a new session identifier and destroy the old one.
   (ASVS 7.2.4)
5. Logout **MUST** invalidate the session on the server. Password change and password reset **MUST** revoke all
   other sessions and refresh tokens of that user. Disabling or deleting an account **MUST** revoke all of them.
   (ASVS 7.4.1, 7.4.2, 7.4.3)
6. Session cookies **MUST** be `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`, and `Path=/` without `Domain`.
   In production they **MUST** use the `__Host-` prefix unless subdomain sharing is a documented requirement.
   (ASVS 3.3.1, 3.3.2, 3.3.3, 3.3.4)
7. Every state-changing request **MUST** be CSRF-protected per [D5](#d5-csrf-strategy), and no GET or HEAD
   request may change state. (ASVS 3.5.1–3.5.3)
8. Register, login, forgot-password and resend-verification **MUST NOT** reveal whether an account exists,
   through body, status code or timing. When the email is unknown, login **MUST** still verify the password
   against a fixed dummy hash. (ASVS 6.3.8)
9. Login, registration, password reset, verification resend and password change **MUST** be rate limited per
   [D6](#d6-brute-force-protection), answering `429` with `Retry-After`. (ASVS 6.1.1, 6.3.1, 2.4.1)
10. Secret comparisons (CSRF tokens, HMACs) **MUST** be constant-time, using `crypto.timingSafeEqual` or
    `hmac.compare_digest`. Looking tokens up by their SHA-256 hash is acceptable, because timing then leaks the
    hash rather than the token. (ASVS 11.2.4)
11. Authorization **MUST** deny by default and **MUST** be enforced in the service layer on every operation,
    including object-level checks (can *this* user act on *this* record). Route guards and UI hiding are
    additional layers, never the only check. (ASVS 8.2.1, 8.2.2, 8.3.1)
12. Request bodies **MUST NOT** be able to set privileged fields (`roles`, `email_verified`, `status`, `id`).
    Map input into explicit allowlisted DTOs. (ASVS 8.2.3)
13. Responses **MUST NOT** contain password hashes, plaintext passwords, or any token other than the one being
    issued. Auth responses **MUST** send `Cache-Control: no-store`. Errors **MUST** be generic and leak no
    internals. (ASVS 16.5.1)
14. Passwords, tokens, session IDs and reset links **MUST NOT** be logged. Authentication and authorization
    events **MUST** be logged through the audit hook. (ASVS 16.2.5, 16.3.1, 16.3.2)
15. Reset and verification tokens **MUST** be single-use and short-lived (reset 30 minutes, verification 24
    hours), and **MUST** be invalidated when used or when a newer one is issued. Links **MUST** be built from the
    configured application URL, never from the request `Host` header. The user **MUST** be notified after a
    password reset or change. Reset **MUST NOT** bypass MFA once MFA exists. (ASVS 6.4.1, 6.4.3, 6.3.7)
16. Changing a password **MUST** require the current password. Changing the email **MUST** require
    re-authentication and verification of the new address. (ASVS 6.2.3, 7.5.1)
17. All traffic **MUST** use HTTPS with HSTS (`max-age` of at least one year). (ASVS 3.4.1)
18. In token mode, JWTs **MUST** be verified against an explicit algorithm allowlist (never `none`), with
    `exp`, `iss` and `aud` checked, and refresh tokens **MUST** rotate with reuse detection. (ASVS 9.1.1, 9.1.2,
    9.2.1, 9.2.3, 10.4.5)

## Architecture

Six modules with one-way dependencies. HTTP depends on services and services depend on stores, never the reverse.
Adapters map these onto each framework's conventions.

| Module | Responsibility |
|---|---|
| `http/auth` | Thin route handlers for the [API contract](#api-contract). Each one parses and validates input into a DTO, calls `AuthService`, maps domain errors to contract error codes, and sets or clears cookies. It holds no business logic. |
| `http/middleware` | `securityHeaders` (`no-store` on auth routes, HSTS). `csrfGuard` (D5). `loadSession`: cookie → session → user; enforces idle and absolute expiry, slides the idle window, attaches `req.subject` or nothing. `requireAuth` (401 when there is no subject). `rateLimit(key, policy)`. |
| `auth/service` | `AuthService`: register, login, logout, refresh, changePassword, requestPasswordReset, resetPassword, verifyEmail, resendVerification. Owns the flows, emits audit events, and calls the modules below. |
| `auth/passwords` | `hash`, `verify`, `needsRehash`, `checkPolicy` (length, blocklist, breach check). The only place the hashing library is imported. |
| `auth/sessions` | `create(userId, meta)`, `rotate(old)`, `validate(rawId)`, `revoke(id)`, `revokeAllForUser(userId, exceptId?)`. Generates tokens, hashes them, enforces timeouts. In token mode it also owns refresh-token families. |
| `auth/one-time-tokens` | `issue(userId, purpose, ttl)` and `consume(raw, purpose)` for password reset and email verification. Single-use and hashed at rest. |
| `auth/throttle` | Facade over the rate-limit store: `check(keys)`, `recordFailure(keys)`, `reset(keys)`. |
| `authz/policy` | `authorize(subject, action, resource?)` throws `Forbidden`, and `can(...)` returns a boolean. Resolves RBAC permissions, then calls the per-resource policy function. Denies by default. |
| `authz/rbac` | Loads a subject's roles and permissions once per request (cached on the request). |
| `audit` | `emit(event)` to a sink interface. The default sink is the structured application logger; a database or SIEM sink is pluggable. |
| `mail` | Interface: `sendVerification`, `sendPasswordReset`, `sendPasswordChanged`, `sendAccountExists`. Reuse the existing mailer. |

```
src/
├── http/
│   ├── auth/            routes.(ts|py)          # contract endpoints
│   └── middleware/      csrf, session, require-auth, rate-limit, security-headers
├── auth/
│   ├── service          # AuthService flows
│   ├── passwords        # hash / verify / needsRehash / policy (+ blocklist data file)
│   ├── sessions         # session + refresh-token store logic
│   ├── one-time-tokens
│   └── throttle
├── authz/
│   ├── policy           # authorize(), can(), policy registry
│   ├── rbac
│   └── policies/        # one file per resource type: invoices, projects, ...
├── audit/
└── mail/
```

**Request flow for a protected operation:** `securityHeaders` → `csrfGuard` (unsafe methods) → `loadSession` →
`requireAuth` → handler → `SomeService.doThing(subject, input)`. That service method calls
`authorize(subject, 'thing:do', record)` before touching data. The check lives in the service, so it also covers
background jobs, GraphQL resolvers, server actions and any other entry point that reaches the service.

**Seams for later blueprints.** MFA hooks into `AuthService.login` between password verification and session
creation, as a pending-second-factor state. OIDC adds a second way to reach `sessions.create`. Multi-tenancy adds
`tenantId` to the subject and to policy functions.

## Data model

Stack-neutral types. Use the closest equivalents in your database. All timestamps are UTC.

**users**

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid (v7) or bigint | primary key |
| `email` | text | not null. Unique on `lower(email)`, or use `citext`. |
| `email_verified_at` | timestamptz | null until verified |
| `password_hash` | text | not null. PHC string such as `$argon2id$v=19$m=19456,t=2,p=1$…` |
| `password_changed_at` | timestamptz | not null |
| `status` | enum `active` \| `disabled` | not null, default `active` |
| `created_at`, `updated_at` | timestamptz | not null |

**sessions** (session mode)

| Column | Type | Constraints |
|---|---|---|
| `id_hash` | char(64) | primary key: hex SHA-256 of the raw session ID |
| `user_id` | fk → users.id | not null, `on delete cascade`, indexed |
| `created_at` | timestamptz | not null |
| `last_seen_at` | timestamptz | not null |
| `idle_expires_at` | timestamptz | not null |
| `absolute_expires_at` | timestamptz | not null |
| `ip`, `user_agent` | text | nullable, for the user's "active sessions" view (ASVS 7.5.2) |

Revocation deletes the row. Purge expired rows with a periodic job.

**refresh_tokens** (token mode only)

| Column | Type | Constraints |
|---|---|---|
| `token_hash` | char(64) | primary key |
| `family_id` | uuid | not null, indexed |
| `user_id` | fk → users.id | not null, `on delete cascade`, indexed |
| `issued_at`, `expires_at` | timestamptz | not null. `expires_at` is capped at `family_expires_at`. |
| `family_expires_at` | timestamptz | not null. Set at login and copied to every rotated token, so the family's absolute lifetime never extends. |
| `used_at` | timestamptz | set on rotation. A second presentation means reuse, so revoke the family. |
| `revoked_at` | timestamptz | null |

**one_time_tokens**

| Column | Type | Constraints |
|---|---|---|
| `token_hash` | char(64) | primary key |
| `user_id` | fk → users.id | not null, `on delete cascade` |
| `purpose` | enum `password_reset` \| `email_verify` | not null |
| `expires_at` | timestamptz | not null |
| `consumed_at` | timestamptz | null |
| `created_at` | timestamptz | not null. Index on (`user_id`, `purpose`), so issuing a new token can invalidate older ones. |

**roles**, **permissions**, **role_permissions**, **user_roles**

| Table | Columns |
|---|---|
| `roles` | `id`, `name` (unique, such as `user` or `admin`), `description` |
| `permissions` | `id`, `name` (unique, `resource:action`, such as `invoice:approve`), `description` |
| `role_permissions` | `role_id`, `permission_id`. Primary key is (`role_id`, `permission_id`). |
| `user_roles` | `user_id`, `role_id`, `granted_by` (fk users, nullable), `granted_at`. Primary key is (`user_id`, `role_id`). |

Seed the roles `user` (granted at registration) and `admin`. Seed permissions from code: keep a single
`permissions` registry in source, and have a migration or startup check fail when code references a permission
the table lacks. **Never seed an admin with a default password.** Bootstrap the first admin with a one-off CLI
command or a single-use invite token.

**audit_events**, or an equivalent log stream

| Field | Notes |
|---|---|
| `id`, `occurred_at` | |
| `type` | `user.registered`, `auth.login.succeeded`, `auth.login.failed`, `auth.login.throttled`, `auth.logout`, `session.revoked`, `auth.refresh.reuse_detected`, `password.changed`, `password.reset.requested`, `password.reset.completed`, `email.verified`, `role.granted`, `role.revoked`, `authz.denied`, `credential_attack_suspected` |
| `actor_user_id`, `subject_user_id` | nullable. Failed logins for unknown emails record a keyed hash of the email, never the raw address. |
| `ip`, `user_agent`, `request_id` | |
| `outcome` | `success` \| `failure` |
| `metadata` | JSON. Never contains passwords, tokens or session IDs. |

## API contract

**Conventions**

- Base path `/auth` (configurable; the tests read `AUTH_PREFIX`). JSON in and out. Every POST **must** send
  `Content-Type: application/json`, with body `{}` when there are no fields. Anything else gets `415`.
- Field names are `snake_case`. Errors always use this envelope:
  `{ "error": { "code": "<code>", "message": "<human text>" } }`
- Every response under `/auth` sends `Cache-Control: no-store`.
- In session mode the credential is the session cookie (default name `__Host-session` in production and
  `session` in local HTTP development). In token mode it is `Authorization: Bearer <access_token>`.

**User object**, the only user representation the API returns:

```json
{ "id": "0193…", "email": "ada@example.com", "email_verified": false, "roles": ["user"], "created_at": "2026-11-26T10:00:00Z" }
```

| Method & path | Request body | Success | Errors |
|---|---|---|---|
| `GET /auth/csrf` | none | `200 { "csrf_token": "…" }`. Only with the D5 B option; otherwise `404`. | |
| `POST /auth/register` | `{ "email", "password" }` | `202 { "status": "accepted" }`, **identical whether or not the email exists**. A new address gets a verification email; an existing one gets an "account already exists" email. | `400 validation_failed` (malformed email, or a password that breaks policy) · `415` · `429 rate_limited` |
| `POST /auth/login` | `{ "email", "password" }` | `200 { "user": User }` plus `Set-Cookie`. Token mode returns `200 { "user", "access_token", "token_type": "Bearer", "expires_in", "refresh_token" }`. | `401 invalid_credentials` (same for an unknown email and a wrong password) · `403 email_not_verified` (D7 B only) · `429 rate_limited` |
| `POST /auth/logout` | `{}`. Token mode: `{ "refresh_token" }` | `204` and the cookie is expired. Server-side session (or token family) revoked. | `403 csrf_failed` |
| `POST /auth/refresh` | `{}`. Token mode: `{ "refresh_token" }` | Session mode: `200 { "user" }` with a **new** session cookie; the old ID is dead and the absolute expiry is unchanged. Token mode: `200` with a new token pair; the old refresh token is spent. | `401 unauthenticated` (session) · `401 invalid_token` (token: unknown, expired, revoked or **reused**; reuse revokes the family) |
| `GET /auth/me` | none | `200 { "user": User }` | `401 unauthenticated` |
| `POST /auth/password/change` | `{ "current_password", "new_password" }` | `204`. All **other** sessions are revoked and the current one is rotated. A "password changed" email is sent. | `400 validation_failed` · `400 invalid_credentials` (wrong current password) · `401` · `429` |
| `POST /auth/password/forgot` | `{ "email" }` | `202 { "status": "accepted" }`, identical for known and unknown emails | `400 validation_failed` (malformed email only) · `429` |
| `POST /auth/password/reset` | `{ "token", "password" }` | `204`. Token consumed; **all** sessions and refresh tokens revoked; a notification email is sent. No automatic login. | `400 invalid_token` (unknown, expired or used) · `400 validation_failed` |
| `POST /auth/email/verify` | `{ "token" }` | `204` and `email_verified_at` is set | `400 invalid_token` |
| `POST /auth/email/resend` | `{ "email" }` | `202 { "status": "accepted" }`, identical for every email (including unknown and already verified) | `429` |

**Error codes**

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `validation_failed` | Input failed schema or policy validation. `message` may name the field, but must never say whether an account exists. |
| 400 | `invalid_credentials` | Wrong current password on password change |
| 400 | `invalid_token` | Reset or verification token is unknown, expired or already used. The message is always the same. |
| 401 | `invalid_credentials` | Login failed |
| 401 | `unauthenticated` | No valid session or access token |
| 401 | `invalid_token` | Refresh token is unknown, expired, revoked or reused |
| 403 | `forbidden` | Authenticated but not allowed (an authorization decision) |
| 403 | `csrf_failed` | Cross-site request or a bad CSRF token |
| 403 | `email_not_verified` | The action requires a verified email (D7) |
| 415 | `unsupported_media_type` | The body is not `application/json` |
| 429 | `rate_limited` | Throttled. Always sent with `Retry-After`. |
| 500 | `internal_error` | Generic. Details go to logs only. |

**Status-code rule for authorization:** `401` means "we don't know who you are" and `403` means "we know, and
the answer is no". For resources whose *existence* is sensitive, a policy may answer `404 not_found` instead of
`403`, but it must do so consistently.

## Integration into an existing codebase

Work through these steps in order. Do not start writing code before step 3.

1. **Inventory what exists.** Search for password hashing (`bcrypt`, `argon2`, `scrypt`, `pbkdf2`, `md5`,
   `sha1`), session and token handling (`express-session`, `jsonwebtoken`, `jose`, `next-auth`, `better-auth`,
   `passport`, `SessionMiddleware`, `itsdangerous`), the users table and ORM model, how a request learns its user,
   where authorization checks live (`role ===`, `is_admin`, decorators, middleware), the mailer, any Redis or
   cache, and the reverse-proxy and `trust proxy` setup. List all of it in your report.
2. **Map it against the non-negotiables.** For each one, mark it met, partly met or missing, with the file and
   line. This gap list is your plan.
3. **Decide the mode** (D1) from the clients you found. Native apps or third-party consumers point to token
   mode; a browser-only app points to session mode. If both exist, use session mode for the web app and token
   mode for the other clients, behind the same `AuthService`.
4. **Reuse and extend the user model.** Add the missing columns from the [Data model](#data-model) with a
   migration. Keep existing primary keys. Add the case-insensitive unique index on email; *first* check for
   case-duplicate emails and ask the human how to merge them.
5. **Migrate password hashes without a mass reset.** Keep the existing hash format readable, verify against it
   at login, and on success rehash with argon2id (`needsRehash`). For weak legacy hashes (unsalted MD5 or SHA-1),
   wrap them now: replace each stored hash with `argon2id(legacy_hash)`, mark the scheme, and unwrap at login.
   That way the weak hashes are gone today, not after every user's next login.
6. **Cut over sessions.** Introducing server-side sessions invalidates existing ones. Ask the human whether a
   one-time forced re-login is acceptable (the usual answer is yes) or whether a bridge is needed.
7. **Expose the contract.** Mount the endpoints at the [API contract](#api-contract) paths. If clients already
   depend on other paths, keep them as thin aliases over the same handlers, and set `AUTH_PREFIX` for the tests.
8. **Introduce the policy layer.** Create the `permissions` registry, translate existing role checks into
   permissions, add `authorize()` calls inside service methods, and leave route-level guards in place as an extra
   layer. Add a test that walks the router and fails for any route that is neither in an explicit public
   allowlist nor protected by `requireAuth`.
9. **Wire throttling and audit** to the shared store and the existing logger. Confirm the app derives the
   client IP only from the trusted proxy configuration.
10. **Run the verification suite** against a locally running instance and fix failures. Then walk the manual
    checks.

**Ask the human before:** forcing a global re-login, deleting or merging accounts, choosing token mode,
picking lifetimes stricter or looser than D2, sending email from a new provider, or changing any public API path.

## Common mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Checking authorization only in middleware or route handlers | Other entry points (jobs, GraphQL, server actions, internal calls) skip it. Next.js CVE-2025-29927 let attackers skip middleware entirely. | `authorize()` inside the service method, plus route guards as an extra layer |
| `if (user.role === 'admin')` scattered through the code | Hard-codes roles and makes role changes risky | `can(user, 'invoice:approve')` against the permissions registry |
| JWT in `localStorage` for a first-party web app | Any XSS can read it, and it cannot be revoked | HttpOnly session cookie (D1 A), or a BFF in token mode |
| Logout that only deletes the cookie client-side | A copied cookie keeps working | Delete the session row on the server (non-negotiable 5) |
| "User not found" vs "wrong password" messages, or a `409` on duplicate registration | Account enumeration | One message, one status, plus a dummy hash for timing (non-negotiable 8) |
| Hard lockout after N attempts | Lets anyone lock out any user | Progressive throttling (D6) |
| Rate limiting in process memory behind a load balancer | Every instance has its own counter, so the limit multiplies | Redis or database-backed limiter |
| Trusting `X-Forwarded-For` blindly | Attackers rotate fake IPs past the limiter | Configure the trusted proxy hops; use the framework's resolved client IP |
| bcrypt with passwords longer than 72 bytes | Silent truncation: everything after byte 72 is ignored | argon2id, or reject inputs over 72 bytes |
| Comparing tokens with `==` | Timing side channel | Look up by hash, or `timingSafeEqual` / `compare_digest` |
| Storing reset or session tokens in plaintext | A database read becomes account takeover | Store the SHA-256 and compare hashes |
| Building reset links from the `Host` header | Host-header injection sends victims' tokens to the attacker | Use the configured `APP_URL` |
| `Object.assign(user, req.body)`, or ORM models bound straight to the request | Mass assignment lets a user grant themselves `admin` | Explicit DTOs with allowlisted fields |
| Keeping the old session ID after login | Session fixation | Regenerate at login and on privilege change |
| Not revoking sessions on password reset | The attacker stays logged in after the victim recovers the account | `revokeAllForUser` on reset and change |
| Returning the ORM user object directly | Leaks `password_hash` and internal fields | Serialize through the single `User` shape |
| Accepting form-encoded or `text/plain` bodies on JSON auth endpoints | Allows cross-site "simple" POSTs, which is CSRF | Require `application/json` (`415` otherwise) |
| Long-lived JWTs with no refresh rotation | Stolen tokens stay valid for days | 10-minute access tokens with rotation and reuse detection |
| Leaving unverified accounts able to do everything | Account pre-hijacking and spam | Soft gate (D7) |

## Verification

The suite in `verify/tests/` is black-box: it talks to a running instance over HTTP and runs against Express,
FastAPI, Next.js or any other stack. Run it against a **local or staging** instance, never production. It creates
accounts and deliberately trips the rate limiter.

```bash
# from blueprints/auth (or .blueprints/auth after `blueprints add auth`)
BASE_URL=http://localhost:3000 node verify/tests/run.mjs
# or
npx @your-npm-scope/blueprints verify auth --base-url http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | required | Origin of the app under test |
| `AUTH_PREFIX` | `/auth` | Where the contract endpoints are mounted |
| `AUTH_MODE` | `session` | `session` or `token` (D1) |
| `SESSION_COOKIE_NAME` | all cookies set at login | Restricts cookie checks to the session cookie |
| `CSRF_HEADER` | `X-CSRF-Token` | Header for the D5 B token (used only if `GET /auth/csrf` returns one) |
| `PROTECTED_PATH` | unset | A GET route that requires a permission the default `user` role lacks, such as `/admin/ping`. Enables the 403 checks. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | unset | An account holding that permission. Enables the "allowed" check. |
| `RATE_LIMIT_MAX_ATTEMPTS` | `10` | Failed logins within which a `429` must appear |
| `TEST_EMAIL_DOMAIN` | `example.com` | Domain for generated accounts |

The suite expects the defaults it is written against: unverified users can log in (D7 A), and the
`/auth/password/forgot` and `/auth/email/resend` per-email limit leaves room for one request per new account. A
check whose preconditions are not configured is reported as **skipped**, never passed. The `Secure` cookie check
is skipped over plain `http://`, so run once against HTTPS (for example a staging URL) before calling the work done.

`verify/checklist.md` lists all 40 checks. 28 are automated and 12 are manual. The manual ones cover hashing
parameters, breach checking, timing equalisation, token entropy and storage, timeouts, logging hygiene,
service-layer enforcement and email flows. Walk them by reading the code and configuration, and report each as
passed, failed or not applicable, with evidence.

## References

- OWASP Application Security Verification Standard 5.0.0: <https://github.com/OWASP/ASVS/tree/v5.0.0_release/5.0/en>.
  Chapters: V3 Web Frontend Security, V6 Authentication, V7 Session Management, V8 Authorization, V9
  Self-contained Tokens, V10 OAuth and OIDC, V11 Cryptography (and Appendix C), V16 Security Logging and Error Handling.
- OWASP Password Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP Session Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- OWASP Forgot Password Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- OWASP Authorization Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>
- NIST SP 800-63B-4, Digital Identity Guidelines: Authentication and Authenticator Management (2025): <https://pages.nist.gov/800-63-4/sp800-63b.html>
- RFC 9106, Argon2 Memory-Hard Function: <https://www.rfc-editor.org/rfc/rfc9106>
- RFC 9700, Best Current Practice for OAuth 2.0 Security (§2.2.2, §4.14 refresh tokens): <https://www.rfc-editor.org/rfc/rfc9700>
- RFC 6265bis, Cookies: HTTP State Management Mechanism (SameSite, cookie prefixes): <https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/>
- W3C Fetch Metadata Request Headers (`Sec-Fetch-Site`): <https://www.w3.org/TR/fetch-metadata/>
- Sudhodanan & Paverd, "Pre-hijacked accounts: An Empirical Study of Security Failures in User Account Creation on the Web" (USENIX Security 2022): <https://www.usenix.org/conference/usenixsecurity22/presentation/sudhodanan>
- Have I Been Pwned Pwned Passwords range API: <https://haveibeenpwned.com/API/v3#PwnedPasswords>
- Next.js CVE-2025-29927 advisory (middleware authorization bypass): <https://github.com/advisories/GHSA-f82v-jwr5-mffw>
