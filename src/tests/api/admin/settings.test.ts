import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
// eslint-disable-next-line import/first, import/order
import listHandler from '@/src/pages/api/admin/settings';
import { settingsService } from '@/src/services/settings';
// eslint-disable-next-line import/first, import/order
import publicHandler from '@/src/pages/api/settings/public';
// eslint-disable-next-line import/first, import/order
import toggleHandler from '@/src/pages/api/admin/settings/pd-collection';
// eslint-disable-next-line import/first, import/order
import autoPublishHandler from '@/src/pages/api/admin/settings/auto-publish';

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

// Settle the fire-and-forget audit insert emitted by the toggle route.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 40);
  });

describe('admin + public settings routes', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await dbQuery('DELETE FROM app_settings');
    await dbQuery('DELETE FROM audit_logs');
    settingsService.__resetCacheForTests();
    const hash = await import('bcrypt').then((b) => b.hash('pass', 10));
    await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
    await User.create({
      name: 'User',
      email: 'user@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'user',
    });
  });

  async function adminAuth() {
    const admin = await User.findOne({ email: 'admin@test.com' });
    return makeToken(admin!._id, 'admin');
  }

  describe('GET /api/admin/settings', () => {
    it('returns the flags snapshot for an admin', async () => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.GET,
        headers: { authorization: await adminAuth() },
      });
      await listHandler(req, res);
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.flags).toHaveProperty('pdCollection');
    });

    it('403 for a non-admin', async () => {
      const user = await User.findOne({ email: 'user@test.com' });
      const { req, res } = createMocks({
        method: HTTP_METHOD.GET,
        headers: { authorization: makeToken(user!._id, 'user') },
      });
      await listHandler(req, res);
      expect(res._getStatusCode()).toBe(403);
    });
  });

  describe('POST /api/admin/settings/pd-collection', () => {
    it('toggles the flag off, persists it, and audits the change', async () => {
      await settingsService.setFlag('pdCollection', true);
      settingsService.__resetCacheForTests();

      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: await adminAuth() },
        body: { enabled: false },
      });
      await toggleHandler(req, res);
      await settle();

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.pdCollection).toBe(false);

      // Actually persisted.
      settingsService.__resetCacheForTests();
      expect(await settingsService.getFlag('pdCollection')).toBe(false);

      // Audit row written.
      const audit = await dbQuery<{ action: string; target_id: string | null }>(
        'SELECT action, target_id FROM audit_logs ORDER BY created_at DESC LIMIT 1'
      );
      expect(audit.rows[0].action).toBe('settings.pd_collection_toggled');
      expect(audit.rows[0].target_id).toBe('pdCollection');
    });

    it('400 when enabled is missing or not a boolean', async () => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: await adminAuth() },
        body: { enabled: 'yes' },
      });
      await toggleHandler(req, res);
      expect(res._getStatusCode()).toBe(400);
    });

    it('403 for a non-admin (cannot flip the master switch)', async () => {
      const user = await User.findOne({ email: 'user@test.com' });
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: makeToken(user!._id, 'user') },
        body: { enabled: true },
      });
      await toggleHandler(req, res);
      expect(res._getStatusCode()).toBe(403);
    });
  });

  describe('POST /api/admin/settings/auto-publish', () => {
    it('toggles autoPublishReleases, persists it, and audits the change', async () => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: await adminAuth() },
        body: { key: 'autoPublishReleases', enabled: true },
      });
      await autoPublishHandler(req, res);
      await settle();

      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data.autoPublishReleases).toBe(true);

      settingsService.__resetCacheForTests();
      expect(await settingsService.getFlag('autoPublishReleases')).toBe(true);

      const audit = await dbQuery<{ action: string; target_id: string | null }>(
        'SELECT action, target_id FROM audit_logs ORDER BY created_at DESC LIMIT 1'
      );
      expect(audit.rows[0].action).toBe('settings.auto_publish_toggled');
      expect(audit.rows[0].target_id).toBe('autoPublishReleases');
    });

    it('400 for an unknown key (cannot flip an unrelated flag)', async () => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: await adminAuth() },
        body: { key: 'pdCollection', enabled: false },
      });
      await autoPublishHandler(req, res);
      expect(res._getStatusCode()).toBe(400);
    });

    it('400 when enabled is not a boolean', async () => {
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: await adminAuth() },
        body: { key: 'autoPublishNews', enabled: 'yes' },
      });
      await autoPublishHandler(req, res);
      expect(res._getStatusCode()).toBe(400);
    });

    it('403 for a non-admin', async () => {
      const user = await User.findOne({ email: 'user@test.com' });
      const { req, res } = createMocks({
        method: HTTP_METHOD.POST,
        headers: { authorization: makeToken(user!._id, 'user') },
        body: { key: 'autoPublishReleases', enabled: true },
      });
      await autoPublishHandler(req, res);
      expect(res._getStatusCode()).toBe(403);
    });
  });

  describe('GET /api/settings/public', () => {
    it('returns pdCollection without any auth', async () => {
      await settingsService.setFlag('pdCollection', false);
      settingsService.__resetCacheForTests();

      const { req, res } = createMocks({ method: HTTP_METHOD.GET });
      await publicHandler(req, res);
      expect(res._getStatusCode()).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.data).toEqual({ pdCollection: false });
    });

    it('405 for a non-GET method', async () => {
      const { req, res } = createMocks({ method: HTTP_METHOD.POST });
      await publicHandler(req, res);
      expect(res._getStatusCode()).toBe(405);
    });
  });
});
