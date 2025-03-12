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
    // Мокаем req.user для тестов
    if (req.headers.authorization) {
      req.user = { _id: req.headers.userid as string };
    }
    return handler(req, res);
  }),
}));

// Import handler only after mocks
const handler = require('@/src/pages/api/post/update').default;

describe('PUT /api/post/update', () => {
  let userId: string;
  let postId: string;
  let token: string;

  beforeEach(async () => {
    // Очистка коллекций перед каждым тестом
    await Post.deleteMany({});
    await User.deleteMany({});

    // Создаем тестового пользователя
    const passwordHash = await bcrypt.hash('password123', 10);
    const user = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      isEmailVerified: true,
    });

    userId = user._id?.toString() || '';
    token = jwt.sign({ userId }, process.env.JWT_SECRET || 'secret123');

    // Создаем тестовый пост
    const post = await Post.create({
      title: 'Original Title',
      description: 'Original Description',
      content: 'Original Content',
      userId,
      author: {
        name: 'Test User',
        avatarUrl: 'http://test.com/avatar.jpg',
      },
      comments: [],
    });

    postId = post._id?.toString() || '';
  });

  it('should update a post successfully', async () => {
    const { req, res } = createMocks({
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId,
      },
      body: {
        postId,
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.post).toBeDefined();
    expect(data.post.title).toBe('Updated Title');
    expect(data.post.description).toBe('Updated Description');
    expect(data.post.content).toBe('Updated Content');

    // Проверяем, что изменения сохранились в БД
    const updatedPost = await Post.findById(postId);
    expect(updatedPost).toBeDefined();
    expect(updatedPost?.title).toBe('Updated Title');
  });

  it('should return 400 if post ID is missing', async () => {
    const { req, res } = createMocks({
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId,
      },
      body: {
        // postId отсутствует
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 404 if post not found', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();
    
    const { req, res } = createMocks({
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        userid: userId,
      },
      body: {
        postId: nonExistentId,
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 401 if not authenticated', async () => {
    const { req, res } = createMocks({
      method: 'PUT',
      headers: {
        // Нет токена авторизации
      },
      body: {
        postId,
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });

  it('should return 403 if user is not the author', async () => {
    // Создаем другого пользователя
    const anotherUserPasswordHash = await bcrypt.hash('password456', 10);
    const anotherUser = await User.create({
      name: 'Another User',
      email: 'another@example.com',
      passwordHash: anotherUserPasswordHash,
      isEmailVerified: true,
    });
    
    const anotherUserId = anotherUser._id?.toString() || '';
    const anotherToken = jwt.sign({ userId: anotherUserId }, process.env.JWT_SECRET || 'secret123');

    const { req, res } = createMocks({
      method: 'PUT',
      headers: {
        authorization: `Bearer ${anotherToken}`,
        userid: anotherUserId,
      },
      body: {
        postId,
        title: 'Updated Title',
        description: 'Updated Description',
        content: 'Updated Content',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(403);
    const data = JSON.parse(res._getData());
    expect(data.message).toBeDefined();
  });
});
