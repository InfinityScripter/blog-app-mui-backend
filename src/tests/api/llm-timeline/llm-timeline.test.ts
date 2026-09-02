import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import putHandler from '@/src/pages/api/llm-timeline/[id]';
import listHandler from '@/src/pages/api/llm-timeline/list';
import deleteHandler from '@/src/pages/api/llm-timeline/[id]/delete';

const BOT_TOKEN = 'test_timeline_bot_token_value';
const OWNER_EMAIL = 'owner@example.com';
const ID = 'anthropic-claude-fable-5-1';

const BODY = {
  slug: 'claude-fable-5-1',
  vendor: 'Anthropic',
  name: 'Claude Fable 5.1',
  releaseDate: '2026-09-01',
  contextTokens: 1000000,
  params: null,
  highlight: 'Чтение из кеша подешевело вчетверо.',
  description: 'Обновление старшей модели Anthropic.',
  capabilities: ['agentic', 'coding'],
  sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-1',
  wikiUrl: null,
  funFact: null,
};

function botHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` };
}

async function put(id: string, body: unknown, headers = botHeaders()) {
  const { req, res } = createMocks({ method: HTTP_METHOD.PUT, headers, query: { id }, body });
  await putHandler(req, res);
  return res;
}

describe('/api/llm-timeline', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    process.env.BOT_API_TOKEN = BOT_TOKEN;
    process.env.OWNER_EMAIL = OWNER_EMAIL;
    const passwordHash = await bcrypt.hash('ownerpassword', 10);
    await User.create({ name: 'Owner Admin', email: OWNER_EMAIL, passwordHash, role: 'admin' });
    await dbQuery('DELETE FROM app_settings');
    settingsService.__resetCacheForTests();
    await settingsService.setFlag('autoPublishTimeline', true);
  });

  afterEach(() => {
    process.env.BOT_API_TOKEN = ORIGINAL_ENV.BOT_API_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_ENV.OWNER_EMAIL;
  });

  it('PUT creates with 201, then updates the same id with 200', async () => {
    const created = await put(ID, BODY);
    expect(created._getStatusCode()).toBe(201);
    expect(JSON.parse(created._getData()).data).toMatchObject({
      created: true,
      model: { id: ID, slug: 'claude-fable-5-1', releaseDate: '2026-09-01' },
    });

    const updated = await put(ID, { ...BODY, highlight: 'Другой заголовок' });
    expect(updated._getStatusCode()).toBe(200);
    expect(JSON.parse(updated._getData()).data).toMatchObject({
      created: false,
      model: { highlight: 'Другой заголовок' },
    });
  });

  it('PUT answers 404 when autoPublishTimeline is off (fail-closed kill switch)', async () => {
    await settingsService.setFlag('autoPublishTimeline', false);
    const res = await put(ID, BODY);
    expect(res._getStatusCode()).toBe(404);
  });

  it('PUT rejects a missing token with 401 and a bad body with 400', async () => {
    const anonymous = await put(ID, BODY, { 'Content-Type': 'application/json' });
    expect(anonymous._getStatusCode()).toBe(401);

    const badDate = await put(ID, { ...BODY, releaseDate: '2026-9-1' });
    expect(badDate._getStatusCode()).toBe(400);
    expect(JSON.parse(badDate._getData()).message).toMatch(/releaseDate/);

    // eslint-disable-next-line no-script-url -- test fixture for the httpUrl schema rejecting non-http schemes
    const badUrl = await put(ID, { ...BODY, wikiUrl: 'javascript:alert(1)' });
    expect(badUrl._getStatusCode()).toBe(400);

    const badId = await put('Not Kebab', BODY);
    expect(badId._getStatusCode()).toBe(400);
  });

  it('PUT answers 409 when another id already uses the slug', async () => {
    await put(ID, BODY);
    const clash = await put('inception-mercury-2-5', BODY);
    expect(clash._getStatusCode()).toBe(409);
  });

  it('GET list is public and returns oldest first', async () => {
    await put('b-newer', { ...BODY, slug: 'newer', releaseDate: '2026-09-02' });
    await put('a-older', { ...BODY, slug: 'older', releaseDate: '2026-08-31' });
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await listHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { models } = JSON.parse(res._getData());
    expect(models.map((model: { id: string }) => model.id)).toEqual(['a-older', 'b-newer']);
  });

  it('DELETE removes the entry even when the publish flag is off, 404 on repeat', async () => {
    await put(ID, BODY);
    await settingsService.setFlag('autoPublishTimeline', false);

    const first = createMocks({
      method: HTTP_METHOD.DELETE,
      headers: botHeaders(),
      query: { id: ID },
    });
    await deleteHandler(first.req, first.res);
    expect(first.res._getStatusCode()).toBe(200);

    const second = createMocks({
      method: HTTP_METHOD.DELETE,
      headers: botHeaders(),
      query: { id: ID },
    });
    await deleteHandler(second.req, second.res);
    expect(second.res._getStatusCode()).toBe(404);
  });
});
