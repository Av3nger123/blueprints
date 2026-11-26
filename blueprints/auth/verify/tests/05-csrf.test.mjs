import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assert, assertError } from './lib/assert.mjs';
import { config, p } from './lib/config.mjs';

const sessionOnly = config.mode !== 'session' && 'AUTH_MODE=token: bearer tokens are not sent automatically, so CSRF does not apply';

test('AUTH-27 a cross-site state-changing request is rejected and the session survives', { skip: sessionOnly }, async () => {
  const { client } = await freshUser('csrf');
  // Simulate a forged request from another site: the browser attaches the cookie, but the attacker
  // cannot set our Origin, cannot read a CSRF token, and Sec-Fetch-Site says cross-site.
  const forged = await client.request('POST', p('/logout'), {
    csrf: false,
    origin: 'https://attacker.example',
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assertError(forged, 403);
  assert.equal((await client.me()).status, 200, 'the forged logout must not have ended the session');
});

test('AUTH-27 login is protected against cross-site requests (login CSRF)', { skip: sessionOnly }, async () => {
  const { email, password } = await freshUser('logincsrf');
  const forged = await new Client().request('POST', p('/login'), {
    body: { email, password },
    csrf: false,
    origin: 'https://attacker.example',
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assertError(forged, 403);
});

test('AUTH-28 auth endpoints reject bodies that are not application/json', async () => {
  // text/plain and form posts are "simple" requests a third-party page can send without a preflight.
  // Each body below is a *valid* registration in its own encoding, so only a content-type check stops it.
  const c = new Client();
  const bodies = {
    'text/plain': () => JSON.stringify({ email: uniqueEmail('ctype'), password: strongPassword() }),
    'application/x-www-form-urlencoded': () =>
      new URLSearchParams({ email: uniqueEmail('ctype'), password: strongPassword() }).toString(),
  };
  for (const [type, make] of Object.entries(bodies)) {
    const res = await c.request('POST', p('/register'), { rawBody: make(), headers: { 'content-type': type } });
    assert.ok([400, 403, 415].includes(res.status), `POST /register with ${type} returned ${res.status}; expected 400, 403 or 415`);
  }
});
