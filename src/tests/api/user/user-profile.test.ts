import '@jest/globals';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { createMocks } from 'node-mocks-http';
import avatarHandler from '@/src/pages/api/user/avatar';
import profileHandler from '@/src/pages/api/user/profile';
import changePasswordHandler from '@/src/pages/api/user/change-password';

jest.mock('@/src/utils/cors', () => jest.fn((req, res) => Promise.resolve()));

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key';
const CURRENT_PASSWORD = 'password123';

function authHeader(userId: string) {
  const token = jwt.sign({ userId, role: 'user' }, JWT_SECRET);
  return { authorization: `Bearer ${token}` };
}

describe('User profile endpoints', () => {
  let userId: string;

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(CURRENT_PASSWORD, 10);
    const user = await User.create({
      name: 'Original Name',
      email: 'profile@example.com',
      passwordHash,
      isEmailVerified: true,
    });
    userId = user._id;
  });

  describe('PATCH /api/user/profile', () => {
    it('updates the name and returns the updated user', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        headers: authHeader(userId),
        body: { name: 'Updated Name' },
      });

      await profileHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.user.name).toBe('Updated Name');

      // Persisted to the database.
      const reloaded = await User.findById(userId);
      expect(reloaded?.name).toBe('Updated Name');
    });

    it('rejects an empty name with 400', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        headers: authHeader(userId),
        body: { name: '   ' },
      });

      await profileHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
    });

    it('returns 401 when unauthenticated', async () => {
      const { req, res } = createMocks({
        method: 'PATCH',
        body: { name: 'Updated Name' },
      });

      await profileHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
    });
  });

  describe('POST /api/user/change-password', () => {
    it('changes the password with the correct current password', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: authHeader(userId),
        body: { currentPassword: CURRENT_PASSWORD, newPassword: 'newpassword456' },
      });

      await changePasswordHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);

      // The stored hash now matches the new password, not the old one.
      const reloaded = await User.findById(userId);
      expect(await bcrypt.compare('newpassword456', reloaded!.passwordHash!)).toBe(true);
      expect(await bcrypt.compare(CURRENT_PASSWORD, reloaded!.passwordHash!)).toBe(false);
    });

    it('returns 400 when the current password is incorrect', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: authHeader(userId),
        body: { currentPassword: 'wrongpassword', newPassword: 'newpassword456' },
      });

      await changePasswordHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.message).toBe('Current password is incorrect');

      // The password was not changed.
      const reloaded = await User.findById(userId);
      expect(await bcrypt.compare(CURRENT_PASSWORD, reloaded!.passwordHash!)).toBe(true);
    });

    it('returns 400 when the new password is too short', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: authHeader(userId),
        body: { currentPassword: CURRENT_PASSWORD, newPassword: '123' },
      });

      await changePasswordHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
    });

    it('returns 401 when unauthenticated', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: { currentPassword: CURRENT_PASSWORD, newPassword: 'newpassword456' },
      });

      await changePasswordHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
    });
  });

  describe('POST /api/user/avatar', () => {
    it('sets the avatar URL and returns the updated user', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: authHeader(userId),
        body: { avatarURL: '/api/file/abc123' },
      });

      await avatarHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.user.avatarURL).toBe('/api/file/abc123');

      // Persisted to the database.
      const reloaded = await User.findById(userId);
      expect(reloaded?.avatarURL).toBe('/api/file/abc123');
    });

    it('rejects an empty avatar URL with 400', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        headers: authHeader(userId),
        body: { avatarURL: '' },
      });

      await avatarHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
    });

    it('returns 401 when unauthenticated', async () => {
      const { req, res } = createMocks({
        method: 'POST',
        body: { avatarURL: '/api/file/abc123' },
      });

      await avatarHandler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
    });
  });
});
