// Illustrative only (token mode): refresh-token rotation with reuse detection, per RFC 9700 §4.14.
// Tokens are opaque random values; only their SHA-256 is stored.
import { createHash, randomBytes } from 'node:crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const FAMILY_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export async function rotate(rawRefreshToken: string) {
  return db.transaction(async (tx) => {
    const row = await tx.refreshTokens.findForUpdate(sha256(rawRefreshToken)); // row lock: no double-spend race
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new InvalidToken();

    if (row.usedAt) {
      // Reuse of a spent token: someone holds a copy. Kill the whole family, including the newest token.
      await tx.refreshTokens.revokeFamily(row.familyId);
      await tx.accessTokenCutoffs.revokeFamily(row.familyId); // access tokens carry sid=familyId
      audit.emit({ type: 'auth.refresh.reuse_detected', subjectUserId: row.userId, outcome: 'failure' });
      throw new InvalidToken();
    }

    await tx.refreshTokens.markUsed(row.tokenHash);
    const next = randomBytes(32).toString('base64url');
    await tx.refreshTokens.insert({
      tokenHash: sha256(next),
      familyId: row.familyId,
      userId: row.userId,
      expiresAt: new Date(Math.min(Date.now() + FAMILY_ABSOLUTE_MS, row.familyExpiresAt.getTime())), // never extends
    });
    return { refreshToken: next, accessToken: await signAccessToken(row.userId, row.familyId) };
  });
}

declare const db: { transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> };
declare const audit: { emit(e: Record<string, unknown>): void };
declare function signAccessToken(userId: string, familyId: string): Promise<string>; // jose, EdDSA/ES256, exp=10m
declare class InvalidToken extends Error {}
