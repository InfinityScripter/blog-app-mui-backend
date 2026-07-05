import '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { createHash } from 'node:crypto';
import { Post } from '@/src/models/Post';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import listHandler from '@/src/pages/api/post/list';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import detailsHandler from '@/src/pages/api/post/details';
import { translationProvider } from '@/src/utils/translate';
import warmHandler from '@/src/pages/api/admin/translate/warm';
import { isWarmupRunning, warmFeedTranslations } from '@/src/services/translation-warmup';

// Mock DeepL: echo each field with an [EN] prefix so a translation is easy to
// assert and no network call is made.
jest.mock('@/src/utils/translate', () => ({
  translationProvider: {
    translateHtml: jest.fn((text: string) => Promise.resolve(text === '' ? '' : `[EN] ${text}`)),
  },
}));

const mockedTranslateHtml = jest.mocked(translationProvider.translateHtml);

const OWNER_ID = '7060694b2c21843bf8307f77';

const ORIGINAL = {
  title: 'Заголовок',
  description: 'Описание',
  content: '<p>Содержимое тела</p>',
};

async function seedOwner() {
  const passwordHash = await bcrypt.hash('pw', 10);
  await User.create({ _id: OWNER_ID, name: 'Owner', email: 'owner@example.com', passwordHash });
}

async function seedPost(overrides: Partial<typeof ORIGINAL> = {}) {
  const post = await Post.create({
    ...ORIGINAL,
    ...overrides,
    publish: 'published',
    userId: OWNER_ID,
    author: { name: 'Owner' },
  });
  return post._id?.toString() || '';
}

interface Row {
  post_id: string;
  lang: string;
  title: string;
  description: string;
  content: string;
  status: string;
  scope: string;
}

async function readRows(postId: string): Promise<Row[]> {
  const result = await dbQuery<Row>(
    'SELECT post_id, lang, title, description, content, status, scope FROM post_translations WHERE post_id = $1',
    [postId]
  );
  return result.rows;
}

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

beforeEach(async () => {
  // Reset to the default echo impl (a test may override it via
  // mockImplementation; mockClear alone wouldn't restore the default).
  mockedTranslateHtml.mockReset();
  mockedTranslateHtml.mockImplementation((text: string) =>
    Promise.resolve(text === '' ? '' : `[EN] ${text}`)
  );
  await Post.deleteMany({});
  await User.deleteMany({});
  await dbQuery('DELETE FROM post_translations');
  await seedOwner();
});

describe('GET /api/post/list — i18n summary warming (lang=en)', () => {
  it('translates title+description and writes a scope=summary row (body untouched)', async () => {
    const postId = await seedPost();

    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    const { posts } = JSON.parse(res._getData());
    const listed = posts.find((p: { id: string }) => p.id === postId);
    expect(listed.title).toBe('[EN] Заголовок');
    expect(listed.description).toBe('[EN] Описание');

    const rows = await readRows(postId);
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('summary');
    expect(rows[0].status).toBe('ok');
    expect(rows[0].title).toBe('[EN] Заголовок');
    // Body left as the original in a summary row — only two short fields called.
    expect(rows[0].content).toBe(ORIGINAL.content);
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(2);
  });

  it('serves a warmed summary as a DB hit on the next list (no provider call)', async () => {
    const postId = await seedPost();

    const first = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(first.req, first.res);
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(2);
    mockedTranslateHtml.mockClear();

    const second = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(second.req, second.res);

    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    const { posts } = JSON.parse(second.res._getData());
    expect(posts.find((p: { id: string }) => p.id === postId).title).toBe('[EN] Заголовок');
  });

  it('lang=ru leaves the list original and writes no rows', async () => {
    const postId = await seedPost();

    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'ru' } });
    await listHandler(req, res);

    const { posts } = JSON.parse(res._getData());
    expect(posts.find((p: { id: string }) => p.id === postId).title).toBe(ORIGINAL.title);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    expect(await readRows(postId)).toHaveLength(0);
  });
});

describe('summary vs full scope interplay', () => {
  it('a summary row does NOT satisfy details — the body is translated + upgraded to full', async () => {
    const postId = await seedPost();

    // Warm a summary via the list (title+description only).
    const list = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(list.req, list.res);
    expect((await readRows(postId))[0].scope).toBe('summary');
    mockedTranslateHtml.mockClear();

    // Open the post: the summary row must not short-circuit the body, so all
    // three fields translate and the row is upgraded to full.
    const details = createMocks({ method: HTTP_METHOD.GET, query: { id: postId, lang: 'en' } });
    await detailsHandler(details.req, details.res);

    const { post } = JSON.parse(details.res._getData());
    expect(post.content).toBe('[EN] <p>Содержимое тела</p>');
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(3);

    const rows = await readRows(postId);
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('full');
    expect(rows[0].content).toBe('[EN] <p>Содержимое тела</p>');
  });

  it('a full row (from details) is reused by the list with no provider call', async () => {
    const postId = await seedPost();

    // Full translation first (details).
    const details = createMocks({ method: HTTP_METHOD.GET, query: { id: postId, lang: 'en' } });
    await detailsHandler(details.req, details.res);
    expect((await readRows(postId))[0].scope).toBe('full');
    mockedTranslateHtml.mockClear();

    // List reuses the full row's short fields — no network.
    const list = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(list.req, list.res);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    const { posts } = JSON.parse(list.res._getData());
    expect(posts.find((p: { id: string }) => p.id === postId).title).toBe('[EN] Заголовок');
    // Still a full row after the list read — the list must not downgrade it.
    expect((await readRows(postId))[0].scope).toBe('full');
  });
});

describe('warmFeedTranslations service', () => {
  it('warms every published post summary; a second run is all cache hits', async () => {
    const idA = await seedPost({ title: 'Пост А' });
    const idB = await seedPost({ title: 'Пост Б' });

    const first = await warmFeedTranslations();
    expect(first.posts).toBe(2);
    expect(first.translated).toBe(2);
    expect(first.cached).toBe(0);
    expect(first.errors).toBe(0);

    // Two summary rows, one per post.
    expect((await readRows(idA))[0].scope).toBe('summary');
    expect((await readRows(idB))[0].scope).toBe('summary');

    mockedTranslateHtml.mockClear();
    const second = await warmFeedTranslations();
    expect(second.translated).toBe(0);
    expect(second.cached).toBe(2);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
  });

  it('a provider error is tallied and does not abort the run', async () => {
    await seedPost({ title: 'Хороший' });
    // Fail the very next translate call (the first post's title).
    mockedTranslateHtml.mockRejectedValueOnce(new Error('DeepL down'));

    const result = await warmFeedTranslations();
    expect(result.posts).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.translated).toBe(0);
  });

  it("mode='full' warms the BODY too and writes scope=full rows", async () => {
    const postId = await seedPost();

    const result = await warmFeedTranslations(undefined, 'full');
    expect(result.mode).toBe('full');
    expect(result.translated).toBe(1);
    // 3 fields translated (title + description + body), not 2.
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(3);

    const rows = await readRows(postId);
    expect(rows[0].scope).toBe('full');
    expect(rows[0].content).toBe('[EN] <p>Содержимое тела</p>');

    // A second full run is a cache hit (fresh full row) — no provider calls.
    mockedTranslateHtml.mockClear();
    const second = await warmFeedTranslations(undefined, 'full');
    expect(second.cached).toBe(1);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
  });

  it("full warm UPGRADES an existing summary row to full", async () => {
    const postId = await seedPost();
    await warmFeedTranslations(undefined, 'summary');
    expect((await readRows(postId))[0].scope).toBe('summary');
    mockedTranslateHtml.mockClear();

    await warmFeedTranslations(undefined, 'full');
    const rows = await readRows(postId);
    expect(rows[0].scope).toBe('full');
    expect(rows[0].content).toBe('[EN] <p>Содержимое тела</p>');
    // Re-translated the 3 fields to fill the body (summary row was stale for full).
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(3);
  });
});

describe('error rows are retried, never served as a cache hit', () => {
  // A row written with status='error' holds the ORIGINAL (untranslated) fields
  // after a provider outage. Its source_hash is fresh, so a naive
  // "fresh + scope" check would serve it forever. Every read/warm path must
  // instead re-translate it (status must be 'ok' to be a hit).

  async function seedErrorRow(postId: string, scope: 'summary' | 'full') {
    // Simulate a prior failed translation: original fields, fresh hash, error.
    // The hash is computed in JS (pg-mem has no pgcrypto digest()) exactly as the
    // service does: sha256 of `title + ' ' + description + ' ' + content`.
    const hash = createHash('sha256')
      .update([ORIGINAL.title, ORIGINAL.description, ORIGINAL.content].join(' '))
      .digest('hex');
    await dbQuery(
      `INSERT INTO post_translations (post_id, lang, title, description, content, source_hash, status, scope, updated_at)
       VALUES ($1, 'en', $2, $3, $4, $5, 'error', $6, NOW())`,
      [postId, ORIGINAL.title, ORIGINAL.description, ORIGINAL.content, hash, scope]
    );
  }

  it('details re-translates a full ERROR row (does not serve the original)', async () => {
    const postId = await seedPost();
    await seedErrorRow(postId, 'full');
    expect((await readRows(postId))[0].status).toBe('error');
    mockedTranslateHtml.mockClear();

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { id: postId, lang: 'en' },
    });
    await detailsHandler(req, res);

    const { post } = JSON.parse(res._getData());
    // Translated now, not the original error-row fallback.
    expect(post.title).toBe('[EN] Заголовок');
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(3);
    const rows = await readRows(postId);
    expect(rows[0].status).toBe('ok');
  });

  it('a full warm re-translates an ERROR row (counts it translated, not cached)', async () => {
    const postId = await seedPost();
    await seedErrorRow(postId, 'summary');
    mockedTranslateHtml.mockClear();

    const result = await warmFeedTranslations(undefined, 'full');
    expect(result.translated).toBe(1);
    expect(result.cached).toBe(0);
    expect((await readRows(postId))[0].status).toBe('ok');
  });

  it('the list re-translates an ERROR row (serves the translation, not original)', async () => {
    const postId = await seedPost();
    await seedErrorRow(postId, 'summary');
    mockedTranslateHtml.mockClear();

    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(req, res);

    const { posts } = JSON.parse(res._getData());
    expect(posts.find((p: { id: string }) => p.id === postId).title).toBe('[EN] Заголовок');
    const rows = await readRows(postId);
    expect(rows[0].status).toBe('ok');
  });
});

describe('HTML entities in translated title/description are decoded', () => {
  it('decodes &quot; / &#x27; in a list title (rendered as text)', async () => {
    const postId = await seedPost({ title: 'Заголовок с кавычками' });
    // DeepL (HTML mode) returns entities for punctuation in plain-text fields.
    mockedTranslateHtml.mockImplementation((text: string) =>
      Promise.resolve(
        text === '' ? '' : `&quot;Title&quot; it&#x27;s &amp; more`
      )
    );

    const { req, res } = createMocks({ method: HTTP_METHOD.GET, query: { lang: 'en' } });
    await listHandler(req, res);

    const { posts } = JSON.parse(res._getData());
    const {title} = posts.find((p: { id: string }) => p.id === postId);
    // Entities decoded to real characters — no literal &quot; leaks to the UI.
    expect(title).toBe('"Title" it\'s & more');
    expect(title).not.toContain('&quot;');
    expect(title).not.toContain('&#x27;');
  });

  it("decodes entities in a details title but leaves the HTML body intact", async () => {
    const postId = await seedPost();
    mockedTranslateHtml.mockImplementation((text: string) => {
      if (text === '') return Promise.resolve('');
      // Body carries real tags that must survive; short fields carry entities.
      return Promise.resolve(
        text.includes('<p>') ? '<p>Body &amp; tags</p>' : `A &quot;quoted&quot; title`
      );
    });

    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      query: { id: postId, lang: 'en' },
    });
    await detailsHandler(req, res);

    const { post } = JSON.parse(res._getData());
    expect(post.title).toBe('A "quoted" title'); // decoded
    expect(post.content).toBe('<p>Body &amp; tags</p>'); // HTML left as-is
  });
});

describe('POST /api/admin/translate/warm', () => {
  async function seedAdmin() {
    const hash = await bcrypt.hash('pass', 10);
    await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
    await User.create({
      name: 'Plain',
      email: 'plain@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'user',
    });
  }

  it('401 without a JWT', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });
    await warmHandler(req, res);
    expect(res._getStatusCode()).toBe(HTTP.UNAUTHORIZED);
  });

  it('403 for a non-admin JWT', async () => {
    await seedAdmin();
    const user = await User.findOne({ email: 'plain@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(user!._id, 'user') },
    });
    await warmHandler(req, res);
    expect(res._getStatusCode()).toBe(HTTP.FORBIDDEN);
  });

  it('405 for non-POST', async () => {
    await seedAdmin();
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await warmHandler(req, res);
    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });

  it('400 for lang=ru (the original is never translated)', async () => {
    await seedAdmin();
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      query: { lang: 'ru' },
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await warmHandler(req, res);
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  // Waits for the detached background warm to finish (the endpoint runs it
  // fire-and-forget, so the row isn't written by the time the handler returns).
  async function flushBackgroundWarm() {
    // Poll the module flag; the mocked provider resolves on microtasks so this
    // clears within a couple of ticks. Bounded so a bug can't hang the suite.
    return Array.from({ length: 50 }).reduce<Promise<void>>(async (acc) => {
      await acc;
      if (!isWarmupRunning()) return undefined;
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      return undefined;
    }, Promise.resolve());
  }

  it('an admin starts a detached warm (202) that warms the cache', async () => {
    await seedAdmin();
    const postId = await seedPost();
    const admin = await User.findOne({ email: 'admin@test.com' });

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await warmHandler(req, res);

    // 202 Accepted — the warm runs in the background, not inline.
    expect(res._getStatusCode()).toBe(HTTP.ACCEPTED);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.started).toBe(true);
    expect(body.data.mode).toBe('summary');

    // Let the detached run complete, then assert it warmed the cache.
    await flushBackgroundWarm();
    expect((await readRows(postId))[0].scope).toBe('summary');
  });

  it('mode=full over the endpoint warms a full (body) row', async () => {
    await seedAdmin();
    const postId = await seedPost();
    const admin = await User.findOne({ email: 'admin@test.com' });

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      query: { mode: 'full' },
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await warmHandler(req, res);
    expect(res._getStatusCode()).toBe(HTTP.ACCEPTED);
    expect(JSON.parse(res._getData()).data.mode).toBe('full');

    await flushBackgroundWarm();
    const rows = await readRows(postId);
    expect(rows[0].scope).toBe('full');
    expect(rows[0].content).toBe('[EN] <p>Содержимое тела</p>');
  });
});
