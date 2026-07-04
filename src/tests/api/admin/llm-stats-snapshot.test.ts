import '@jest/globals';
import jwt from 'jsonwebtoken';
import User from '@/src/models/User';
import { JWT_SECRET } from '@/src/lib/jwt';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import snapshotHandler from '@/src/pages/api/admin/llm-stats/snapshot';

function makeToken(userId: string, role: string) {
  return `Bearer ${jwt.sign({ userId, role }, JWT_SECRET)}`;
}

function sampleBundle() {
  return {
    kpis: { totalTokens: 100, totalCostUsd: 1, sessions: 1, activeDays: 1 },
    byModelFamily: [{ family: 'opus', tokens: 100, requests: 1, costUsd: 1 }],
    byModel: [],
    byHarness: [],
    byProject: [],
    trend: [],
    heatmap: [],
    claudeExtras: null,
    meta: {
      generatedAt: '2026-06-21T00:00:00.000Z',
      scannedFiles: 1,
      harnessesAvailable: ['claude-code'],
      warnings: [],
    },
  };
}

describe('/api/admin/llm-stats/snapshot', () => {
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
    await snapshotHandler(req, res);
    expect(res._getStatusCode()).toBe(401);
  });

  it('403 for a non-admin JWT', async () => {
    const user = await User.findOne({ email: 'user@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(user!._id, 'user') },
    });
    await snapshotHandler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('GET returns { bundle: null } when no snapshot exists', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await snapshotHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().data.bundle).toBeNull();
  });

  it('POST rejects an invalid bundle with 400', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const { req, res } = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
      body: { not: 'a bundle' },
    });
    await snapshotHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('POST then GET round-trips the bundle', async () => {
    const admin = await User.findOne({ email: 'admin@test.com' });
    const bundle = sampleBundle();

    const post = createMocks({
      method: HTTP_METHOD.POST,
      headers: { authorization: makeToken(admin!._id, 'admin') },
      body: bundle,
    });
    await snapshotHandler(post.req, post.res);
    expect(post.res._getStatusCode()).toBe(201);

    const get = createMocks({
      method: HTTP_METHOD.GET,
      headers: { authorization: makeToken(admin!._id, 'admin') },
    });
    await snapshotHandler(get.req, get.res);
    expect(get.res._getStatusCode()).toBe(200);
    const { data } = get.res._getJSONData();
    expect(data.bundle.kpis.totalTokens).toBe(100);
    expect(data.pushedAt).toBeTruthy();
  });
});
