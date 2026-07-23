import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import adminLoginHandler from '@/src/pages/api/dogs/admin/login';
import { requireFeature } from '@/src/middlewares/require-feature';
import adminSettingsHandler from '@/src/pages/api/dogs/admin/settings';
import publicSettingsHandler from '@/src/pages/api/dogs/settings/public';

jest.mock('@/src/utils/dogs-email', () => ({
  sendDogsRequestReceived: jest.fn().mockResolvedValue(undefined),
  sendDogsStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

// The dogsBooking flag gates the public booking-intake route and is toggled from
// the dogs /admin (Bearer session). The public read feeds the frontend gate.
// Routes omit enabledInTest, so the existing dogs suite drives the booking flow
// regardless of the flag; this suite flips it on explicitly to exercise the gate.

async function adminToken() {
  const { req, res } = createMocks({ method: HTTP_METHOD.POST, body: { password: 'secret' } });
  await adminLoginHandler(req, res);
  return JSON.parse(res._getData()).data.token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('Dogs settings API + dogsBooking gate', () => {
  beforeEach(async () => {
    process.env.DOGS_ADMIN_PASSWORD = 'secret';
    process.env.DOGS_ADMIN_SESSION_SECRET = 'session-secret';
    await dbQuery('DELETE FROM app_settings');
    settingsService.__resetCacheForTests();
  });

  describe('requireFeature(dogsBooking) gate', () => {
    const okHandler = jest.fn((_req, res) => res.status(HTTP.OK).json({ ran: true }));

    beforeEach(() => okHandler.mockClear());

    it('runs the wrapped handler when dogsBooking is enabled', async () => {
      await settingsService.setFlag('dogsBooking', true);
      const { req, res } = createMocks({ method: HTTP_METHOD.POST });
      await requireFeature('dogsBooking', { enabledInTest: true })(okHandler)(req, res);
      expect(okHandler).toHaveBeenCalledTimes(1);
      expect(res._getStatusCode()).toBe(HTTP.OK);
    });

    it('answers 404 and skips the handler when dogsBooking is disabled', async () => {
      await settingsService.setFlag('dogsBooking', false);
      const { req, res } = createMocks({ method: HTTP_METHOD.POST });
      await requireFeature('dogsBooking', { enabledInTest: true })(okHandler)(req, res);
      expect(okHandler).not.toHaveBeenCalled();
      expect(res._getStatusCode()).toBe(HTTP.NOT_FOUND);
      expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'Not found' });
    });
  });

  describe('GET /api/dogs/settings/public', () => {
    it('exposes only dogsBooking, defaulting off with no stored row', async () => {
      const { req, res } = createMocks({ method: HTTP_METHOD.GET });
      await publicSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.OK);
      const { data } = JSON.parse(res._getData());
      expect(data).toEqual({ dogsBooking: false });
    });

    it('reflects the stored dogsBooking value', async () => {
      await settingsService.setFlag('dogsBooking', true);
      const { req, res } = createMocks({ method: HTTP_METHOD.GET });
      await publicSettingsHandler(req, res);
      expect(JSON.parse(res._getData()).data).toEqual({ dogsBooking: true });
    });

    it('rejects non-GET with 405', async () => {
      const { req, res } = createMocks({ method: HTTP_METHOD.POST });
      await publicSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    });
  });

  describe('GET/PATCH /api/dogs/admin/settings', () => {
    it('requires the dogs-admin Bearer token', async () => {
      const { req, res } = createMocks({ method: HTTP_METHOD.GET });
      await adminSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.UNAUTHORIZED);
    });

    it('returns only the dogsBooking flag on GET — never the blog pdCollection', async () => {
      // Separate auth domain: the dogs owner must not see the blog's flag. Guards
      // against reverting to the blog-wide getFlags() here.
      await settingsService.setFlag('dogsBooking', true);
      const token = await adminToken();
      const { req, res } = createMocks({ method: HTTP_METHOD.GET, headers: auth(token) });
      await adminSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.OK);
      const { flags } = JSON.parse(res._getData()).data;
      expect(flags).toEqual({ dogsBooking: true });
      expect(flags).not.toHaveProperty('pdCollection');
    });

    it('toggles dogsBooking on PATCH and persists it (public read reflects it)', async () => {
      const token = await adminToken();
      const { req, res } = createMocks({
        method: HTTP_METHOD.PATCH,
        headers: auth(token),
        body: { enabled: true },
      });
      await adminSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.OK);
      expect(JSON.parse(res._getData()).data).toEqual({ dogsBooking: true });

      const { req: pubReq, res: pubRes } = createMocks({ method: HTTP_METHOD.GET });
      await publicSettingsHandler(pubReq, pubRes);
      expect(JSON.parse(pubRes._getData()).data).toEqual({ dogsBooking: true });
    });

    it('rejects a non-boolean enabled with 400', async () => {
      const token = await adminToken();
      const { req, res } = createMocks({
        method: HTTP_METHOD.PATCH,
        headers: auth(token),
        body: { enabled: 'yes' },
      });
      await adminSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    });

    it('rejects an unsupported method with 405', async () => {
      const token = await adminToken();
      const { req, res } = createMocks({ method: HTTP_METHOD.DELETE, headers: auth(token) });
      await adminSettingsHandler(req, res);
      expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
    });
  });
});
