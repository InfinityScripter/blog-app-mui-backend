import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import RefreshToken from '@/src/models/RefreshToken';
import { toPublicUser } from '@/src/utils/public-user';
import { issueSession, type IssuedSession } from '@/src/services/session';

// ----------------------------------------------------------------------
// Refresh-token rotation with reuse (theft) detection. Given the raw refresh
// token from the cookie, either issue a rotated session or throw 401.

interface RefreshResult extends IssuedSession {
  user: ReturnType<typeof toPublicUser>;
}

const INVALID = () => new AppError(HTTP.UNAUTHORIZED, MSG.UNAUTHORIZED);

/**
 * Exchange a valid refresh token for a fresh session, rotating the refresh
 * token within its family. Reuse of an already-revoked token revokes the whole
 * family (breach response). Throws AppError(401) on any invalid/expired/forged
 * token — the route clears cookies in that case.
 *
 * Race-safe: the predecessor is revoked via an ATOMIC conditional update
 * (`RefreshToken.consume`) that both checks "still live" and revokes in one
 * statement. Two concurrent presentations of the same token → exactly one wins
 * the consume; the loser gets `null` and is treated as reuse → family revoked.
 */
export async function rotateRefresh(
  rawToken: string,
  userAgent?: string | null
): Promise<RefreshResult> {
  // Atomically revoke-and-fetch the token IFF it was still live. A null result
  // means it was already revoked (reuse/theft) or never existed — disambiguate
  // by re-reading the row.
  const row = await RefreshToken.consume(rawToken);

  if (!row) {
    const existing = await RefreshToken.findByRawToken(rawToken);
    if (existing) {
      // The token exists but was already revoked when we tried to consume it →
      // reuse of a rotated-out token → theft. Kill the entire lineage.
      await RefreshToken.revokeFamily(existing.familyId);
    }
    // Either theft (handled above) or a genuinely unknown/forged token → 401.
    throw INVALID();
  }

  // We won the consume: `row` was live and is now revoked. Validate the rest.

  // Expired (consume revoked it already; nothing more to do).
  if (row.expiresAt.getTime() <= Date.now()) {
    throw INVALID();
  }

  // User gone (deleted between issue and refresh).
  const user = await User.findById(row.userId);
  if (!user) {
    await RefreshToken.revokeFamily(row.familyId);
    throw INVALID();
  }

  // Locked accounts must not silently keep a live session via refresh.
  if (user.isLocked) {
    await RefreshToken.revokeFamily(row.familyId);
    throw new AppError(HTTP.FORBIDDEN, MSG.ACCOUNT_LOCKED);
  }

  // Issue the successor in the SAME family (issueSession persists it). The
  // predecessor is already revoked by consume(); family linkage drives theft
  // detection, so an explicit replaced_by pointer isn't required for correctness.
  const session = await issueSession({
    userId: user._id,
    role: user.role ?? 'user',
    familyId: row.familyId,
    userAgent,
  });

  return { ...session, user: toPublicUser(user) };
}
