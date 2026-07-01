import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import newHandler from '@/src/pages/api/changelog/new';
import listHandler from '@/src/pages/api/changelog/list';
import slugHandler from '@/src/pages/api/changelog/[slug]';
import { modelReleaseService } from '@/src/services/model-release';

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));

const BOT_TOKEN = 'test_changelog_bot_token_value';
const OWNER_EMAIL = 'owner@example.com';

const CREATE_BODY = {
  vendor: 'OpenAI',
  model: 'GPT-5',
  version: '2025-06',
  releasedAt: '2025-06-01T00:00:00.000Z',
  sourceUrl: 'https://openai.com/gpt-5',
  contextTokens: 400000,
  priceIn: 1.25,
  priceOut: 10,
  changes: ['Bigger context'],
  verdict: 'Solid upgrade',
  sourceName: 'OpenAI Blog',
};

describe('POST /api/changelog/new — admin/bot create', () => {
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

  it('creates a release, returns 201 with data.release.id (bot contract)', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
      body: CREATE_BODY,
    });

    await newHandler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.data.release.id).toEqual(expect.any(String));
    expect(data.data.release.slug).toBe('openai-gpt-5-2025-06');
  });

  it('rejects an over-range contextTokens with 400 (INTEGER column max)', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
      body: { ...CREATE_BODY, contextTokens: 2147483648 },
    });

    await newHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('rejects an anonymous create with 401', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { 'Content-Type': 'application/json' },
      body: CREATE_BODY,
    });

    await newHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });
});

describe('GET /api/changelog — public read', () => {
  beforeEach(async () => {
    await modelReleaseService.create({
      vendor: 'OpenAI',
      model: 'GPT-5',
      version: '2025-06',
      releasedAt: '2025-06-01T00:00:00.000Z',
      sourceUrl: 'https://openai.com/gpt-5',
      changes: [],
    });
  });

  it('list returns a bare { releases, total }', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: {} });
    await listHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.total).toBe(1);
    expect(body.releases).toHaveLength(1);
    expect(body.releases[0].slug).toBe('openai-gpt-5-2025-06');
  });

  it('[slug] returns { success, data: { release } }', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { slug: 'openai-gpt-5-2025-06' },
    });
    await slugHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.release.model).toBe('GPT-5');
  });

  it('[slug] returns 404 for an unknown slug', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { slug: 'nope' } });
    await slugHandler(req, res);
    expect(res._getStatusCode()).toBe(404);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(false);
  });
});
