import { createMocks } from 'node-mocks-http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import handler from '@/src/pages/api/post/new';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import '@jest/globals';

jest.mock('@/src/lib/db', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

describe('POST /api/post/new', () => {
  beforeEach(async () => {
    // Create a test user with passwordHash to satisfy validation
    const passwordHash = await bcrypt.hash('testpassword', 10);
    await User.create({
      _id: new mongoose.Types.ObjectId('6060694b2c21843bf8307f43'),
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      avatarURL: 'http://example.com/avatar.jpg',
    });
  });

  it('should create a new post with valid token and data', async () => {
    const token = jwt.sign({ userId: '6060694b2c21843bf8307f43' }, process.env.JWT_SECRET || 'secret123');
    
    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
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
        coverUrl: 'http://example.com/cover.jpg'
      }
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

  it('should return 401 with invalid token', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid_token'
      },
      body: {
        title: 'Test Post Title'
      }
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('should return 401 with missing token', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        title: 'Test Post Title'
      }
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('should return 405 for non-POST methods', async () => {
    const { req, res } = createMocks({
      method: 'GET'
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});
