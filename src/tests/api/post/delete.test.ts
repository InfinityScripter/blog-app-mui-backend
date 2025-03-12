import { createMocks } from 'node-mocks-http';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { NextApiRequest, NextApiResponse } from 'next';
import '@jest/globals';

import User from '@/src/models/User';
import { Post } from '@/src/models/Post';

jest.mock('@/src/lib/db', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));
jest.mock('@/src/utils/auth', () => ({
  requireAuth: jest.fn((handler) => async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.headers.authorization) {
      // Используем непосредственно userId из headers, это будет строковый ID из MongoDB
      req.user = { _id: req.headers.userid as string };
    }
    return handler(req, res);
  }),
}));

// Import handler only after mocks
const handler = require('@/src/pages/api/post/delete').default;

describe('DELETE /api/post/delete', () => {
  let userId: string;
  let postId: string;
  let token: string;

  beforeEach(async () => {
    await Post.deleteMany({});
    await User.deleteMany({});

    const passwordHash = await bcrypt.hash('password123', 10);
    const user = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      isEmailVerified: true,
    });

    userId = user._id?.toString() || '';
    token = jwt.sign({ userId }, process.env.JWT_SECRET || 'secret123');

    const post = await Post.create({
      title: 'Test Post',
      description: 'Test Description',
      content: 'Test Content',
      userId,
      author: {
        name: 'Test User',
        avatarUrl: 'http://test.com/avatar.jpg',
      },
      comments: [],
    });

    postId = post._id?.toString() || '';
  });

  it('should delete a post successfully', async () => {
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId, // Изменили с userId на userid (lowercase)
      },
      query: {
        postId,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.success).toBe(true);

    // Проверяем, что пост удален из БД
    const deletedPost = await Post.findById(postId);
    expect(deletedPost).toBeNull();
  });

  it('should return 400 if post ID is missing', async () => {
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId, // Изменили с userId на userid (lowercase)
      },
      query: {
        // postId отсутствует
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 404 if post does not exist', async () => {
    const nonExistentPostId = new mongoose.Types.ObjectId().toString();
    
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId, // Изменили с userId на userid (lowercase)
      },
      query: {
        postId: nonExistentPostId,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 401 if not authenticated', async () => {
    const { req, res } = createMocks({
      method: 'DELETE',
      headers: {
        // Нет токена авторизации
      },
      query: {
        postId,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 403 if user is not the author', async () => {
    // Создаем другого пользователя
    const anotherUser = await User.create({
      name: 'Another User',
      email: 'another@example.com',
      passwordHash: await bcrypt.hash('password123', 10),
      isEmailVerified: true,
    });
    
    const anotherUserId = anotherUser._id?.toString() || '';
    const anotherToken = jwt.sign({ userId: anotherUserId }, process.env.JWT_SECRET || 'secret123');

    const { req, res } = createMocks({
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${anotherToken}`,
        userid: anotherUserId,
      },
      query: {
        postId,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 405 for non-DELETE methods', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        postId,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Method not allowed');
  });
});
