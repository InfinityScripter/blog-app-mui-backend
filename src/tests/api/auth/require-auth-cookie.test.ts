import '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { signToken } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import meHandler from '@/src/pages/api/auth/me';
import { generateCsrfToken } from '@/src/lib/csrf';
import { HTTP_METHOD } from '@/src/constants/http';
import newPostHandler from '@/src/pages/api/post/new';
import { CSRF_COOKIE, ACCESS_COOKIE } from '@/src/lib/cookies';

const USER_ID = 'cookie-auth-user-1';

const VALID_POST = {
  title: 'Cookie Post',
  description: 'via cookie auth',
  content: 'body',
  publish: 'published',
  tags: ['x'],
  metaTitle: 'm',
  metaDescription: 'md',
  metaKeywords: ['k'],
  coverUrl: 'http://example.com/c.jpg',
};

describe('require-auth cookie path + CSRF enforcement', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM refresh_tokens');
    await User.deleteMany({});
    const passwordHash = await bcrypt.hash('pw', 10);
    await User.create({
      _id: USER_ID,
      name: 'Cookie User',
      email: 'cookie@example.com',
      passwordHash,
      isEmailVerified: true,
    });
  });

  it('authenticates a GET via the access_token cookie', async () => {
    const token = signToken({ userId: USER_ID, role: 'user' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { cookie: `${ACCESS_COOKIE}=${token}` },
    });
    await meHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).user._id).toBe(USER_ID);
  });

  it('rejects a cookie-authed mutation without a CSRF token (403)', async () => {
    const token = signToken({ userId: USER_ID, role: 'user' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { cookie: `${ACCESS_COOKIE}=${token}`, 'Content-Type': 'application/json' },
      body: VALID_POST,
    });
    await newPostHandler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('allows a cookie-authed mutation with a matching CSRF pair', async () => {
    const token = signToken({ userId: USER_ID, role: 'user' });
    const csrf = generateCsrfToken();
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: {
        cookie: `${ACCESS_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`,
        'x-csrf-token': csrf,
        'Content-Type': 'application/json',
      },
      body: VALID_POST,
    });
    await newPostHandler(req, res);
    expect(res._getStatusCode()).toBe(201);
  });

  it('bearer-JWT mutation still works and is CSRF-exempt (legacy/back-compat)', async () => {
    const token = jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET || 'test_secret_key');
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: VALID_POST,
    });
    await newPostHandler(req, res);
    // No CSRF token supplied, yet the bearer path is not CSRF-gated → 201.
    expect(res._getStatusCode()).toBe(201);
  });

  it('rejects a request with neither cookie nor bearer (401)', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await meHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });
});
