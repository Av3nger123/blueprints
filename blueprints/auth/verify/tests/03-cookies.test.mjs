import { describe, test } from 'node:test';
import { Client, freshUser, sessionCookies } from './lib/client.mjs';
import { assert } from './lib/assert.mjs';
import { config } from './lib/config.mjs';

const sessionOnly = config.mode !== 'session' && 'AUTH_MODE=token: session cookie checks do not apply';

describe('session cookie attributes', () => {
  let cookies;
  async function load() {
    if (cookies) return cookies;
    const { loginRes } = await freshUser('cookie');
    cookies = sessionCookies(loginRes);
    assert.ok(cookies.length > 0, 'login must set a session cookie (set SESSION_COOKIE_NAME if it has another name)');
    return cookies;
  }

  test('AUTH-14 session cookie is HttpOnly', { skip: sessionOnly }, async () => {
    for (const c of await load()) assert.ok(c.attrs.httponly, `${c.name} is missing HttpOnly`);
  });

  test('AUTH-15 session cookie is Secure', { skip: sessionOnly }, async (t) => {
    const list = await load();
    const missing = list.filter((c) => !c.attrs.secure);
    if (missing.length && !config.https) {
      t.skip('BASE_URL is http://; run against https to verify the Secure attribute');
      return;
    }
    assert.equal(missing.length, 0, `missing Secure: ${missing.map((c) => c.name).join(', ')}`);
  });

  test('AUTH-16 session cookie has SameSite=Lax or Strict', { skip: sessionOnly }, async () => {
    for (const c of await load()) {
      const ss = String(c.attrs.samesite ?? '').toLowerCase();
      assert.ok(ss === 'lax' || ss === 'strict', `${c.name} has SameSite=${c.attrs.samesite ?? '(unset)'}`);
    }
  });

  test('AUTH-17 session cookie is host-only with Path=/ (__Host- prefix rules)', { skip: sessionOnly }, async () => {
    for (const c of await load()) {
      assert.equal(c.attrs.domain, undefined, `${c.name} sets Domain=${c.attrs.domain}; session cookies must be host-only`);
      assert.equal(c.attrs.path, '/', `${c.name} must have Path=/`);
      if (c.name.startsWith('__Host-')) assert.ok(c.attrs.secure, '__Host- cookies require Secure');
    }
  });
});

test('AUTH-18 the session identifier changes on every login (no session fixation)', { skip: sessionOnly }, async () => {
  const { client, email, password, loginRes } = await freshUser('fixation');
  const first = sessionCookies(loginRes).map((c) => `${c.name}=${c.value}`).sort().join(';');
  // Log in again while presenting the old session cookie; the server must issue a new one.
  const again = await client.login(email, password);
  assert.equal(again.status, 200);
  const second = sessionCookies(again).map((c) => `${c.name}=${c.value}`).sort().join(';');
  assert.ok(second.length > 0, 'second login must set a session cookie');
  assert.notEqual(second, first, 'session cookie value was reused across logins');

  // A pre-authentication cookie (e.g. from GET /csrf) must not survive into the authenticated session.
  const fresh = new Client();
  await fresh.ensureCsrf();
  const pre = new Map(fresh.cookies);
  const res = await fresh.login(email, password);
  assert.equal(res.status, 200);
  for (const c of sessionCookies(res)) {
    if (pre.has(c.name)) assert.notEqual(c.value, pre.get(c.name), `${c.name} was not rotated at login`);
  }
});
