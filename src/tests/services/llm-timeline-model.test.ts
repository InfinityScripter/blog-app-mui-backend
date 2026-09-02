import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { isAppError } from '@/src/types/api';
import { llmTimelineModelService } from '@/src/services/llm-timeline-model';

async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw, but it resolved');
}

const ID = 'anthropic-claude-fable-5-1';

const payload = {
  slug: 'claude-fable-5-1',
  vendor: 'Anthropic',
  name: 'Claude Fable 5.1',
  releaseDate: '2026-09-01',
  contextTokens: 1000000,
  params: null,
  highlight: 'Чтение из кеша подешевело вчетверо.',
  description: 'Обновление старшей модели Anthropic.',
  capabilities: ['agentic', 'coding'],
  sourceUrl: 'https://www.anthropic.com/claude-fable-and-mythos-5-1',
  wikiUrl: 'https://en.wikipedia.org/wiki/Claude_(language_model)',
  funFact: null,
};

describe('llmTimelineModelService', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM llm_timeline_models');
  });

  it('creates on the first upsert and updates on the second, keeping one row', async () => {
    const first = await llmTimelineModelService.upsert(ID, payload);
    expect(first.created).toBe(true);
    expect(first.model).toMatchObject({
      id: ID,
      slug: 'claude-fable-5-1',
      releaseDate: '2026-09-01',
      contextTokens: 1000000,
      capabilities: ['agentic', 'coding'],
      params: null,
      funFact: null,
    });

    const second = await llmTimelineModelService.upsert(ID, {
      ...payload,
      highlight: 'Другой заголовок',
    });
    expect(second.created).toBe(false);
    expect(second.model.highlight).toBe('Другой заголовок');
    expect(second.model.createdAt).toBe(first.model.createdAt);
    expect(await llmTimelineModelService.list()).toHaveLength(1);
  });

  it('defaults capabilities to [] and unknowns to null', async () => {
    const { model } = await llmTimelineModelService.upsert(ID, {
      ...payload,
      contextTokens: undefined,
      params: undefined,
      capabilities: undefined,
      wikiUrl: undefined,
      funFact: undefined,
    });
    expect(model.capabilities).toEqual([]);
    expect(model.contextTokens).toBeNull();
    expect(model.params).toBeNull();
    expect(model.wikiUrl).toBeNull();
    expect(model.funFact).toBeNull();
  });

  it('lists oldest release first', async () => {
    await llmTimelineModelService.upsert('b-newer', {
      ...payload,
      slug: 'newer',
      releaseDate: '2026-09-02',
    });
    await llmTimelineModelService.upsert('a-older', {
      ...payload,
      slug: 'older',
      releaseDate: '2026-08-31',
    });
    const ids = (await llmTimelineModelService.list()).map((model) => model.id);
    expect(ids).toEqual(['a-older', 'b-newer']);
  });

  it('rejects a second id that reuses a slug with 409', async () => {
    await llmTimelineModelService.upsert(ID, payload);
    const error = await captureThrow(() => llmTimelineModelService.upsert('other-id', payload));
    expect(isAppError(error) && error.status).toBe(409);
  });

  it('remove deletes the row and answers 404 for an unknown id', async () => {
    await llmTimelineModelService.upsert(ID, payload);
    await llmTimelineModelService.remove(ID);
    expect(await llmTimelineModelService.list()).toHaveLength(0);
    const error = await captureThrow(() => llmTimelineModelService.remove(ID));
    expect(isAppError(error) && error.status).toBe(404);
  });
});
