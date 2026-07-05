import crypto from 'crypto';
import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';

// ----------------------------------------------------------------------
// Refresh-token store for the rotating-refresh auth flow.
//
// The raw refresh token is a high-entropy random string that lives ONLY in the
// httpOnly cookie. We persist just its SHA-256 hash, so a DB leak cannot be
// replayed as a valid session. `family_id` links a rotation lineage: every
// refresh issues a successor in the same family and revokes its predecessor; if
// an already-revoked token in a family is presented again, that's a reused
// (stolen) token and we revoke the whole family.

export interface IRefreshToken {
  _id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  replacedBy?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  user_agent: string | null;
  created_at: Date;
}

function mapRow(row: RefreshTokenRow): IRefreshToken {
  return {
    _id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedBy: row.replaced_by,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

/** SHA-256 hex of a raw refresh token. The only form persisted server-side. */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Cryptographically-random opaque refresh token (256 bits, url-safe). */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

interface CreateParams {
  userId: string;
  rawToken: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string | null;
}

const RefreshToken = {
  /** Persist a new refresh row (hashing the raw token). Returns the stored row. */
  async create({ userId, rawToken, familyId, expiresAt, userAgent }: CreateParams) {
    const id = uuidv4();
    const result = await dbQuery<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, userId, hashRefreshToken(rawToken), familyId, expiresAt, userAgent ?? null]
    );
    return mapRow(result.rows[0]);
  },

  /** Look a token up by its raw value (hashes, then matches). Null if absent. */
  async findByRawToken(rawToken: string): Promise<IRefreshToken | null> {
    const result = await dbQuery<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1',
      [hashRefreshToken(rawToken)]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  /**
   * Atomically consume a refresh token: revoke it and return the row, but ONLY
   * if it was still live (not already revoked) at the moment of the update. The
   * `WHERE ... AND revoked_at IS NULL` predicate makes check-and-revoke a single
   * statement, so two concurrent presentations of the same token can't both
   * succeed — exactly one UPDATE affects the row; the loser gets `null`. This is
   * the race-safe gate for rotation (a `null` return on a token that DOES exist
   * means reuse → theft; the caller re-reads via findByRawToken to distinguish
   * reuse from a genuinely-absent token).
   */
  async consume(rawToken: string): Promise<IRefreshToken | null> {
    const result = await dbQuery<RefreshTokenRow>(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING *`,
      [hashRefreshToken(rawToken)]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  /** Revoke a single row and record its successor (rotation audit trail). */
  async revoke(id: string, replacedBy?: string | null) {
    await dbQuery(
      'UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1 AND revoked_at IS NULL',
      [id, replacedBy ?? null]
    );
  },

  /** Revoke every token in a rotation lineage (theft response). */
  async revokeFamily(familyId: string) {
    await dbQuery(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId]
    );
  },

  /** Revoke all of a user's tokens ("sign out everywhere"). */
  async revokeAllForUser(userId: string) {
    await dbQuery(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  },

  /** Test/maintenance helper: drop expired rows. */
  async deleteExpired() {
    await dbQuery('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
  },
};

export default RefreshToken;
