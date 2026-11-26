import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assert, assertError, assertIndistinguishable, assertNoSecrets } from './lib/assert.mjs';
import { p } from './lib/config.mjs';

test('AUTH-01 registration rejects a password below the minimum length with 400 validation_failed', async () => {
  const c = new Client();
  const res = await c.register(uniqueEmail('short'), 'Ab1!xyz');
  assertError(res, 400, 'validation_failed');
  assertNoSecrets(res, 'Ab1!xyz');
});

test('AUTH-02 registration accepts a 64-character password and it works for login', async () => {
  const c = new Client();
  const email = uniqueEmail('long');
  const password = 'correct horse battery staple '.repeat(3).slice(0, 64);
  assert.equal(password.length, 64);
  const reg = await c.register(email, password);
  assert.equal(reg.status, 202, `expected 202, got ${reg.status}: ${reg.text.slice(0, 200)}`);
  const login = await c.login(email, password);
  assert.equal(login.status, 200, `login with 64-char password returned ${login.status}`);
});

test('AUTH-03 long passwords are verified in full (no silent truncation)', async () => {
  const c = new Client();
  const email = uniqueEmail('trunc');
  const base = 'x'.repeat(80);
  const password = `${base}-tail-one`;
  const reg = await c.register(email, password);
  if (reg.status === 400) {
    // Rejecting over-long input (e.g. bcrypt's 72-byte cap) is acceptable; truncating is not.
    assertError(reg, 400, 'validation_failed');
    return;
  }
  assert.equal(reg.status, 202, `expected 202 or 400, got ${reg.status}`);
  const ok = await new Client().login(email, password);
  assert.equal(ok.status, 200, 'login with the exact long password must succeed');
  const wrong = await new Client().login(email, `${base}-tail-two`);
  assertError(wrong, 401, 'invalid_credentials');
});

test('AUTH-09 registering an existing email is indistinguishable from registering a new one', async () => {
  const { email } = await freshUser('dup');
  const again = await new Client().register(email, strongPassword());
  const fresh = await new Client().register(uniqueEmail('new'), strongPassword());
  assertIndistinguishable(again, fresh, 'register(existing) vs register(new)');
  assert.equal(fresh.status, 202);
});

test('AUTH-09 re-registering an existing email does not change its password', async () => {
  const { email, password } = await freshUser('dup2');
  const attackerPassword = strongPassword();
  await new Client().register(email, attackerPassword);
  const attacker = await new Client().login(email, attackerPassword);
  assertError(attacker, 401, 'invalid_credentials');
  const owner = await new Client().login(email, password);
  assert.equal(owner.status, 200);
});

test('AUTH-12 email addresses are case-insensitive for uniqueness and login', async () => {
  const c = new Client();
  const email = uniqueEmail('case');
  const password = strongPassword();
  assert.equal((await c.register(email, password)).status, 202);
  const upper = email.toUpperCase();
  const login = await new Client().login(upper, password);
  assert.equal(login.status, 200, `login with ${upper} returned ${login.status}`);
  const me = await new Client().register(upper, strongPassword());
  assert.equal(me.status, 202, 'duplicate registration in another case must look like any registration');
  const original = await new Client().login(email, password);
  assert.equal(original.status, 200, 'original password must still work after a differently-cased re-register');
});

test('AUTH-07 registration responses never contain the password or a hash', async () => {
  const c = new Client();
  const password = strongPassword();
  const res = await c.post(p('/register'), { email: uniqueEmail('leak'), password });
  assertNoSecrets(res, password);
});
