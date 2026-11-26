// Runs last: it deliberately trips the login throttle, which can affect later requests from this IP.
import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assert, assertError } from './lib/assert.mjs';
import { config } from './lib/config.mjs';

const MAX = config.rateLimitMaxAttempts;

/** Fail logins for `email` until the app answers 429; return that response or null. */
async function hammer(email) {
  for (let i = 1; i <= MAX + 1; i++) {
    const res = await new Client().login(email, strongPassword());
    if (res.status === 429) return { res, attempts: i };
    assertError(res, 401, 'invalid_credentials');
  }
  return null;
}

let victim;

test(`AUTH-29 repeated failed logins for one account are throttled within ${MAX} attempts, with Retry-After`, async () => {
  victim = await freshUser('ratelimit');
  const hit = await hammer(victim.email);
  assert.ok(hit, `no 429 after ${MAX + 1} failed logins (set RATE_LIMIT_MAX_ATTEMPTS if your threshold is higher)`);
  assertError(hit.res, 429, 'rate_limited');
  const retry = hit.res.headers.get('retry-after');
  assert.ok(retry && /^\d+$|GMT$/.test(retry), `429 must include Retry-After, got "${retry}"`);
});

test('AUTH-31 a throttled account rejects even the correct password until the window passes', async (t) => {
  if (!victim) return t.skip('depends on AUTH-29');
  const res = await new Client().login(victim.email, victim.password);
  assertError(res, 429, 'rate_limited');
});

test('AUTH-30 unknown emails are throttled exactly like real ones (no enumeration via the limiter)', async () => {
  const hit = await hammer(uniqueEmail('ghost-rl'));
  assert.ok(hit, `no 429 for an unknown email after ${MAX + 1} attempts; the limiter reveals which accounts exist`);
  assertError(hit.res, 429, 'rate_limited');
});
