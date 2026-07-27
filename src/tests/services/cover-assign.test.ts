import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import coverPool from '@/src/data/cover-pool.json';
import { pickUnusedCover } from '@/src/services/cover-assign';

/** A fetch that never answers — what an unreachable api.unsplash.com looks like. */
function hangingFetch() {
  const calls: string[] = [];
  global.fetch = jest.fn((url: string, init?: { signal?: AbortSignal }) => {
    calls.push(String(url));
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('TimeoutError')));
    });
  }) as unknown as typeof fetch;
  return calls;
}

// Array.from, not [...set] — es5 target without downlevelIteration turns a
// spread Set into an empty array, which would make these cases pass vacuously.
const STOCK: string[] = Array.from(new Set(Object.values(coverPool.pools).flat()));
const AI_POOL: string[] = coverPool.pools.ai;
const BUNDLED: string[] = coverPool.bundled;

/** Inserts one post per cover so the covers count as taken. */
async function seedCovers(covers: string[]) {
  for (let i = 0; i < covers.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await dbQuery('INSERT INTO posts (id, title, cover_url, user_id) VALUES ($1, $2, $3, $4)', [
      `seed-${i}`,
      `Seeded post ${i}`,
      covers[i],
      'user-a',
    ]);
  }
}

describe('pickUnusedCover', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.UNSPLASH_ACCESS_KEY;
  });

  beforeEach(async () => {
    // The Unsplash top-up must stay off here: these cases pin the offline
    // ladder, and a key in the developer's shell would make them hit network.
    delete process.env.UNSPLASH_ACCESS_KEY;
    await User.create({ _id: 'user-a', name: 'A', email: 'a@e.com', passwordHash: 'x' });
  });

  it('picks from the topical pool that matches the post tags', async () => {
    const { url } = await pickUnusedCover({ tags: ['новости', 'ai'], title: 'Заголовок' });
    expect(AI_POOL).toContain(url);
  });

  it('never returns a cover another post already uses', async () => {
    await seedCovers(AI_POOL);
    const { url } = await pickUnusedCover({ tags: ['ai'], title: 'Ещё один AI-пост' });
    expect(AI_POOL).not.toContain(url);
    expect(STOCK).toContain(url);
  });

  it('widens past the topic instead of repeating (the whole pool is fair game)', async () => {
    // Every AI cover taken → an AI post gets an off-topic but UNIQUE cover.
    await seedCovers(AI_POOL);
    const picks = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { url } = await pickUnusedCover({ tags: ['ai'], title: `Пост ${i}` });
      picks.add(url);
      // eslint-disable-next-line no-await-in-loop
      await dbQuery('INSERT INTO posts (id, title, cover_url, user_id) VALUES ($1, $2, $3, $4)', [
        `p-${i}`,
        `Пост ${i}`,
        url,
        'user-a',
      ]);
    }
    expect(picks.size).toBe(10);
  });

  it('falls back to the bundled assets once the stock pool is exhausted', async () => {
    await seedCovers(STOCK);
    const { url } = await pickUnusedCover({ tags: ['ai'], title: 'Пул кончился' });
    expect(BUNDLED).toContain(url);
  });

  it('degrades to the least-used cover when everything is taken, never empty', async () => {
    await seedCovers([...STOCK, ...BUNDLED]);
    // One extra post on the first stock cover makes it the most-used one.
    await dbQuery('INSERT INTO posts (id, title, cover_url, user_id) VALUES ($1, $2, $3, $4)', [
      'extra',
      'Дубль',
      STOCK[0],
      'user-a',
    ]);
    const { url } = await pickUnusedCover({ tags: ['ai'], title: 'Совсем всё занято' });
    expect(url).toBeTruthy();
    expect(url).not.toBe(STOCK[0]);
    expect([...STOCK, ...BUNDLED]).toContain(url);
  });

  it('is deterministic for the same title and the same taken set', async () => {
    const first = await pickUnusedCover({ tags: ['ai'], title: 'Один и тот же заголовок' });
    const second = await pickUnusedCover({ tags: ['ai'], title: 'Один и тот же заголовок' });
    expect(second.url).toBe(first.url);
  });

  it('assigns 40 consecutive posts 40 distinct covers', async () => {
    // The acceptance property: covers stop repeating on the live blog.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { url } = await pickUnusedCover({ tags: ['ai', 'новости'], title: `Новость ${i}` });
      seen.add(url);
      // eslint-disable-next-line no-await-in-loop
      await dbQuery('INSERT INTO posts (id, title, cover_url, user_id) VALUES ($1, $2, $3, $4)', [
        `news-${i}`,
        `Новость ${i}`,
        url,
        'user-a',
      ]);
    }
    expect(seen.size).toBe(40);
  });

  it('takes a stashed Unsplash photo first, with its attribution', async () => {
    await dbQuery(
      `INSERT INTO cover_reserve (url, topic, credit_name, credit_url) VALUES ($1, $2, $3, $4)`,
      [
        'https://images.unsplash.com/photo-reserved?auto=format&fit=crop&w=1200&q=80',
        'ai',
        'Ivan Petrov',
        'https://unsplash.com/@ivan?utm_source=aifirst',
      ]
    );
    const cover = await pickUnusedCover({ tags: ['ai'], title: 'Из запаса' });
    expect(cover.url).toContain('photo-reserved');
    expect(cover.creditName).toBe('Ivan Petrov');
    expect(cover.creditUrl).toContain('utm_source=');
  });

  it('never touches the network, even with a key configured', async () => {
    // The point of the whole change: Unsplash is fetched AHEAD of publishing, so
    // an unreachable api.unsplash.com cannot slow a publish down. If this ever
    // makes a request again, the publish path is back on the critical path.
    process.env.UNSPLASH_ACCESS_KEY = 'test-key';
    const calls = hangingFetch();
    const started = Date.now();
    const { url } = await pickUnusedCover({ tags: ['ai'], title: 'Unsplash недоступен' });
    expect(calls).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    // …and the post still gets a real, unique cover.
    expect([...STOCK, ...BUNDLED]).toContain(url);
  });

  it('counts covers of drafts and hand-made posts as taken too', async () => {
    const taken = AI_POOL[0];
    await dbQuery(
      'INSERT INTO posts (id, title, cover_url, user_id, publish) VALUES ($1, $2, $3, $4, $5)',
      ['draft-1', 'Черновик', taken, 'user-a', 'draft']
    );
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { url } = await pickUnusedCover({ tags: ['ai'], title: `Пост ${i}` });
      expect(url).not.toBe(taken);
    }
  });
});
