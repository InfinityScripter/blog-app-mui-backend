import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/post/[id]/publish';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';

// The publish toggle had no HTTP-level tests at all; pinned here: the happy
// path on both accepted verbs, ownership, the method gate (GET used to mutate
// before the withMethods fix) and the zod boundary.
describe('/api/post/[id]/publish', () => {
  let userId: string;
  let postId: string;
  let token: string;

  beforeEach(async () => {
    await Post.deleteMany({});
    await User.deleteMany({});
    const user = await User.create({
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'x',
      isEmailVerified: true,
    });
    userId = user._id?.toString() || '';
    token = jwt.sign({ userId, role: 'user' }, JWT_SECRET);
    const post = await Post.create({
      title: 'Draft post',
      description: 'D',
      content: 'C',
      publish: 'draft',
      userId,
      author: { name: 'Owner', avatarUrl: null },
      comments: [],
    });
    postId = post._id?.toString() || '';
  });

  function call(method: string, body: Record<string, unknown>, authToken = token) {
    const { req, res } = createMocks({
      method: method as never,
      headers: { authorization: `Bearer ${authToken}` },
      query: { id: postId },
      body,
    });
    return handler(req as never, res as never).then(() => res);
  }

  it('publishes a draft via POST', async () => {
    const res = await call(HTTP_METHOD.POST, { publish: 'published' });
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const post = await Post.findById(postId);
    expect(post?.publish).toBe('published');
  });

  it('unpublishes via PATCH', async () => {
    await call(HTTP_METHOD.POST, { publish: 'published' });
    const res = await call(HTTP_METHOD.PATCH, { publish: 'draft' });
    expect(res._getStatusCode()).toBe(HTTP.OK);
    const post = await Post.findById(postId);
    expect(post?.publish).toBe('draft');
  });

  it('rejects GET with 405 and does not mutate', async () => {
    const res = await call(HTTP_METHOD.GET, { publish: 'published' });
    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    const post = await Post.findById(postId);
    expect(post?.publish).toBe('draft');
  });

  it('rejects an invalid publish value with 400', async () => {
    const res = await call(HTTP_METHOD.POST, { publish: 'archived' });
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it("returns 403 for another user's post", async () => {
    const intruder = await User.create({
      name: 'Intruder',
      email: 'intruder@example.com',
      passwordHash: 'x',
      isEmailVerified: true,
    });
    const intruderToken = jwt.sign({ userId: intruder._id?.toString(), role: 'user' }, JWT_SECRET);
    const res = await call(HTTP_METHOD.POST, { publish: 'published' }, intruderToken);
    expect(res._getStatusCode()).toBe(HTTP.FORBIDDEN);
    const post = await Post.findById(postId);
    expect(post?.publish).toBe('draft');
  });
});
