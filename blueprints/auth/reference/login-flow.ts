// Illustrative only: the shape of AuthService.login, stack-neutral TypeScript.
// Shows the ordering that matters: throttle check -> constant-work verify -> record outcome -> rehash -> session.
import * as argon2 from 'argon2';

const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing-equalisation', ARGON2);

export async function login(input: { email: string; password: string }, ctx: { ip: string }) {
  const email = input.email.trim().toLowerCase();               // D9: normalised identifier
  const keys = { emailIp: `${email}|${ctx.ip}`, email, ip: ctx.ip };

  await throttle.assertNotBlocked(keys);                         // throws RateLimited(retryAfterSec) -> 429

  const user = await users.findByEmail(email);
  const ok = await verify(user?.passwordHash ?? DUMMY_HASH, input.password.normalize('NFC'));

  if (!user || !ok || user.status !== 'active') {
    await throttle.recordFailure(keys);                          // counts unknown emails identically
    audit.emit({ type: 'auth.login.failed', subjectUserId: user?.id ?? null, ip: ctx.ip, outcome: 'failure' });
    throw new InvalidCredentials();                              // one error for every failure -> 401
  }

  await throttle.reset({ emailIp: keys.emailIp });
  if (argon2.needsRehash(user.passwordHash, ARGON2)) {
    await users.updatePasswordHash(user.id, await argon2.hash(input.password.normalize('NFC'), ARGON2));
  }
  audit.emit({ type: 'auth.login.succeeded', actorUserId: user.id, ip: ctx.ip, outcome: 'success' });
  return user; // the HTTP layer regenerates the session and sets the cookie
}

async function verify(digest: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(digest, password);
  } catch {
    return false; // malformed digest is a failure, never a success
  }
}

// Declarations so the snippet reads cleanly; real implementations live in your codebase.
declare const throttle: { assertNotBlocked(k: object): Promise<void>; recordFailure(k: object): Promise<void>; reset(k: object): Promise<void> };
declare const users: { findByEmail(e: string): Promise<{ id: string; passwordHash: string; status: string } | null>; updatePasswordHash(id: string, h: string): Promise<void> };
declare const audit: { emit(e: Record<string, unknown>): void };
declare class InvalidCredentials extends Error {}
