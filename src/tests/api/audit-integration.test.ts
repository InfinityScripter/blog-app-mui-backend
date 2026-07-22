import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { signToken } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import newPostHandler from '@/src/pages/api/post/new';
import signInHandler from '@/src/pages/api/auth/sign-in';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

interface AuditRow {
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
}

async function auditRows() {
  const r = await dbQuery<AuditRow>('SELECT * FROM audit_logs ORDER BY created_at');
  return r.rows;
}

// Wait a tick so the fire-and-forget audit insert lands before we assert.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 30);
  });

describe('audit integration — routes emit events', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM audit_logs');
    await User.deleteMany({});
  });

  it('post.created is recorded when a post is created', async () => {
    await User.create({ _id: 'author', name: 'A', email: 'a@e.com', passwordHash: 'x' });
    const token = signToken({ userId: 'author', role: 'user' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${token}` },
      body: { title: 'Hello', content: '<p>hi</p>', publish: 'draft' },
    });

    await newPostHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(201);
    await settle();

    const rows = await auditRows();
    const created = rows.find((r) => r.action === 'post.created');
    expect(created).toBeTruthy();
    expect(created!.actor_id).toBe('author');
    expect(created!.target_type).toBe('post');
    expect(created!.metadata).toMatchObject({ publish: 'draft' });
  });

  it('auth.login.succeeded is recorded on a valid sign-in', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      _id: 'signer',
      name: 'S',
      email: 'signer@e.com',
      passwordHash,
      isEmailVerified: true,
      personalDataConsentAt: new Date(),
      personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
    });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'signer@e.com', password: 'password123' },
    });

    await signInHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    await settle();

    const rows = await auditRows();
    const ok = rows.find((r) => r.action === 'auth.login.succeeded');
    expect(ok).toBeTruthy();
    expect(ok!.actor_id).toBe('signer');
  });

  it('auth.login.failed is recorded (anonymous, no email) on a wrong password', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      _id: 'signer2',
      name: 'S2',
      email: 'signer2@e.com',
      passwordHash,
      isEmailVerified: true,
    });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'signer2@e.com', password: 'WRONG' },
    });

    await signInHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
    await settle();

    const rows = await auditRows();
    const failed = rows.find((r) => r.action === 'auth.login.failed');
    expect(failed).toBeTruthy();
    expect(failed!.actor_id).toBeNull(); // anonymous — no actor on failure
    // No PII (email) in the metadata.
    expect(JSON.stringify(failed!.metadata)).not.toContain('signer2@e.com');
  });
});
