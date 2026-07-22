import '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import handler from '@/src/pages/api/auth/sign-in';
import { HTTP_METHOD } from '@/src/constants/http';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';

describe('POST /api/auth/sign-in', () => {
  beforeEach(async () => {
    await User.deleteMany({});

    // Create a test user with valid passwordHash
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({
      name: 'Test User',
      email: 'test@example.com',
      passwordHash,
      isEmailVerified: true,
      personalDataConsentAt: new Date(),
      personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
    });
  });

  it('should authenticate a user with valid credentials and return 200 status', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'test@example.com',
        password: 'password123',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);

    const data = JSON.parse(res._getData());
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe('test@example.com');
    expect(data.user.name).toBe('Test User');

    // Verify JWT token is valid
    const decodedToken = jwt.verify(data.accessToken, process.env.JWT_SECRET || 'secret123') as {
      userId: string;
    };
    expect(decodedToken.userId).toBe(data.user._id.toString());
  });

  it('should return 400 for incorrect password', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'test@example.com',
        password: 'wrongpassword',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Wrong email or password');
  });

  it('should return 400 for non-existent email', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'nonexistent@example.com',
        password: 'password123',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    expect(data.message).toBe('Wrong email or password');
  });

  it('should return 400 if email or password is missing', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        // Missing email and password
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const data = JSON.parse(res._getData());
    // body now validated by zod (signInSchema)
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/email|password|required|invalid/i);
  });

  it('should return user with role field', async () => {
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'test@example.com', password: 'password123' },
    });
    await handler(req, res);
    const data = JSON.parse(res._getData());
    expect(data.user.role).toBe('user');
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

  it('requires and records current consent for a legacy account before issuing a session', async () => {
    const legacyUser = await User.findOne({ email: 'test@example.com' });
    if (!legacyUser) throw new Error('test user missing');
    legacyUser.personalDataConsentAt = null;
    legacyUser.personalDataConsentVersion = null;
    await legacyUser.save();

    const first = createMocks({
      method: HTTP_METHOD.POST,
      body: { email: 'test@example.com', password: 'password123' },
    });
    await handler(first.req, first.res);
    expect(first.res._getStatusCode()).toBe(428);

    const second = createMocks({
      method: HTTP_METHOD.POST,
      body: {
        email: 'test@example.com',
        password: 'password123',
        personalDataConsent: true,
        personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION,
      },
    });
    await handler(second.req, second.res);
    expect(second.res._getStatusCode()).toBe(200);

    const updated = await User.findOne({ email: 'test@example.com' });
    expect(updated?.personalDataConsentAt).toBeInstanceOf(Date);
    expect(updated?.personalDataConsentVersion).toBe(PERSONAL_DATA_CONSENT_VERSION);
  });
});
