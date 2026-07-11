import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import handler from '@/src/pages/api/admin/posts/[id]';

function adminToken(userId: string) {
  return `Bearer ${jwt.sign({ userId, role: 'admin' }, JWT_SECRET)}`;
}

describe('PUT /api/admin/posts/[id] — mass-assignment guard', () => {
  let adminId: string;
  let ownerId: string;
  let postId: string;

  beforeEach(async () => {
    await User.deleteMany({});
    await Post.deleteMany();
    const hash = await import('bcrypt').then((b) => b.hash('pass', 10));
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
    adminId = admin._id;
    const owner = await User.create({
      name: 'Owner',
      email: 'owner@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'user',
    });
    const post = await Post.create({
      title: 'Original',
      userId: owner._id,
      publish: 'draft',
      author: { name: 'Owner' },
      totalViews: 5,
    });
    postId = String(post._id);
    ownerId = owner._id;
  });

  it('updates whitelisted fields (title, publish) but ignores userId/_id (no reassignment)', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PUT,
      query: { id: postId },
      headers: { authorization: adminToken(adminId) },
      body: {
        title: 'Edited',
        publish: 'published',
        // Malicious extras that must NOT be written:
        userId: 'attacker',
        _id: 'forged-id',
        createdAt: '2000-01-01T00:00:00.000Z',
      },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const saved = await Post.findById(postId);
    expect(saved!.title).toBe('Edited');
    expect(saved!.publish).toBe('published');
    // Ownership + identity are NOT reassignable via the body.
    expect(saved!.userId).toBe(ownerId);
    expect(String(saved!._id)).toBe(postId);
  });

  it('returns 404 for a missing post', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.PUT,
      query: { id: 'does-not-exist' },
      headers: { authorization: adminToken(adminId) },
      body: { title: 'x' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);
  });
});
