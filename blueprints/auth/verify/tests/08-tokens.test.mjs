import { test } from 'node:test';
import { Client, freshUser } from './lib/client.mjs';
import { assert, assertError } from './lib/assert.mjs';
import { config } from './lib/config.mjs';

const tokenOnly = config.mode !== 'token' && 'AUTH_MODE=session: token rotation checks do not apply';

test('AUTH-24 reusing a rotated refresh token revokes the whole token family', { skip: tokenOnly }, async () => {
  const { client } = await freshUser('reuse');
  const stolen = client.snapshot(); // attacker copies the refresh token
  assert.equal((await client.refresh()).status, 200, 'legitimate refresh');

  const replay = await stolen.refresh(); // attacker replays the already-used token
  assertError(replay, 401);

  // Reuse detection: the legitimate client's newer token must now be revoked too.
  const victim = await client.refresh();
  assertError(victim, 401);
});

test('AUTH-25 a tampered or unsigned access token is rejected', { skip: tokenOnly }, async () => {
  const { client } = await freshUser('tamper');
  const token = client.accessToken;
  assert.ok(token, 'login must return access_token in token mode');

  const flipped = new Client();
  flipped.accessToken = token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.at(-1);
  assertError(await flipped.me(), 401, 'unauthenticated');

  const parts = token.split('.');
  if (parts.length === 3) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const unsigned = new Client();
    unsigned.accessToken = `${header}.${parts[1]}.`;
    assertError(await unsigned.me(), 401, 'unauthenticated');
  }
});
