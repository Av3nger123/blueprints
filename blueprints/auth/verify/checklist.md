# auth verification checklist

Each check has a stable ID. Tags:

- `[automated]` checks are covered by the named test in `verify/tests/`. They pass only when that test passes;
  a skipped test does not count as a pass.
- `[manual]` checks need a human or agent to inspect code, configuration, logs or email, and record evidence.

Requirement IDs refer to OWASP ASVS 5.0.0 unless another source is named.

Report every check as **pass**, **fail**, **skipped** (with reason) or **n/a** (with reason). For example:
token-mode checks are n/a in session mode.

## Passwords and credential storage

1. **AUTH-01** `[automated]` Passwords below the minimum length are rejected with `400 validation_failed`.
   Test: `01-registration` · ASVS 6.2.1 · NIST 800-63B-4 §3.1.1.2
2. **AUTH-02** `[automated]` Passwords of 64 characters are accepted and work for login.
   Test: `01-registration` · ASVS 6.2.9
3. **AUTH-03** `[automated]` Long passwords are verified in full. Over-long input is rejected, never truncated.
   Test: `01-registration` · ASVS 6.2.8
4. **AUTH-04** `[manual]` No composition rules and no forced rotation. Any Unicode and spaces are allowed and
   normalised to NFC. The password field allows paste and offers a show-password toggle.
   Evidence: validator code and the form markup. · ASVS 6.2.5, 6.2.6, 6.2.7, 6.2.10
5. **AUTH-05** `[manual]` New passwords (at register, change and reset) are checked against a common-password
   blocklist (at least 3,000 entries), context words, and a breached-password source.
   Evidence: policy code; try a password from the blocklist. · ASVS 6.2.4, 6.2.11, 6.2.12
6. **AUTH-06** `[manual]` Hashes use argon2id at or above `m=19456 KiB, t=2, p=1` (or scrypt, bcrypt cost ≥ 12, or
   PBKDF2 per D3) through a maintained library. Outdated hashes are upgraded at login (`needsRehash`).
   Evidence: hashing module config; a stored hash's PHC prefix. · ASVS 11.4.2, Appendix C
7. **AUTH-07** `[automated]` No response contains a plaintext password, a password hash, or secret-named fields.
   Test: `01-registration`, `02-login` · ASVS 16.5.1
8. **AUTH-08** `[manual]` Logs never contain passwords, session IDs, tokens or reset links. Check the logs after a
   full suite run. · ASVS 16.2.5

## Registration and account enumeration

9. **AUTH-09** `[automated]` Registering an existing email returns exactly what registering a new one returns, and
   does not change the existing account's password.
   Test: `01-registration` · ASVS 6.3.8
10. **AUTH-10** `[automated]` Login with an unknown email is indistinguishable from login with a wrong password
    (`401 invalid_credentials`, same body).
    Test: `02-login` · ASVS 6.3.8
11. **AUTH-11** `[manual]` Login with an unknown email still runs a password-hash verification against a dummy
    hash, so response times match. Evidence: code path, plus optionally the median of about 50 timed requests
    each way. · ASVS 6.3.8
12. **AUTH-12** `[automated]` Emails are unique and log in case-insensitively.
    Test: `01-registration` · BLUEPRINT D9
13. **AUTH-13** `[automated]` Registration ignores or rejects privileged fields (`roles`, `is_admin`,
    `email_verified`). A self-registered user has only the base role and is unverified.
    Test: `06-authorization` · ASVS 8.2.3

## Sessions and cookies

14. **AUTH-14** `[automated]` The session cookie is `HttpOnly`.
    Test: `03-cookies` · ASVS 3.3.4
15. **AUTH-15** `[automated]` The session cookie is `Secure`. Skipped over `http://`; it must pass once against HTTPS.
    Test: `03-cookies` · ASVS 3.3.1
16. **AUTH-16** `[automated]` The session cookie is `SameSite=Lax` or `Strict`.
    Test: `03-cookies` · ASVS 3.3.2
17. **AUTH-17** `[automated]` The session cookie is host-only (no `Domain`) with `Path=/`. Production uses the
    `__Host-` prefix. Test: `03-cookies` · ASVS 3.3.1, 3.3.3
18. **AUTH-18** `[automated]` A new session identifier is issued at every login, and pre-login cookies are not
    promoted to authenticated sessions.
    Test: `03-cookies` · ASVS 7.2.4
19. **AUTH-19** `[manual]` Session IDs, refresh tokens, and reset and verification tokens come from a CSPRNG with
    at least 128 bits of entropy and are stored only as SHA-256 hashes.
    Evidence: token generation code and the schema. · ASVS 7.2.3, 11.5.1
20. **AUTH-20** `[automated]` Logout returns `204`, expires the cookie, and invalidates the session on the
    server: a replayed copy of the cookie (or, in token mode, the access and refresh tokens) gets `401`.
    Test: `04-sessions` · ASVS 7.4.1
21. **AUTH-21** `[automated]` Password change requires the current password, revokes the user's other sessions
    or token families, and retires the old password.
    Test: `04-sessions` · ASVS 6.2.3, 7.4.3
22. **AUTH-22** `[automated]` Refresh rotates the credential, and the previous one stops working.
    Test: `04-sessions` · ASVS 7.2.4, 10.4.5
23. **AUTH-23** `[manual]` Idle and absolute session timeouts are enforced on the server from stored timestamps,
    match the documented D2 profile, and the absolute lifetime never slides.
    Evidence: session validation code and config. · ASVS 7.1.1, 7.3.1, 7.3.2
24. **AUTH-24** `[automated]` (token mode) Replaying an already-rotated refresh token is rejected and revokes the
    whole token family, including the legitimate client's newer token.
    Test: `08-tokens` · RFC 9700 §4.14 · ASVS 10.4.5
25. **AUTH-25** `[automated]` (token mode) Access tokens with a modified signature, or `alg: none`, are rejected.
    Test: `08-tokens` · ASVS 9.1.1, 9.1.2
26. **AUTH-26** `[automated]` Login and `/me` responses send `Cache-Control: no-store`.
    Test: `02-login` · OWASP Session Management Cheat Sheet

## Cross-site request forgery

27. **AUTH-27** `[automated]` Cross-site state-changing requests (foreign `Origin`, `Sec-Fetch-Site: cross-site`,
    no CSRF token) are rejected with `403`, including login, and leave the session intact.
    Test: `05-csrf` · ASVS 3.5.1, 3.5.3
28. **AUTH-28** `[automated]` Auth endpoints reject `text/plain` and form-encoded bodies, even when they contain a
    valid payload. Test: `05-csrf` · ASVS 3.5.2

## Brute force and rate limiting

29. **AUTH-29** `[automated]` Repeated failed logins for one account get `429 rate_limited` with `Retry-After`
    within `RATE_LIMIT_MAX_ATTEMPTS`.
    Test: `99-rate-limit` · ASVS 6.1.1, 6.3.1
30. **AUTH-30** `[automated]` Unknown emails are throttled exactly like existing ones.
    Test: `99-rate-limit` · ASVS 6.3.8
31. **AUTH-31** `[automated]` While throttled, even the correct password is refused.
    Test: `99-rate-limit` · ASVS 6.3.1
32. **AUTH-32** `[manual]` There is no permanent lockout: throttles expire, password reset stays available while
    throttled, and limits use a shared store keyed on the trusted client IP. Per-IP and per-email-global limits
    exist, and an attack on one account raises an audit event or alert.
    Evidence: limiter config and proxy settings. · ASVS 6.1.1, 2.4.1

## Recovery and email verification

33. **AUTH-33** `[automated]` Forgot-password and resend-verification responses are identical for known and
    unknown emails. Test: `07-recovery` · ASVS 6.3.8
34. **AUTH-34** `[automated]` Forged reset and verification tokens get `400 invalid_token`.
    Test: `07-recovery` · ASVS 6.4.1
35. **AUTH-35** `[manual]` Reset and verification tokens are single-use, hashed at rest, and expire (reset 30
    minutes, verification 24 hours). Issuing a new token invalidates older ones. A completed reset revokes all
    sessions and sends a notification, and reset does not bypass MFA.
    Evidence: run the flow with a test mailbox; reuse a link and expect `400`. · ASVS 6.4.1, 6.4.3, 6.3.7
36. **AUTH-36** `[manual]` Emailed links are built from the configured application URL, not the request `Host`
    header. The landing page submits the token by POST and sets `Referrer-Policy: no-referrer`.
    Evidence: send forgot-password with a spoofed `Host` header and inspect the email. · OWASP Forgot Password Cheat Sheet

## Authorization and audit

37. **AUTH-37** `[automated]` Requests without valid credentials get `401 unauthenticated` in the contract's error
    envelope, and `/me` describes only the caller.
    Test: `06-authorization` · ASVS 7.2.1, 8.3.1
38. **AUTH-38** `[automated]` A signed-in user without the required permission gets `403 forbidden` on
    `PROTECTED_PATH`, and a user holding it gets `200`.
    Test: `06-authorization` · ASVS 8.2.1
39. **AUTH-39** `[manual]` Authorization denies by default and is enforced inside service methods with
    permission checks (not role-name checks), including object-level ownership. Every route is either in an
    explicit public allowlist or requires auth, and a test enforces this.
    Evidence: policy module, service code, route-inventory test. · ASVS 8.1.1, 8.2.1, 8.2.2, 8.3.1
40. **AUTH-40** `[manual]` Audit events are emitted for login success, failure and throttle, logout, refresh-token
    reuse, password change and reset, email verification, role grants and revocations, and authorization denials.
    They include who, when, where and outcome, and contain no secrets.
    Evidence: run the suite and inspect the audit sink. · ASVS 16.2.1, 16.3.1, 16.3.2, 16.3.3

---

Totals: 40 checks, 28 automated and 12 manual. Checks 24 and 25 apply only in token mode; checks 14–18 and 27
apply only in session mode.
