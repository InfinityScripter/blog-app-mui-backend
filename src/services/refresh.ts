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
 */
export async function rotateRefresh(
  rawToken: string,
  userAgent?: string | null
): Promise<RefreshResult> {
  const row = await RefreshToken.findByRawToken(rawToken);

  // Unknown / forged token.
  if (!row) {
    throw INVALID();
  }

  // Reuse of a rotated-out token → theft. Kill the entire lineage.
  if (row.revokedAt) {
    await RefreshToken.revokeFamily(row.familyId);
    throw INVALID();
  }

  // Expired.
  if (row.expiresAt.getTime() <= Date.now()) {
    await RefreshToken.revoke(row._id);
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

  // Issue the successor in the SAME family (issueSession persists it), then
  // revoke the predecessor. Family linkage is what drives theft detection, so
  // an explicit replaced_by pointer isn't required for correctness.
  const session = await issueSession({
    userId: user._id,
    role: user.role ?? 'user',
    familyId: row.familyId,
    userAgent,
  });
  await RefreshToken.revoke(row._id);

  return { ...session, user: toPublicUser(user) };
}
