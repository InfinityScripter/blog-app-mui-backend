import uuidv4 from '@/src/utils/uuidv4';
import { generateCsrfToken } from '@/src/lib/csrf';
import { signToken, refreshExpiresInMs } from '@/src/lib/jwt';
import RefreshToken, { generateRefreshToken } from '@/src/models/RefreshToken';

// ----------------------------------------------------------------------
// Session issuance: mint the token set for an authenticated user and persist
// the refresh row. Shared by password sign-in and both OAuth callbacks so the
// cookie/refresh contract is identical across every login path.

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

interface IssueParams {
  userId: string;
  role: string;
  /** Existing rotation family to continue; omit to start a fresh lineage. */
  familyId?: string;
  userAgent?: string | null;
}

/**
 * Mint access + refresh + csrf tokens and store the (hashed) refresh row.
 * Returns the raw token values for the caller to place in cookies.
 */
export async function issueSession({
  userId,
  role,
  familyId,
  userAgent,
}: IssueParams): Promise<IssuedSession> {
  const accessToken = signToken({ userId, role });
  const refreshToken = generateRefreshToken();
  const csrfToken = generateCsrfToken();

  await RefreshToken.create({
    userId,
    rawToken: refreshToken,
    familyId: familyId ?? uuidv4(),
    expiresAt: new Date(Date.now() + refreshExpiresInMs()),
    userAgent: userAgent ?? null,
  });

  return { accessToken, refreshToken, csrfToken };
}
