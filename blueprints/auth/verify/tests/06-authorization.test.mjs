import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assert, assertError } from './lib/assert.mjs';
import { config, p } from './lib/config.mjs';

test('AUTH-37 unauthenticated requests get 401 unauthenticated', async () => {
  assertError(await new Client().me(), 401, 'unauthenticated');

  const forged = new Client();
  if (config.mode === 'session') {
    forged.cookies.set(config.sessionCookieName ?? 'session', 'not-a-real-session-id');
  } else {
    forged.accessToken = 'not-a-real-token';
  }
  assertError(await forged.me(), 401, 'unauthenticated');
});

test('AUTH-37 the protected route returns 401 without credentials', { skip: !config.protectedPath && 'PROTECTED_PATH not set' }, async () => {
  assertError(await new Client().get(config.protectedPath), 401, 'unauthenticated');
});

test('AUTH-38 a signed-in user without the permission gets 403 forbidden', { skip: !config.protectedPath && 'PROTECTED_PATH not set' }, async () => {
  const { client } = await freshUser('rbac');
  assertError(await client.get(config.protectedPath), 403, 'forbidden');
});

test('AUTH-38 a user holding the permission is allowed', {
  skip: (!config.protectedPath || !config.adminEmail || !config.adminPassword) && 'PROTECTED_PATH, ADMIN_EMAIL and ADMIN_PASSWORD not all set',
}, async () => {
  const admin = new Client();
  assert.equal((await admin.login(config.adminEmail, config.adminPassword)).status, 200, 'admin login');
  const res = await admin.get(config.protectedPath);
  assert.equal(res.status, 200, `admin GET ${config.protectedPath} returned ${res.status}`);
});

test('AUTH-13 registration ignores privileged fields (no mass assignment)', async () => {
  const c = new Client();
  const email = uniqueEmail('massassign');
  const password = strongPassword();
  const reg = await c.register(email, password, {
    roles: ['admin'],
    role: 'admin',
    is_admin: true,
    email_verified: true,
    permissions: ['*'],
  });
  assert.ok([202, 400].includes(reg.status), `register returned ${reg.status}`);
  if (reg.status === 400) return; // rejecting unknown fields outright is also correct
  assert.equal((await c.login(email, password)).status, 200);
  const me = await c.me();
  assert.equal(me.status, 200);
  assert.ok(!me.json.user.roles.includes('admin'), `self-registered user received roles ${JSON.stringify(me.json.user.roles)}`);
  assert.equal(me.json.user.email_verified, false, 'self-registered user must not be pre-verified');
  if (config.protectedPath) assertError(await c.get(config.protectedPath), 403, 'forbidden');
});

test('AUTH-37 /me only ever describes the caller', async () => {
  const a = await freshUser('me-a');
  const b = await freshUser('me-b');
  assert.equal((await a.client.me()).json.user.email, a.email);
  assert.equal((await b.client.me()).json.user.email, b.email);
  const withQuery = await a.client.get(`${p('/me')}?email=${encodeURIComponent(b.email)}`);
  assert.equal(withQuery.json?.user?.email, a.email, '/me must ignore client-supplied identity parameters');
});
