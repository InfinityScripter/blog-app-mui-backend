import type { IUser } from '@/src/models/User';

import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { AppError } from '@/src/types/api';
import { JWT_SECRET } from '@/src/lib/jwt';
import { HTTP } from '@/src/constants/http';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export type OAuthProvider = 'google' | 'yandex';

interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name: string;
  avatarURL?: string | null;
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CLAIM_TTL_MS = 30 * 1000;
const ENCRYPTION_KEY = createHash('sha256').update(JWT_SECRET).digest();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requiresOAuthConsentChallenge(user: IUser | null): boolean {
  return (
    !user ||
    !user.isEmailVerified ||
    !user.personalDataConsentAt ||
    user.personalDataConsentVersion !== PERSONAL_DATA_CONSENT_VERSION
  );
}

function encryptProfile(profile: OAuthProfile): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(profile), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decryptProfile(payload: string): OAuthProfile {
  try {
    const packed = Buffer.from(payload, 'base64url');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8'
    );
    return JSON.parse(plaintext) as OAuthProfile;
  } catch {
    throw new AppError(HTTP.GONE, 'Ссылка согласия недействительна или устарела');
  }
}

export async function createOAuthConsentChallenge(profile: OAuthProfile): Promise<string> {
  await dbQuery('DELETE FROM oauth_consent_challenges WHERE expires_at <= NOW()');

  const token = `${randomBytes(32).toString('base64url')}.${encryptProfile(profile)}`;
  await dbQuery(
    `INSERT INTO oauth_consent_challenges
       (token_hash, expires_at)
     VALUES ($1, $2)`,
    [hashToken(token), new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()]
  );
  return token;
}

export async function completeOAuthConsentChallenge(token: string) {
  const claimId = randomBytes(16).toString('base64url');
  const claimed = await dbQuery(
    `UPDATE oauth_consent_challenges
        SET claim_id = $2, claim_expires_at = $3
      WHERE token_hash = $1
        AND expires_at > NOW()
        AND (claim_expires_at IS NULL OR claim_expires_at <= NOW())
      RETURNING token_hash`,
    [hashToken(token), claimId, new Date(Date.now() + CLAIM_TTL_MS).toISOString()]
  );
  if (!claimed.rows[0]) {
    const exists = await dbQuery(
      'SELECT token_hash FROM oauth_consent_challenges WHERE token_hash = $1 AND expires_at > NOW()',
      [hashToken(token)]
    );
    if (exists.rows[0]) {
      throw new AppError(
        HTTP.CONFLICT,
        'Согласие уже обрабатывается, повторите через несколько секунд'
      );
    }
    throw new AppError(HTTP.GONE, 'Ссылка согласия недействительна или устарела');
  }

  const encryptedProfile = token.split('.', 2)[1];
  if (!encryptedProfile) {
    throw new AppError(HTTP.GONE, 'Ссылка согласия недействительна или устарела');
  }
  const challenge = decryptProfile(encryptedProfile);

  const providerFilter =
    challenge.provider === 'google'
      ? { googleId: challenge.providerUserId }
      : { yandexId: challenge.providerUserId };
  const [byProvider, byEmail] = await Promise.all([
    User.findOne(providerFilter),
    User.findOne({ email: challenge.email }),
  ]);

  if (byProvider && byEmail && byProvider._id !== byEmail._id) {
    throw new AppError(HTTP.CONFLICT, 'Этот OAuth-аккаунт уже связан с другим пользователем');
  }

  const user = byProvider ?? byEmail ?? new User({ email: challenge.email });
  if (user.isLocked) {
    throw new AppError(HTTP.FORBIDDEN, 'Аккаунт заблокирован');
  }

  if (byEmail && !byEmail.isEmailVerified && !byProvider) {
    user.name = challenge.name;
    user.passwordHash = null;
    user.passwordResetCode = null;
    user.passwordResetExpires = null;
    user.emailVerificationCode = null;
    user.emailVerificationExpires = null;
  }

  user.name = user.name || challenge.name;
  user.avatarURL = user.avatarURL || challenge.avatarURL || null;
  user.isEmailVerified = true;
  user.personalDataConsentAt = new Date();
  user.personalDataConsentVersion = PERSONAL_DATA_CONSENT_VERSION;
  if (challenge.provider === 'google') {
    user.googleId = challenge.providerUserId;
  } else {
    user.yandexId = challenge.providerUserId;
  }
  await user.save();
  return { user, claimId };
}

export async function finalizeOAuthConsentChallenge(token: string, claimId: string): Promise<void> {
  const deleted = await dbQuery(
    'DELETE FROM oauth_consent_challenges WHERE token_hash = $1 AND claim_id = $2 RETURNING token_hash',
    [hashToken(token), claimId]
  );
  if (!deleted.rows[0]) {
    throw new AppError(HTTP.CONFLICT, 'Не удалось завершить OAuth-согласие, повторите попытку');
  }
}
