import '@jest/globals';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/auth/sign-up';
import { HTTP_METHOD } from '@/src/constants/http';

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
      method: HTTP_METHOD.POST,
      body: {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);

    const data = JSON.parse(res._getData());
    // Verify-email-first flow: sign-up does NOT issue a token. User must verify
    // their email and then sign in. Handler returns only a message + user.
    expect(data.accessToken).toBeUndefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.name).toBe('Test User');
    expect(data.user.isEmailVerified).toBe(false);

    // Verify user is saved in the database (select fields explicitly to get emailVerificationCode)
    const savedUser = await User.findOne({ email: 'test@example.com' }).select(
      '+emailVerificationCode'
    );

    expect(savedUser).toBeTruthy();
    expect(savedUser?.name).toBe('Test User');
    expect(savedUser?.isEmailVerified).toBe(false);
    expect(savedUser?.emailVerificationCode).toBeDefined();
    expect(savedUser?.emailVerificationCode?.length).toBe(6); // Should be a 6-digit code
  });

  it('returns a neutral 201 for an existing email and does not create a duplicate (anti-enumeration)', async () => {
    // First create a user
    await User.create({
      name: 'Existing User',
      email: 'existing@example.com',
      passwordHash: 'hashedpassword',
    });

    // Try to create user with same email (different case to also cover normalization)
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'EXISTING@example.com',
        password: 'password123',
        firstName: 'Another',
        lastName: 'User',
      },
    });

    await handler(req, res);

    // Neutral response — does NOT reveal that the account already exists.
    expect(res._getStatusCode()).toBe(201);
    const data = JSON.parse(res._getData());
    expect(data.message).not.toMatch(/already exists/i);

    // No duplicate account was created.
    const all = await User.findOne({ email: 'existing@example.com' });
    expect(all).toBeTruthy();
  });

  it('should return 400 if required fields are missing', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'test@example.com',
        // Missing password, firstName, lastName
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    // body now validated by zod (signUpSchema); message names the bad field
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/password|firstName|lastName|required/i);
  });

  it('should return 405 for non-POST methods', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Method not allowed');
  });
});
