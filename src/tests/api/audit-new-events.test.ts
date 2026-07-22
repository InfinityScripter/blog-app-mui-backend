import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { signToken } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';

// Mock the bot control proxy so model/mock routes don't touch a real bot server.
jest.mock('@/src/services/bot-control', () => ({
  botControlService: {
    setModel: jest.fn(() => Promise.resolve({ validation: 'pinged' })),
    setMock: jest.fn(() => Promise.resolve({ isMockEnabled: true })),
  },
}));
// Email is required for sign-up to proceed; stub it.
jest.mock('@/src/utils/email', () => ({
  sendVerificationEmail: jest.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line import/first, import/order
import mockHandler from '@/src/pages/api/admin/bot/mock';
// eslint-disable-next-line import/first, import/order
import signUpHandler from '@/src/pages/api/auth/sign-up';
// eslint-disable-next-line import/first, import/order
import modelHandler from '@/src/pages/api/admin/bot/model';

interface AuditRow {
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  target_type: string | null;
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

describe('audit — newly covered admin/auth actions', () => {
  const prevEmailUser = process.env.EMAIL_USER;
  const prevEmailPass = process.env.EMAIL_PASSWORD;

  beforeAll(() => {
    // sign-up.ts gates on EMAIL_USER/EMAIL_PASSWORD being present.
    process.env.EMAIL_USER = 'test@example.com';
    process.env.EMAIL_PASSWORD = 'test-pass';
  });

  afterAll(() => {
    process.env.EMAIL_USER = prevEmailUser;
    process.env.EMAIL_PASSWORD = prevEmailPass;
  });

  beforeEach(async () => {
    await dbQuery('DELETE FROM audit_logs');
    await User.deleteMany({});
    jest.clearAllMocks();
  });

  it('bot.model_changed is recorded when an admin changes the model', async () => {
    await User.create({
      _id: 'adm',
      name: 'Adm',
      email: 'adm@e.com',
      passwordHash: 'x',
      role: 'admin',
    });
    const token = signToken({ userId: 'adm', role: 'admin' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${token}` },
      body: { provider: 'glm', model: 'glm-4-flash' },
    });

    await modelHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    await settle();

    const row = (await auditRows()).find((r) => r.action === 'bot.model_changed');
    expect(row).toBeTruthy();
    expect(row!.actor_id).toBe('adm');
    expect(row!.target_type).toBe('bot');
    expect(row!.metadata).toMatchObject({ provider: 'glm', model: 'glm-4-flash' });
  });

  it('bot.mock_toggled is recorded when an admin toggles mock', async () => {
    await User.create({
      _id: 'adm2',
      name: 'Adm2',
      email: 'adm2@e.com',
      passwordHash: 'x',
      role: 'admin',
    });
    const token = signToken({ userId: 'adm2', role: 'admin' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: `Bearer ${token}` },
      body: { enabled: true },
    });

    await mockHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    await settle();

    const row = (await auditRows()).find((r) => r.action === 'bot.mock_toggled');
    expect(row).toBeTruthy();
    expect(row!.actor_id).toBe('adm2');
    expect(row!.target_type).toBe('bot');
    expect(row!.metadata).toMatchObject({ enabled: true });
  });

  it('a non-admin cannot change the model and no audit row is written', async () => {
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
      body: { provider: 'glm', model: 'glm-4-flash' },
    });

    await modelHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(403);
    await settle();

    expect((await auditRows()).find((r) => r.action === 'bot.model_changed')).toBeUndefined();
  });

  it('auth.signup is recorded with the new user as actor and no password leak', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'newbie@e.com',
        password: 'SuperSecret123',
        firstName: 'New',
        lastName: 'Bie',
        personalDataConsent: true,
        personalDataConsentVersion: '2026-07-22',
      },
    });

    await signUpHandler(req as never, res as never);
    expect(res._getStatusCode()).toBe(201);
    await settle();

    const row = (await auditRows()).find((r) => r.action === 'auth.signup');
    expect(row).toBeTruthy();
    expect(row!.target_type).toBe('user');
    expect(row!.actor_id).toBeTruthy(); // the freshly created user id
    expect(row!.metadata).toMatchObject({ method: 'password' });
    // No password ever lands in the trail.
    expect(JSON.stringify(row!.metadata)).not.toContain('SuperSecret123');
  });
});
