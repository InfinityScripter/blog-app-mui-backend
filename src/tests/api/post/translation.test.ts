import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import detailsHandler from '@/src/pages/api/post/details';
import { translationProvider } from '@/src/utils/translate';

// Mock the translation provider so no real DeepL request is made. Each field is
// echoed with an [EN] prefix, so a translated response is easy to assert.
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
  content: '<p>Содержимое</p>',
};

async function seedPost() {
  const passwordHash = await bcrypt.hash('pw', 10);
  await User.create({ _id: OWNER_ID, name: 'Owner', email: 'owner@example.com', passwordHash });
  const post = await Post.create({
    ...ORIGINAL,
    publish: 'published',
    userId: OWNER_ID,
    author: { name: 'Owner' },
  });
  return post._id?.toString() || '';
}

function detailsRequest(id: string, query: Record<string, string> = {}) {
  return createMocks({ method: HTTP_METHOD.GET, query: { id, ...query } });
}

async function readTranslationRows(postId: string) {
  const result = await dbQuery<{
    post_id: string;
    lang: string;
    title: string;
    description: string;
    content: string;
    status: string;
  }>(
    'SELECT post_id, lang, title, description, content, status FROM post_translations WHERE post_id = $1',
    [postId]
  );
  return result.rows;
}

beforeEach(() => {
  mockedTranslateHtml.mockClear();
});

describe('GET /api/post/details — i18n (lang=en)', () => {
  it('translates fields and upserts a post_translations row on first en read', async () => {
    const postId = await seedPost();

    const { req, res } = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    const { post } = JSON.parse(res._getData());
    expect(post.title).toBe('[EN] Заголовок');
    expect(post.description).toBe('[EN] Описание');
    expect(post.content).toBe('[EN] <p>Содержимое</p>');
    // id stays the original id.
    expect(post.id).toBe(postId);

    const rows = await readTranslationRows(postId);
    expect(rows).toHaveLength(1);
    expect(rows[0].lang).toBe('en');
    expect(rows[0].status).toBe('ok');
    expect(rows[0].title).toBe('[EN] Заголовок');
  });

  it('serves a cache hit on the second identical en read (provider called once)', async () => {
    const postId = await seedPost();

    const first = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(first.req, first.res);
    // 3 fields (title, description, content) translated on the cold read.
    expect(mockedTranslateHtml).toHaveBeenCalledTimes(3);

    mockedTranslateHtml.mockClear();

    const second = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(second.req, second.res);

    // No further provider calls — the fresh cache row is served.
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    const { post } = JSON.parse(second.res._getData());
    expect(post.title).toBe('[EN] Заголовок');
  });

  it('falls back to the original fields (still 200) when the provider throws', async () => {
    const postId = await seedPost();
    mockedTranslateHtml.mockRejectedValueOnce(new Error('DeepL down'));

    const { req, res } = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(req, res);

    // Read never fails because of a translation error.
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const { post } = JSON.parse(res._getData());
    expect(post.title).toBe(ORIGINAL.title);
    expect(post.description).toBe(ORIGINAL.description);
    expect(post.content).toBe(ORIGINAL.content);

    // Best-effort error row recorded.
    const rows = await readTranslationRows(postId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
  });

  it('returns original fields and writes no row for lang=ru', async () => {
    const postId = await seedPost();

    const { req, res } = detailsRequest(postId, { lang: 'ru' });
    await detailsHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    const { post } = JSON.parse(res._getData());
    expect(post.title).toBe(ORIGINAL.title);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    expect(await readTranslationRows(postId)).toHaveLength(0);
  });

  it('returns original fields and writes no row when lang is absent', async () => {
    const postId = await seedPost();

    const { req, res } = detailsRequest(postId);
    await detailsHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    const { post } = JSON.parse(res._getData());
    expect(post.title).toBe(ORIGINAL.title);
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
    expect(await readTranslationRows(postId)).toHaveLength(0);
  });

  it('re-translates after the source changes (stale hash → provider called again)', async () => {
    const postId = await seedPost();

    const first = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(first.req, first.res);
    mockedTranslateHtml.mockClear();

    // Edit the source post — the source_hash no longer matches the cached row.
    const post = await Post.findById(postId);
    if (post) {
      post.title = 'Новый заголовок';
      await post.save();
    }

    const second = detailsRequest(postId, { lang: 'en' });
    await detailsHandler(second.req, second.res);

    // Stale cache → provider re-invoked, new translation served + cached.
    expect(mockedTranslateHtml).toHaveBeenCalled();
    const { post: body } = JSON.parse(second.res._getData());
    expect(body.title).toBe('[EN] Новый заголовок');
    const rows = await readTranslationRows(postId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('[EN] Новый заголовок');
  });
});
