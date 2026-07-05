import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import RefreshToken, {
  hashRefreshToken,
  generateRefreshToken,
} from '@/src/models/RefreshToken';

async function seedUser(id = 'u-refresh-1') {
  await User.create({ _id: id, name: 'RT User', email: `${id}@example.com` });
  return id;
}

function future(days = 30): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe('models/RefreshToken', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM refresh_tokens');
    await User.deleteMany({});
  });

  it('stores only the hash, never the raw token', async () => {
    const userId = await seedUser();
    const raw = generateRefreshToken();
    await RefreshToken.create({ userId, rawToken: raw, familyId: 'fam-1', expiresAt: future() });

    const rows = await dbQuery('SELECT token_hash FROM refresh_tokens');
    expect(rows.rows[0].token_hash).toBe(hashRefreshToken(raw));
    expect(rows.rows[0].token_hash).not.toBe(raw);
  });

  it('finds a token by its raw value', async () => {
    const userId = await seedUser();
    const raw = generateRefreshToken();
    await RefreshToken.create({ userId, rawToken: raw, familyId: 'fam-1', expiresAt: future() });

    const found = await RefreshToken.findByRawToken(raw);
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(userId);
    expect(found!.familyId).toBe('fam-1');
    expect(found!.revokedAt).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    expect(await RefreshToken.findByRawToken('nope')).toBeNull();
  });

  it('revoke() marks a single row revoked', async () => {
    const userId = await seedUser();
    const raw = generateRefreshToken();
    const row = await RefreshToken.create({
      userId,
      rawToken: raw,
      familyId: 'fam-1',
      expiresAt: future(),
    });
    await RefreshToken.revoke(row._id, 'successor-id');
    const found = await RefreshToken.findByRawToken(raw);
    expect(found!.revokedAt).not.toBeNull();
    expect(found!.replacedBy).toBe('successor-id');
  });

  it('revokeFamily() revokes every live token in a family', async () => {
    const userId = await seedUser();
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    await RefreshToken.create({ userId, rawToken: a, familyId: 'fam-x', expiresAt: future() });
    await RefreshToken.create({ userId, rawToken: b, familyId: 'fam-x', expiresAt: future() });
    await RefreshToken.revokeFamily('fam-x');
    expect((await RefreshToken.findByRawToken(a))!.revokedAt).not.toBeNull();
    expect((await RefreshToken.findByRawToken(b))!.revokedAt).not.toBeNull();
  });

  it('revokeAllForUser() revokes across families', async () => {
    const userId = await seedUser();
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    await RefreshToken.create({ userId, rawToken: a, familyId: 'fam-1', expiresAt: future() });
    await RefreshToken.create({ userId, rawToken: b, familyId: 'fam-2', expiresAt: future() });
    await RefreshToken.revokeAllForUser(userId);
    expect((await RefreshToken.findByRawToken(a))!.revokedAt).not.toBeNull();
    expect((await RefreshToken.findByRawToken(b))!.revokedAt).not.toBeNull();
  });
});
