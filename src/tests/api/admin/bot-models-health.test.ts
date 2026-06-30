import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));
jest.mock('@/src/services/bot-control', () => ({
  botControlService: { getModelsHealth: jest.fn() },
}));

// eslint-disable-next-line import/first, import/order
import { botControlService } from '@/src/services/bot-control';
// eslint-disable-next-line import/first, import/order
import healthHandler from '@/src/pages/api/admin/bot/models-health';

const getModelsHealth = botControlService.getModelsHealth as jest.Mock;

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

describe('GET /api/admin/bot/models-health', () => {
  beforeEach(async () => {
    getModelsHealth.mockReset();
    await User.deleteMany({});
    const hash = await import('bcrypt').then((b) => b.hash('pass', 10));
    await User.create({
      name: 'Admin',
      email: 'admin@test.com',
      passwordHash: hash,
      isEmailVerified: true,
      role: 'admin',
    });
  });

  it('proxies getModelsHealth and wraps it in the ok envelope', async () => {
    const payload = {
      healthy: true,
      checks: [{ provider: 'glm', label: 'GLM', model: 'glm-4.7-flash', ok: true, ms: 42 }],
    };
    getModelsHealth.mockResolvedValue(payload);
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await healthHandler(req, res);
    expect(getModelsHealth).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ success: true, data: payload });
  });

  it('405 for a non-GET method (admin), without calling the service', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await healthHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(getModelsHealth).not.toHaveBeenCalled();
  });
});
