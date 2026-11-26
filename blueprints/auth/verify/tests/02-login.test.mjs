import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assert, assertError, assertIndistinguishable, assertNoSecrets, assertNoStore } from './lib/assert.mjs';

test('AUTH-10 login failure is identical for an unknown email and a wrong password', async () => {
  const { email } = await freshUser('enum');
  const wrongPassword = await new Client().login(email, strongPassword());
  const unknownUser = await new Client().login(uniqueEmail('ghost'), strongPassword());
  assertError(wrongPassword, 401, 'invalid_credentials');
  assertIndistinguishable(wrongPassword, unknownUser, 'login(wrong password) vs login(unknown email)');
});

test('AUTH-07 login and /me responses return the user without secrets', async () => {
  const { client, email, password, loginRes } = await freshUser('shape');
  assertNoSecrets(loginRes, password);
  assert.equal(loginRes.json?.user?.email, email, 'login returns { user: { email } }');
  const me = await client.me();
  assert.equal(me.status, 200);
  assert.equal(me.json?.user?.email, email, '/me returns the signed-in user');
  assert.ok(Array.isArray(me.json.user.roles), '/me user has a roles array');
  assert.equal(typeof me.json.user.email_verified, 'boolean', '/me user has email_verified');
  assertNoSecrets(me, password);
});

test('AUTH-26 authentication responses are not cacheable (Cache-Control: no-store)', async () => {
  const { client, loginRes } = await freshUser('cache');
  assertNoStore(loginRes, 'POST /login');
  assertNoStore(await client.me(), 'GET /me');
});
