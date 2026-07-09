import '@jest/globals';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/latest';
import { HTTP_METHOD } from '@/src/constants/http';

const OWNER_ID = '7060694b2c21843bf8307f99';

function latestRequest(query: Record<string, string>) {
  return createMocks({ method: HTTP_METHOD.GET, query });
}

describe('GET /api/post/latest', () => {
  beforeEach(async () => {
    await Post.deleteMany();
    await User.deleteMany({});
    await User.create({ _id: OWNER_ID, name: 'Owner', email: 'owner@e.com', passwordHash: 'x' });
    // Five published + one draft. Titles are simple ASCII so paramCase slugs are
    // predictable ("post-1" … "post-6").
    await Array.from({ length: 5 }).reduce(async (prev, _unused, i) => {
      await prev;
      await Post.create({
        title: `Post ${i + 1}`,
        publish: 'published',
        userId: OWNER_ID,
        author: { name: 'Owner' },
      });
    }, Promise.resolve());
    await Post.create({
      title: 'Draft Post',
      publish: 'draft',
      userId: OWNER_ID,
      author: { name: 'Owner' },
    });
  });

  it('returns at most 4 posts and never the draft', async () => {
    const { req, res } = latestRequest({ title: 'nonexistent-slug' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { latestPosts } = JSON.parse(res._getData());
    expect(latestPosts.length).toBeLessThanOrEqual(4);
    expect(latestPosts.every((p: { publish: string }) => p.publish === 'published')).toBe(true);
    expect(latestPosts.some((p: { title: string }) => p.title === 'Draft Post')).toBe(false);
  });

  it('excludes the post whose title-slug matches the query', async () => {
    // "Post 1" → paramCase → "post-1".
    const { req, res } = latestRequest({ title: 'post-1' });
    await handler(req, res);
    const { latestPosts } = JSON.parse(res._getData());
    expect(latestPosts.some((p: { title: string }) => p.title === 'Post 1')).toBe(false);
  });

  it('400 when title is missing', async () => {
    const { req, res } = latestRequest({});
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });
});
