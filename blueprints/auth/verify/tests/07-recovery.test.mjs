import { test } from 'node:test';
import { Client, freshUser, strongPassword, uniqueEmail } from './lib/client.mjs';
import { assertError, assertIndistinguishable } from './lib/assert.mjs';
import { p } from './lib/config.mjs';

test('AUTH-33 password-reset requests look the same for known and unknown emails', async () => {
  const { email } = await freshUser('forgot');
  const known = await new Client().post(p('/password/forgot'), { email });
  const unknown = await new Client().post(p('/password/forgot'), { email: uniqueEmail('nobody') });
  assertIndistinguishable(known, unknown, 'forgot(known) vs forgot(unknown)');
  if (known.status !== 202) throw new Error(`expected 202, got ${known.status}`);
});

test('AUTH-33 verification-email resend looks the same for known and unknown emails', async () => {
  const { email } = await freshUser('resend');
  const known = await new Client().post(p('/email/resend'), { email });
  const unknown = await new Client().post(p('/email/resend'), { email: uniqueEmail('nobody') });
  assertIndistinguishable(known, unknown, 'resend(known) vs resend(unknown)');
});

test('AUTH-34 a forged password-reset token is rejected with 400 invalid_token', async () => {
  const res = await new Client().post(p('/password/reset'), {
    token: 'forged-token-0000000000000000000000000000',
    password: strongPassword(),
  });
  assertError(res, 400, 'invalid_token');
});

test('AUTH-34 a forged email-verification token is rejected with 400 invalid_token', async () => {
  const res = await new Client().post(p('/email/verify'), { token: 'forged-token-0000000000000000000000000000' });
  assertError(res, 400, 'invalid_token');
});
