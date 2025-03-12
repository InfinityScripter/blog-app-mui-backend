import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/auth/sign-up';
import User from '@/src/models/User';
import jwt from 'jsonwebtoken';
import '@jest/globals';

jest.mock('@/src/lib/db', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));
jest.mock('@/src/utils/email', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(true),
}));

describe('POST /api/auth/sign-up', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await User.deleteMany({});
  });

  it('should create a new user and return 201 status', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    
    const data = JSON.parse(res._getData());
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.name).toBe('Test User');
    expect(data.user.isEmailVerified).toBe(false);
    
    // Verify JWT token is valid
    const decodedToken = jwt.verify(data.accessToken, process.env.JWT_SECRET || 'secret123') as { userId: string };
    expect(decodedToken.userId).toBe(data.user.id);
    
    // Verify user is saved in the database (select fields explicitly to get emailVerificationCode)
    const savedUser = await User.findOne({ email: 'test@example.com' })
      .select('+emailVerificationCode');
    
    expect(savedUser).toBeTruthy();
    expect(savedUser?.name).toBe('Test User');
    expect(savedUser?.isEmailVerified).toBe(false);
    expect(savedUser?.emailVerificationCode).toBeDefined();
    expect(savedUser?.emailVerificationCode?.length).toBe(6); // Should be a 6-digit code
  });

  it('should return 400 if email already exists', async () => {
    // First create a user
    await User.create({
      name: 'Existing User',
      email: 'existing@example.com',
      passwordHash: 'hashedpassword',
    });

    // Try to create user with same email
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'existing@example.com',
        password: 'password123',
        firstName: 'Another',
        lastName: 'User'
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('User with this email already exists');
  });

  it('should return 400 if required fields are missing', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        email: 'test@example.com',
        // Missing password, firstName, lastName
      }
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Missing required fields');
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
