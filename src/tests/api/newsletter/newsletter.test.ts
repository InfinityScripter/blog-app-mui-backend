import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import sendHandler from '@/src/pages/api/newsletter/send';
import { subscriberService } from '@/src/services/subscriber';
import { __resetRateLimitStore } from '@/src/utils/rate-limit';
import confirmHandler from '@/src/pages/api/newsletter/confirm';
import subscribeHandler from '@/src/pages/api/newsletter/subscribe';
import { sendDigestEmail, sendConfirmEmail } from '@/src/utils/email';
import unsubscribeHandler from '@/src/pages/api/newsletter/unsubscribe';

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/utils/email', () => ({
  sendConfirmEmail: jest.fn(() => Promise.resolve()),
  sendDigestEmail: jest.fn(() => Promise.resolve()),
}));

const mockedSendConfirmEmail = jest.mocked(sendConfirmEmail);
const mockedSendDigestEmail = jest.mocked(sendDigestEmail);

// Deterministic tokens between subscribe and confirm/unsubscribe: read them
// straight from the DB (the API never returns tokens by design).
async function readTokens(email: string) {
  const { dbQuery } = await import('@/src/lib/db');
  const result = await dbQuery<{
    confirm_token: string | null;
    unsubscribe_token: string | null;
  }>('SELECT confirm_token, unsubscribe_token FROM subscribers WHERE LOWER(email) = LOWER($1)', [
    email,
  ]);
  return result.rows[0];
}

beforeEach(() => {
  __resetRateLimitStore();
  mockedSendConfirmEmail.mockClear();
  mockedSendDigestEmail.mockClear();
});

describe('POST /api/newsletter/subscribe', () => {
  it('creates a pending subscriber, returns 201 + sends confirm email', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'reader@example.com' },
    });

    await subscribeHandler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.data.subscriber.status).toBe('pending');
    expect(data.data.subscriber.email).toBe('reader@example.com');
    expect(data.data.subscriber.confirmToken).toBeUndefined();
    expect(data.data.subscriber.unsubscribeToken).toBeUndefined();
    expect(mockedSendConfirmEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid email with 400', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'not-an-email' },
    });

    await subscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 409 when the email is already confirmed', async () => {
    const { subscriber, confirmToken } = await subscriberService.subscribe('taken@example.com');
    await subscriberService.confirm(confirmToken);
    expect(subscriber.status).toBe('pending');

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'taken@example.com' },
    });

    await subscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(409);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(false);
    expect(data.message).toBe('Вы уже подписаны');
  });

  it('re-subscribing a pending email re-issues a fresh confirm token', async () => {
    const first = await subscriberService.subscribe('again@example.com');

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'again@example.com' },
    });
    await subscribeHandler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const after = await readTokens('again@example.com');
    expect(after?.confirm_token).toEqual(expect.any(String));
    expect(after?.confirm_token).not.toBe(first.confirmToken);
  });

  it('rate-limits the 6th subscribe within the window with 429', async () => {
    const attempt = async (email: string) => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { 'Content-Type': 'application/json' },
        body: { email },
      });
      await subscribeHandler(req, res);
      return res._getStatusCode();
    };

    const first5 = await Promise.all([1, 2, 3, 4, 5].map((n) => attempt(`burst${n}@example.com`)));
    first5.forEach((code) => expect(code).toBe(201));

    const sixth = await attempt('burst6@example.com');
    expect(sixth).toBe(429);
  });
});

describe('GET /api/newsletter/confirm', () => {
  it('confirms a pending subscriber (200 + status confirmed)', async () => {
    await subscriberService.subscribe('confirm-me@example.com');
    const tokens = await readTokens('confirm-me@example.com');

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: tokens?.confirm_token },
    });
    await confirmHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.data.subscriber.status).toBe('confirmed');
    expect(data.data.subscriber.email).toBe('confirm-me@example.com');
  });

  it('returns 404 for an unknown token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: '11111111-1111-4111-8111-111111111111' },
    });
    await confirmHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('returns 404 (not 400) for a malformed, non-uuid token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: 'not-a-uuid' },
    });
    await confirmHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('returns 410 for an expired token', async () => {
    await subscriberService.subscribe('expired@example.com');
    const tokens = await readTokens('expired@example.com');
    const { dbQuery } = await import('@/src/lib/db');
    await dbQuery('UPDATE subscribers SET confirm_expires_at = $1 WHERE confirm_token = $2', [
      new Date(Date.now() - 60_000).toISOString(),
      tokens?.confirm_token,
    ]);

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: tokens?.confirm_token },
    });
    await confirmHandler(req, res);

    expect(res._getStatusCode()).toBe(410);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Ссылка устарела, подпишитесь заново');
  });
});

describe('GET /api/newsletter/unsubscribe', () => {
  it('unsubscribes a subscriber (200 + status unsubscribed)', async () => {
    await subscriberService.subscribe('bye@example.com');
    const tokens = await readTokens('bye@example.com');

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: tokens?.unsubscribe_token },
    });
    await unsubscribeHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.data.email).toBe('bye@example.com');
    expect(data.data.status).toBe('unsubscribed');
  });

  it('is idempotent — a second unsubscribe still returns 200', async () => {
    await subscriberService.subscribe('bye2@example.com');
    const tokens = await readTokens('bye2@example.com');
    await subscriberService.unsubscribe(tokens?.unsubscribe_token ?? '');

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: tokens?.unsubscribe_token },
    });
    await unsubscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('returns 404 for an unknown token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: '22222222-2222-4222-8222-222222222222' },
    });
    await unsubscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });

  it('returns 404 (not 400) for a malformed, non-uuid token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { token: 'not-a-uuid' },
    });
    await unsubscribeHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});

describe('POST /api/newsletter/send', () => {
  const BOT_TOKEN = 'test_newsletter_bot_token_value';
  const OWNER_EMAIL = 'owner@example.com';
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    process.env.BOT_API_TOKEN = BOT_TOKEN;
    process.env.OWNER_EMAIL = OWNER_EMAIL;
    const passwordHash = await bcrypt.hash('ownerpassword', 10);
    await User.create({ name: 'Owner Admin', email: OWNER_EMAIL, passwordHash, role: 'admin' });
  });

  afterEach(() => {
    process.env.BOT_API_TOKEN = ORIGINAL_ENV.BOT_API_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_ENV.OWNER_EMAIL;
  });

  const SEND_BODY = { subject: 'Weekly digest', html: '<p>Hello</p>' };

  it('rejects an anonymous send with 401', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: SEND_BODY,
    });
    await sendHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('sends to confirmed subscribers only and returns { sent, failed }', async () => {
    // one confirmed, one still-pending — only the confirmed one gets a digest.
    const confirmed = await subscriberService.subscribe('active@example.com');
    await subscriberService.confirm(confirmed.confirmToken);
    await subscriberService.subscribe('pending@example.com');

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
      body: SEND_BODY,
    });
    await sendHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.data.sent).toBe(1);
    expect(data.data.failed).toBe(0);
    expect(mockedSendDigestEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendDigestEmail).toHaveBeenCalledWith(
      'active@example.com',
      'Weekly digest',
      '<p>Hello</p>',
      expect.any(String)
    );
  });

  it('rejects an invalid body with 400', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
      body: { subject: '', html: '' },
    });
    await sendHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
