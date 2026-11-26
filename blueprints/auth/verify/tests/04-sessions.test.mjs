import { test } from 'node:test';
import { Client, freshUser, isDeletion, sessionCookies, strongPassword } from './lib/client.mjs';
import { assert, assertError } from './lib/assert.mjs';
import { config, p } from './lib/config.mjs';

test('AUTH-20 logout invalidates the session on the server, not just in the browser', async () => {
  const { client, loginRes } = await freshUser('logout');
  const stolen = client.snapshot(); // what an attacker who copied the cookie/token would hold
  const out = await client.logout();
  assert.equal(out.status, 204, `logout returned ${out.status}: ${out.text.slice(0, 200)}`);

  if (config.mode === 'session') {
    const names = new Set(sessionCookies(loginRes).map((c) => c.name));
    const cleared = out.setCookies.filter((c) => names.has(c.name) && isDeletion(c));
    assert.ok(cleared.length > 0, 'logout must expire the session cookie (Max-Age=0 or past Expires)');
    assertError(await stolen.me(), 401, 'unauthenticated');
  } else {
    assertError(await stolen.refresh(), 401);
    // ASVS 7.4.1: logout must also disable the access token (denylist, per-session cutoff, or reference token).
    assertError(await stolen.me(), 401, 'unauthenticated');
  }
  assertError(await client.me(), 401, 'unauthenticated');
});

test('AUTH-21 changing the password revokes other sessions and the old password', async () => {
  const { client, email, password } = await freshUser('pwchange');
  const other = new Client();
  assert.equal((await other.login(email, password)).status, 200, 'second device login');

  const newPassword = strongPassword();
  const res = await client.post(p('/password/change'), { current_password: password, new_password: newPassword });
  assert.equal(res.status, 204, `password change returned ${res.status}: ${res.text.slice(0, 200)}`);

  if (config.mode === 'session') {
    assertError(await other.me(), 401, 'unauthenticated');
  } else {
    assertError(await other.refresh(), 401);
  }
  assertError(await new Client().login(email, password), 401, 'invalid_credentials');
  assert.equal((await new Client().login(email, newPassword)).status, 200, 'new password works');
});

test('AUTH-21 password change requires the current password', async () => {
  const { client } = await freshUser('pwchange2');
  const res = await client.post(p('/password/change'), { current_password: strongPassword(), new_password: strongPassword() });
  assertError(res, [400, 401, 403]);
});

test('AUTH-22 refresh issues a new credential and the previous one stops working', async () => {
  const { client } = await freshUser('refresh');
  const before = client.snapshot();
  const res = await client.refresh();
  assert.equal(res.status, 200, `refresh returned ${res.status}: ${res.text.slice(0, 200)}`);

  if (config.mode === 'session') {
    assert.notEqual(client.cookieHeader(), before.cookieHeader(), 'refresh must rotate the session cookie');
    assertError(await before.me(), 401, 'unauthenticated');
  } else {
    assert.notEqual(client.refreshToken, before.refreshToken, 'refresh must rotate the refresh token');
  }
  assert.equal((await client.me()).status, 200, 'the new credential works');
});
