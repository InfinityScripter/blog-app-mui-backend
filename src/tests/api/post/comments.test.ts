import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/[id]/comments';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

// HTTP-level coverage of the comments route (the service has its own tests).
// Pinned here: the zod boundary rejects garbage, but stays exactly as
// null-tolerant as the pre-zod handler — clients serialize "absent" as
// explicit null ({ parentCommentId: null } for a top-level comment).
describe('/api/post/[id]/comments', () => {
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
      title: 'Post',
      description: 'D',
      content: 'C',
      userId,
      author: { name: 'Test User', avatarUrl: null },
      comments: [],
    });
    postId = post._id?.toString() || '';
  });

  function call(method: string, body: Record<string, unknown>) {
    const { req, res } = createMocks({
      method: method as never,
      headers: { authorization: `Bearer ${token}` },
      query: { id: postId },
      body,
    });
    return handler(req as never, res as never).then(() => res);
  }

  it('adds a top-level comment when parentCommentId is an explicit null', async () => {
    const res = await call(HTTP_METHOD.POST, {
      message: 'Первый!',
      parentCommentId: null,
      tagUser: null,
    });
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const post = await Post.findById(postId);
    expect(post?.comments).toHaveLength(1);
    expect(post?.comments[0].message).toBe('Первый!');
  });

  it('rejects an empty message with 400 before the service runs', async () => {
    const res = await call(HTTP_METHOD.POST, { message: '   ' });
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    expect(res._getJSONData().success).toBe(false);
    const post = await Post.findById(postId);
    expect(post?.comments).toHaveLength(0);
  });

  it('rejects a non-string message with 400', async () => {
    const res = await call(HTTP_METHOD.POST, { message: 42 });
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('edits a comment (isReply null tolerated)', async () => {
    await call(HTTP_METHOD.POST, { message: 'Оригинал' });
    const created = await Post.findById(postId);
    const commentId = created!.comments[0].id;

    const res = await call(HTTP_METHOD.PUT, {
      commentId,
      message: 'Исправлено',
      isReply: null,
      parentCommentId: null,
    });
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const post = await Post.findById(postId);
    expect(post?.comments[0].message).toBe('Исправлено');
  });

  it('deletes a comment', async () => {
    await call(HTTP_METHOD.POST, { message: 'Удали меня' });
    const created = await Post.findById(postId);
    const commentId = created!.comments[0].id;

    const res = await call(HTTP_METHOD.DELETE, { commentId, isReply: null });
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const post = await Post.findById(postId);
    expect(post?.comments).toHaveLength(0);
  });

  it('returns 405 for GET', async () => {
    const res = await call(HTTP_METHOD.GET, {});
    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });
});
