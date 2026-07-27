import '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/new';
import { HTTP_METHOD } from '@/src/constants/http';

describe('POST /api/post/new', () => {
  beforeEach(async () => {
    // Create a test user with passwordHash to satisfy validation
    const passwordHash = await bcrypt.hash('testpassword', 10);
    await User.create({
      _id: '6060694b2c21843bf8307f43',
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      avatarURL: 'http://example.com/avatar.jpg',
    });
  });

  it('should create a new post with valid token and data', async () => {
    const token = jwt.sign(
      { userId: '6060694b2c21843bf8307f43' },
      process.env.JWT_SECRET || 'secret123'
    );

    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: {
        title: 'Test Post Title',
        description: 'Test description',
        content: 'Test content',
        publish: 'published',
        tags: 'tag1,tag2',
        metaTitle: 'Test Meta Title',
        metaDescription: 'Test Meta Description',
        metaKeywords: 'key1,key2',
        coverUrl: 'http://example.com/cover.jpg',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const responseData = JSON.parse(res._getData());
    expect(responseData.success).toBe(true);
    expect(responseData.post).toBeDefined();
    expect(responseData.post.title).toBe('Test Post Title');
    expect(responseData.post.author.name).toBe('Test User');

    // Verify the post was actually saved in the database
    const post = await Post.findById(responseData.post._id);
    expect(post).toBeDefined();
    expect(post?.title).toBe('Test Post Title');
  });

  it('assigns a different cover to each coverless post', async () => {
    // The regression this guards: the news bot publishes imageless items without
    // a coverUrl, and every such post used to land on a repeating stock photo.
    delete process.env.UNSPLASH_ACCESS_KEY;
    const token = jwt.sign(
      { userId: '6060694b2c21843bf8307f43' },
      process.env.JWT_SECRET || 'secret123'
    );

    const covers: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: { title: `Новость ${i}`, tags: 'ai,новости', publish: 'published' },
      });
      // eslint-disable-next-line no-await-in-loop
      await handler(req, res);
      expect(res._getStatusCode()).toBe(201);
      covers.push(JSON.parse(res._getData()).post.coverUrl);
    }

    expect(new Set(covers).size).toBe(covers.length);
    covers.forEach((cover) => expect(cover).toBeTruthy());
  });

  it('should return 401 with invalid token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid_token',
      },
      body: {
        title: 'Test Post Title',
      },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('should return 401 with missing token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        title: 'Test Post Title',
      },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('answers immediately while api.unsplash.com is unreachable', async () => {
    // Regression guard for the change that took Unsplash off the publish path.
    // Before it, this exact scenario cost the caller the full fetch timeout
    // (measured 3.0s, and 8.0s before the budget was cut) on EVERY publish
    // without its own cover — the dashboard button and every bot post alike.
    process.env.UNSPLASH_ACCESS_KEY = 'test-key';
    const realFetch = global.fetch;
    const calls: string[] = [];
    global.fetch = jest.fn((url: string, init?: { signal?: AbortSignal }) => {
      calls.push(String(url));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('TimeoutError')));
      });
    }) as unknown as typeof fetch;

    try {
      const token = jwt.sign(
        { userId: '6060694b2c21843bf8307f43' },
        process.env.JWT_SECRET || 'secret123'
      );
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // No coverUrl — this is the path that used to reach out to Unsplash.
        body: { title: 'Пост без обложки', content: 'c', publish: 'draft', tags: 'ai' },
      });

      const started = Date.now();
      await handler(req, res);
      const elapsed = Date.now() - started;

      expect(res._getStatusCode()).toBe(201);
      expect(elapsed).toBeLessThan(1_000);
      expect(calls).toHaveLength(0);
      // The post still leaves with a real cover, not a blank one.
      expect(JSON.parse(res._getData()).post.coverUrl).toBeTruthy();
    } finally {
      global.fetch = realFetch;
      delete process.env.UNSPLASH_ACCESS_KEY;
    }
  });

  it('should return 405 for non-POST methods', async () => {
    // requireAuth runs first, so an authenticated request is needed to reach
    // the method check.
    const token = jwt.sign(
      { userId: '6060694b2c21843bf8307f43', role: 'user' },
      process.env.JWT_SECRET || 'secret123'
    );
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { Authorization: `Bearer ${token}` },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});
