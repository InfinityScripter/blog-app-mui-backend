import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import uuidv4 from '@/src/utils/uuidv4';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/[id]/edit';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

describe('PATCH /api/post/[id]/edit', () => {
  let userId: string;
  let postId: string;
  let token: string;

  beforeEach(async () => {
    await Post.deleteMany({});
    await User.deleteMany({});

    const user = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      passwordHash: 'x',
      isEmailVerified: true,
    });
    userId = user._id?.toString() || '';
    token = jwt.sign({ userId, role: 'user' }, JWT_SECRET);

    const post = await Post.create({
      title: 'Original Title',
      description: 'Original Description',
      content: 'Original Content',
      userId,
      author: { name: 'Test User', avatarUrl: 'http://test.com/avatar.jpg' },
      comments: [],
    });
    postId = post._id?.toString() || '';
  });

  it('updates a post successfully', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: { authorization: `Bearer ${token}` },
      query: { id: postId },
      body: {
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.OK);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);
    expect(data.post.title).toBe('Updated Title');

    const updatedPost = await Post.findById(postId);
    expect(updatedPost?.title).toBe('Updated Title');
    expect(updatedPost?.description).toBe('Updated Description');
  });

  it('returns 400 when post id is missing', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: { authorization: `Bearer ${token}` },
      query: {},
      body: { title: 'Updated Title' },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('returns 404 when the post does not exist', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: { authorization: `Bearer ${token}` },
      query: { id: uuidv4() },
      body: { title: 'Updated Title' },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.NOT_FOUND);
  });

  it('returns 401 without a token', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      query: { id: postId },
      body: { title: 'Updated Title' },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.UNAUTHORIZED);
  });

  it('returns 403 when the user is not the author', async () => {
    const anotherUser = await User.create({
      name: 'Another User',
      email: 'another@example.com',
      passwordHash: 'x',
      isEmailVerified: true,
    });
    const anotherToken = jwt.sign(
      { userId: anotherUser._id?.toString(), role: 'user' },
      JWT_SECRET
    );

    const { req, res } = createMocks({
      method: HTTP_METHOD.PATCH,
      headers: { authorization: `Bearer ${anotherToken}` },
      query: { id: postId },
      body: { title: 'Updated Title' },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.FORBIDDEN);
  });

  it('returns 405 for non-PATCH/PUT methods', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: `Bearer ${token}` },
      query: { id: postId },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });
});
