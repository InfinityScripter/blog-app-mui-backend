import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { signToken } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
// eslint-disable-next-line import/first, import/order
import handler from '@/src/pages/api/admin/audit/ingest';

const BOT_TOKEN = 'test_bot_service_token_value';
const OWNER_EMAIL = 'owner@example.com';

interface AuditRow {
  action: string;
  actor_id: string | null;
  actor_role: string | null;
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
    setTimeout(resolve, 40);
  });

describe('POST /api/admin/audit/ingest — bot relevance audit ingestion', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    await dbQuery('DELETE FROM audit_logs');
    await User.deleteMany({});
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.BOT_API_TOKEN = ORIGINAL_ENV.BOT_API_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_ENV.OWNER_EMAIL;
  });

  async function seedOwnerAdmin() {
    process.env.BOT_API_TOKEN = BOT_TOKEN;
    process.env.OWNER_EMAIL = OWNER_EMAIL;
    return User.create({
      _id: 'owner',
      name: 'Owner Admin',
      email: OWNER_EMAIL,
      passwordHash: 'x',
      role: 'admin',
    });
  }

  it('records a valid bot.relevance_dropped event posted with the bot token (200 + row)', async () => {
    await seedOwnerAdmin();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
      body: {
        action: 'bot.relevance_dropped',
        targetId: 'src-article-42',
        metadata: { reason: 'off_topic', score: 0.12, title: 'Crypto pump' },
      },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    await settle();

    const row = (await auditRows()).find((r) => r.action === 'bot.relevance_dropped');
    expect(row).toBeTruthy();
    expect(row!.actor_id).toBe('owner');
    expect(row!.actor_role).toBe('admin');
    expect(row!.target_type).toBe('post'); // default when targetType omitted
    expect(row!.target_id).toBe('src-article-42');
    expect(row!.metadata).toMatchObject({ reason: 'off_topic', score: 0.12 });
  });

  it('honours an explicit targetType', async () => {
    await seedOwnerAdmin();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
      body: {
        action: 'bot.relevance_kept',
        targetType: 'source',
        metadata: { score: 0.91 },
      },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    await settle();

    const row = (await auditRows()).find((r) => r.action === 'bot.relevance_kept');
    expect(row).toBeTruthy();
    expect(row!.target_type).toBe('source');
  });

  it('rejects a non-bot, non-admin JWT with 403 and writes no row', async () => {
    await User.create({
      _id: 'usr',
      name: 'Usr',
      email: 'usr@e.com',
      passwordHash: 'x',
      role: 'user',
    });
    const token = signToken({ userId: 'usr', role: 'user' });

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${token}` },
      body: { action: 'bot.relevance_dropped', metadata: {} },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(403);
    await settle();

    expect((await auditRows()).length).toBe(0);
  });

  it('rejects an action outside the allow-set with 400 and writes no row', async () => {
    await seedOwnerAdmin();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
      body: { action: 'post.deleted', targetId: 'p1', metadata: {} },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
    await settle();

    expect((await auditRows()).length).toBe(0);
  });

  it('rejects a forged non-prefixed action with 400', async () => {
    await seedOwnerAdmin();

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
      body: { action: 'evil.action', metadata: {} },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
    await settle();

    expect((await auditRows()).length).toBe(0);
  });

  it('rejects oversized metadata with 400 and writes no row', async () => {
    await seedOwnerAdmin();

    const huge = 'x'.repeat(5000);
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
      body: { action: 'bot.relevance_dropped', metadata: { blob: huge } },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
    await settle();

    expect((await auditRows()).length).toBe(0);
  });

  it('405 for a non-POST method', async () => {
    await seedOwnerAdmin();

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: `Bearer ${BOT_TOKEN}` },
    });

    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(405);
  });
});
