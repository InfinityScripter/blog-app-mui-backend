import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { isAppError } from '@/src/types/api';
import { modelReleaseService } from '@/src/services/model-release';

async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw, but it resolved');
}

const basePayload = {
  vendor: 'OpenAI',
  model: 'GPT-5',
  version: '2025-06',
  releasedAt: '2025-06-01T00:00:00.000Z',
  sourceUrl: 'https://openai.com/gpt-5',
  changes: [],
};

describe('modelReleaseService', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM model_releases');
  });

  it('creates a release, derives a slug, and reads it back by slug (contract shape)', async () => {
    const created = await modelReleaseService.create({
      ...basePayload,
      contextTokens: 400000,
      priceIn: 1.25,
      priceOut: 10,
      changes: ['Bigger context', 'Cheaper output'],
      verdict: 'Solid upgrade',
      sourceName: 'OpenAI Blog',
    });

    expect(created.id).toEqual(expect.any(String));
    expect(created.slug).toBe('openai-gpt-5-2025-06');
    expect(created.releasedAt).toBe('2025-06-01T00:00:00.000Z');
    expect(created.contextTokens).toBe(400000);
    expect(created.priceIn).toBe(1.25);
    expect(created.priceOut).toBe(10);
    expect(created.changes).toEqual(['Bigger context', 'Cheaper output']);
    expect(created.verdict).toBe('Solid upgrade');
    expect(created.sourceUrl).toBe('https://openai.com/gpt-5');
    expect(created.sourceName).toBe('OpenAI Blog');

    const fetched = await modelReleaseService.getBySlug('openai-gpt-5-2025-06');
    expect(fetched.id).toBe(created.id);
    expect(fetched.model).toBe('GPT-5');
  });

  it('defaults unknowns to null / [] and never invents prices or context', async () => {
    const created = await modelReleaseService.create(basePayload);
    expect(created.contextTokens).toBeNull();
    expect(created.priceIn).toBeNull();
    expect(created.priceOut).toBeNull();
    expect(created.verdict).toBeNull();
    expect(created.sourceName).toBeNull();
    expect(created.changes).toEqual([]);
  });

  it('lists releases newest-first with a total count and filters by vendor', async () => {
    await modelReleaseService.create({
      ...basePayload,
      releasedAt: '2025-01-01T00:00:00.000Z',
    });
    await modelReleaseService.create({
      ...basePayload,
      model: 'GPT-5-mini',
      releasedAt: '2025-09-01T00:00:00.000Z',
    });
    await modelReleaseService.create({
      ...basePayload,
      vendor: 'Anthropic',
      model: 'Claude',
      releasedAt: '2025-05-01T00:00:00.000Z',
    });

    const all = await modelReleaseService.list();
    expect(all.total).toBe(3);
    expect(all.releases[0].releasedAt).toBe('2025-09-01T00:00:00.000Z');

    const openai = await modelReleaseService.list({ vendor: 'OpenAI' });
    expect(openai.total).toBe(2);
    expect(openai.releases.every((r) => r.vendor === 'OpenAI')).toBe(true);
  });

  it('rejects a duplicate slug with a 409 conflict (23505 → AppError)', async () => {
    await modelReleaseService.create(basePayload);
    const error = await captureThrow(() => modelReleaseService.create(basePayload));
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.status).toBe(409);
  });

  it('throws a 404 when a slug is unknown', async () => {
    const error = await captureThrow(() => modelReleaseService.getBySlug('does-not-exist'));
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.status).toBe(404);
  });
});
