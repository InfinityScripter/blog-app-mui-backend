import '@jest/globals';
import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/list';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

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
  return createMocks({ method: 'GET', query });
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
