import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import metricsHandler from '@/src/pages/api/admin/system-metrics';

jest.mock('@/src/utils/cors', () => jest.fn(() => Promise.resolve()));

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

describe('/api/admin/system-metrics', () => {
  beforeEach(async () => {
    await User.deleteMany({});
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

  it('401 without a JWT', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await metricsHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('403 for a non-admin JWT', async () => {
    const user = await User.findOne({ email: 'user@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(user!._id, 'user') },
    });
    await metricsHandler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('405 for non-GET methods', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await metricsHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('GET returns live metrics for an admin', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await metricsHandler(req, res);
    expect(res._getStatusCode()).toBe(200);

    const { data } = res._getJSONData();
    expect(data.host.hostname).toBeTruthy();
    expect(typeof data.host.uptimeSeconds).toBe('number');
    expect(data.host.timestamp).toBeTruthy();

    expect(data.cpu.cores).toBeGreaterThanOrEqual(1);
    expect(data.cpu.loadAvg).toHaveLength(3);

    expect(data.memory.totalBytes).toBeGreaterThan(0);
    expect(data.memory.usedBytes).toBeGreaterThan(0);
    expect(data.memory.usedPercent).toBeGreaterThan(0);
    expect(data.memory.usedPercent).toBeLessThanOrEqual(100);

    // Disk может быть null только на экзотике; на Linux/macOS statfs работает.
    expect(data.disk).not.toBeNull();
    expect(data.disk.totalBytes).toBeGreaterThan(0);
    expect(data.disk.usedPercent).toBeGreaterThanOrEqual(0);

    expect(data.process.pid).toBeGreaterThan(0);
    expect(data.process.nodeVersion).toMatch(/^v\d+/);
    expect(data.process.rssBytes).toBeGreaterThan(0);

    // pg-mem не поддерживает pg_database_size/pg_stat_activity → null.
    expect(data.database).toHaveProperty('sizeBytes');
    expect(data.database).toHaveProperty('activeConnections');
  });

  it('CPU usage percent is a bounded number when measurable', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const first = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await metricsHandler(first.req, first.res);
    const { data } = first.res._getJSONData();
    if (data.cpu.usagePercent !== null) {
      expect(data.cpu.usagePercent).toBeGreaterThanOrEqual(0);
      expect(data.cpu.usagePercent).toBeLessThanOrEqual(100);
    }
  });
});
