import { createMocks } from 'node-mocks-http';
import bcrypt from 'bcrypt';
import handler from '@/src/pages/api/auth/sign-in';
import User from '@/src/models/User';
import jwt from 'jsonwebtoken';
import '@jest/globals';

jest.mock('@/src/lib/db', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

describe('POST /api/auth/sign-in', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    
    // Create a test user with valid passwordHash
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      isEmailVerified: true
    });
  });

  it('should authenticate a user with valid credentials and return 200 status', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'test@example.com',
        password: 'password123'
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    
    const data = JSON.parse(res._getData());
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.name).toBe('Test User');
    
    // Verify JWT token is valid
    const decodedToken = jwt.verify(data.accessToken, process.env.JWT_SECRET || 'secret123') as { userId: string };
    expect(decodedToken.userId).toBe(data.user._id.toString());
  });

  it('should return 400 for incorrect password', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'test@example.com',
        password: 'wrongpassword'
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Wrong email or password');
  });

  it('should return 400 for non-existent email', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'nonexistent@example.com',
        password: 'password123'
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Wrong email or password');
  });

  it('should return 400 if email or password is missing', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        // Missing email and password
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Missing email or password');
  });

  it('should return 405 for non-POST methods', async () => {
    const { req, res } = createMocks({
      method: 'GET'
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Method not allowed');
  });
});
