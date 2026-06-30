import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/new';
import { HTTP_METHOD } from '@/src/constants/http';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

const BOT_TOKEN = 'test_bot_service_token_value';
const OWNER_EMAIL = 'owner@example.com';

const VALID_BODY = {
  title: 'Bot Post',
  description: 'Posted by the news bot',
  content: 'Body content',
  publish: 'published',
  tags: ['ai', 'news'],
  metaTitle: 'Bot Meta',
  metaDescription: 'Bot meta description',
  metaKeywords: ['kw1'],
};

function postRequest(token?: string) {
  return createMocks({
    method: HTTP_METHOD.POST,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: VALID_BODY,
  });
}

describe('POST /api/post/new — BOT_API_TOKEN service auth', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    process.env.BOT_API_TOKEN = BOT_TOKEN;
    process.env.OWNER_EMAIL = OWNER_EMAIL;

    // Seed the owner as an admin user — bot posts are authored as the owner.
    const passwordHash = await bcrypt.hash('ownerpassword', 10);
    await User.create({
      name: 'Owner Admin',
      email: OWNER_EMAIL,
      passwordHash,
      avatarURL: 'http://example.com/owner.jpg',
      role: 'admin',
    });
  });

  afterEach(() => {
    process.env.BOT_API_TOKEN = ORIGINAL_ENV.BOT_API_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_ENV.OWNER_EMAIL;
  });

  it('creates a post authored by the owner when the bot token is valid', async () => {
    const { req, res } = postRequest(BOT_TOKEN);

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.post.title).toBe('Bot Post');
    expect(data.post.author.name).toBe('Owner Admin');

    const saved = await Post.findById(data.post._id);
    expect(saved?.title).toBe('Bot Post');
  });

  it('rejects a wrong token with 401 (does not fall through to a valid JWT path)', async () => {
    const { req, res } = postRequest('wrong_token_value_____________________');

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('rejects a missing token with 401', async () => {
    const { req, res } = postRequest(undefined);

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when the resolved owner is not an admin', async () => {
    // Demote the owner: recreate as a regular user.
    await User.deleteMany({ email: OWNER_EMAIL });
    const passwordHash = await bcrypt.hash('ownerpassword', 10);
    await User.create({
      name: 'Owner User',
      email: OWNER_EMAIL,
      passwordHash,
      role: 'user',
    });

    const { req, res } = postRequest(BOT_TOKEN);
    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 500 when OWNER_EMAIL is not configured', async () => {
    delete process.env.OWNER_EMAIL;

    const { req, res } = postRequest(BOT_TOKEN);
    await handler(req, res);
    expect(res._getStatusCode()).toBe(500);
  });
});
