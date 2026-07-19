import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/search';
import { HTTP_METHOD } from '@/src/constants/http';
import { SEARCH_RESULTS_LIMIT } from '@/src/services/post';

const OWNER_ID = '7060694b2c21843bf8307f99';

async function seedUser() {
  const passwordHash = await bcrypt.hash('pw', 10);
  await User.create({ _id: OWNER_ID, name: 'Owner', email: 'owner@example.com', passwordHash });
}

function searchRequest(query: Record<string, string>) {
  return createMocks({ method: HTTP_METHOD.GET, query });
}

describe('GET /api/post/search — payload hygiene', () => {
  beforeEach(seedUser);

  it('strips content from results — list payloads never ship full bodies', async () => {
    await Post.create({
      title: 'AI статья',
      content: '<p>SECRET_FULL_BODY</p>',
      publish: 'published',
      userId: OWNER_ID,
      author: { name: 'Owner' },
    });

    const { req, res } = searchRequest({ query: 'AI' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { results } = res._getJSONData();
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty('content');
    expect(JSON.stringify(results)).not.toContain('SECRET_FULL_BODY');
  });

  it(`caps results at ${SEARCH_RESULTS_LIMIT} and returns newest first`, async () => {
    const total = SEARCH_RESULTS_LIMIT + 3;
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        Post.create({
          title: `Пост про модели №${i}`,
          publish: 'published',
          userId: OWNER_ID,
          author: { name: 'Owner' },
        })
      )
    );
    // INSERT не задаёт created_at (дефолт now()) — метки одинаковые.
    // Разносим их напрямую, чтобы порядок был детерминированным: №i = i-й день.
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        dbQuery(`UPDATE posts SET created_at = $1 WHERE title = $2`, [
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          `Пост про модели №${i}`,
        ])
      )
    );

    const { req, res } = searchRequest({ query: 'модели' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const { results } = res._getJSONData();
    expect(results).toHaveLength(SEARCH_RESULTS_LIMIT);
    // Newest first: пост №(total-1) создан последним и должен открывать выдачу.
    expect(results[0].title).toBe(`Пост про модели №${total - 1}`);
  });

  it('keeps drafts out of the public path', async () => {
    await Post.create({
      title: 'Черновик про модели',
      publish: 'draft',
      userId: OWNER_ID,
      author: { name: 'Owner' },
    });

    const { req, res } = searchRequest({ query: 'модели' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().results).toHaveLength(0);
  });
});
