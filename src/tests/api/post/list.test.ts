import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/list';
import { HTTP_METHOD } from '@/src/constants/http';

const OWNER_ID = '7060694b2c21843bf8307f99';

async function seed() {
  const passwordHash = await bcrypt.hash('pw', 10);
  await User.create({ _id: OWNER_ID, name: 'Owner', email: 'owner@example.com', passwordHash });

  await Post.create({
    title: 'Новость дня',
    publish: 'published',
    tags: ['новости', 'политика'],
    userId: OWNER_ID,
    author: { name: 'Owner' },
  });
  await Post.create({
    title: 'AI статья',
    publish: 'published',
    tags: ['AI/LLM', 'Агенты'],
    userId: OWNER_ID,
    author: { name: 'Owner' },
  });
  await Post.create({
    title: 'Черновик',
    publish: 'draft',
    tags: ['новости'],
    userId: OWNER_ID,
    author: { name: 'Owner' },
  });
}

function listRequest(query: Record<string, string> = {}) {
  return createMocks({ method: HTTP_METHOD.GET, query });
}

describe('GET /api/post/list — tag filter', () => {
  beforeEach(seed);

  it('returns all published posts when no tag is given', async () => {
    const { req, res } = listRequest();
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { posts } = JSON.parse(res._getData());
    const titles = posts.map((p: { title: string }) => p.title).sort();
    expect(titles).toEqual(['AI статья', 'Новость дня']); // draft excluded for anon
  });

  it('returns only posts carrying the requested tag', async () => {
    const { req, res } = listRequest({ tag: 'новости' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { posts } = JSON.parse(res._getData());
    // Anonymous → published only, AND tagged 'новости' → just the published news post.
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe('Новость дня');
  });

  it('returns an empty list for a tag no post carries', async () => {
    const { req, res } = listRequest({ tag: 'спорт' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { posts } = JSON.parse(res._getData());
    expect(posts).toHaveLength(0);
  });

  it('excludeTag drops posts carrying that tag (news hidden from the blog)', async () => {
    const { req, res } = listRequest({ excludeTag: 'новости' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { posts } = JSON.parse(res._getData());
    const titles = posts.map((p: { title: string }) => p.title);
    // Published, non-news posts only — the news post is excluded.
    expect(titles).toEqual(['AI статья']);
  });
});

describe('GET /api/post/list — pagination (opt-in)', () => {
  beforeEach(seed);

  it('no page/limit → full array, no pagination metadata', async () => {
    const { req, res } = listRequest();
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // Anonymous sees 2 published posts; default path stays a bare { posts }.
    expect(body.posts).toHaveLength(2);
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('hasMore');
  });

  it('page 1 limit 1 → 1 item, total 2, hasMore true', async () => {
    const { req, res } = listRequest({ page: '1', limit: '1' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.posts).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it('last page → hasMore false', async () => {
    const { req, res } = listRequest({ page: '2', limit: '1' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.posts).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);
  });

  it('over-max limit clamps to 100 (still returns available rows + metadata)', async () => {
    const { req, res } = listRequest({ page: '1', limit: '9999' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // Clamp doesn't drop rows here (only 2 exist); metadata present, hasMore false.
    expect(body.posts).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);
  });
});

describe('GET /api/post/list — over-max limit is clamped to MAX (100)', () => {
  // Seed more than MAX_LIMIT rows so the clamp is observable: with 101 rows an
  // unclamped limit=9999 would return all 101, while the clamp caps page 1 at 100.
  beforeEach(async () => {
    await User.create({
      _id: OWNER_ID,
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'x',
    });
    await Array.from({ length: 101 }).reduce(async (prev, _unused, i) => {
      await prev;
      await Post.create({
        title: `Post ${i}`,
        publish: 'published',
        userId: OWNER_ID,
        author: { name: 'Owner' },
      });
    }, Promise.resolve());
  });

  it('limit=9999 returns exactly MAX (100) rows on page 1, with total reflecting all matches', async () => {
    const { req, res } = listRequest({ page: '1', limit: '9999' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    // Clamp caps the page at 100 even though 101 rows match and 9999 was requested.
    expect(body.posts).toHaveLength(100);
    expect(body.total).toBe(101);
    // 100 < 101 → one more row remains past the clamped page.
    expect(body.hasMore).toBe(true);
  });
});
