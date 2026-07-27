import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { reserveDepth, claimReservedCover, refillCoverReserve } from '@/src/services/cover-reserve';

type FetchCall = { url: string };

/** A minimal /photos/random item — only the fields the client reads. */
function photo(id: string, author = 'Аня Фотографова') {
  return {
    urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=tracking-${id}` },
    links: { download_location: `https://api.unsplash.com/photos/${id}/download` },
    user: { name: author, links: { html: `https://unsplash.com/@${author}` } },
  };
}

/** The normalized form the reserve stores — tracking params stripped. */
function normalized(id: string) {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;
}

function mockUnsplash(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (url: string) => {
    calls.push({ url: String(url) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

async function stash(url: string, topic = '', credit = 'Аня') {
  await dbQuery(
    `INSERT INTO cover_reserve (url, topic, credit_name, credit_url, download_location)
     VALUES ($1, $2, $3, $4, $5)`,
    [url, topic, credit, `https://unsplash.com/@${credit}?utm_source=aifirst`, `${url}/download`]
  );
}

async function seedPost(id: string, coverUrl: string) {
  await dbQuery('INSERT INTO posts (id, title, cover_url, user_id) VALUES ($1, $2, $3, $4)', [
    id,
    `Пост ${id}`,
    coverUrl,
    'user-a',
  ]);
}

describe('cover reserve', () => {
  const realFetch = global.fetch;

  beforeEach(async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    await User.create({ _id: 'user-a', name: 'A', email: 'a@e.com', passwordHash: 'x' });
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.UNSPLASH_ACCESS_KEY;
    jest.restoreAllMocks();
  });

  describe('claimReservedCover', () => {
    it('returns null when nothing is stashed', async () => {
      expect(await claimReservedCover(['ai'], new Set())).toBeNull();
    });

    it('hands out a photo with the attribution the Unsplash terms require', async () => {
      await stash(normalized('a'), 'ai', 'Ivan Petrov');
      const cover = await claimReservedCover(['ai'], new Set());
      expect(cover?.url).toBe(normalized('a'));
      expect(cover?.creditName).toBe('Ivan Petrov');
      expect(cover?.creditUrl).toContain('utm_source=');
    });

    it('takes the photo OUT of the reserve, so a second post cannot get it', async () => {
      await stash(normalized('only'), 'ai');
      const first = await claimReservedCover(['ai'], new Set());
      const second = await claimReservedCover(['ai'], new Set());
      expect(first?.url).toBe(normalized('only'));
      expect(second).toBeNull();
      expect(await reserveDepth()).toBe(0);
    });

    it('gives two concurrent publishes two different photos — never the same one', async () => {
      // The property the whole mechanism exists for. DELETE ... RETURNING makes
      // the claim atomic: whoever deletes the row owns it, the loser moves on.
      await stash(normalized('one'), 'ai');
      await stash(normalized('two'), 'ai');
      const covers = await Promise.all([
        claimReservedCover(['ai'], new Set()),
        claimReservedCover(['ai'], new Set()),
      ]);
      const urls = covers.map((cover) => cover?.url);
      expect(new Set(urls).size).toBe(2);
      expect(urls).toContain(normalized('one'));
      expect(urls).toContain(normalized('two'));
    });

    it('never hands out a photo already on a post', async () => {
      // A stashed photo can be used by a hand-made post before it is claimed —
      // posts.cover_url still has the last word.
      await stash(normalized('taken'), 'ai');
      await stash(normalized('free'), 'ai');
      await seedPost('p1', normalized('taken'));
      const cover = await claimReservedCover(['ai'], new Set([normalized('taken')]));
      expect(cover?.url).toBe(normalized('free'));
    });

    it('prefers the post topic but accepts an off-topic photo over nothing', async () => {
      await stash(normalized('generic'), 'business');
      await stash(normalized('ontopic'), 'ai');
      const onTopic = await claimReservedCover(['нейросети'], new Set());
      expect(onTopic?.url).toBe(normalized('ontopic'));

      const offTopic = await claimReservedCover(['нейросети'], new Set());
      expect(offTopic?.url).toBe(normalized('generic'));
    });

    it('pings download_location when the photo is claimed, as the terms require', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'test-key';
      const calls = mockUnsplash([]);
      await stash(normalized('a'), 'ai');
      await claimReservedCover(['ai'], new Set());
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(calls.some((call) => call.url.includes('/download'))).toBe(true);
    });
  });

  describe('refillCoverReserve', () => {
    beforeEach(() => {
      process.env.UNSPLASH_ACCESS_KEY = 'test-key';
    });

    it('does nothing and makes no request without a key', async () => {
      delete process.env.UNSPLASH_ACCESS_KEY;
      const calls = mockUnsplash([photo('a')]);
      expect(await refillCoverReserve()).toEqual({ added: 0, depth: 0 });
      expect(calls).toHaveLength(0);
    });

    it('stashes the fetched photos with their credits', async () => {
      mockUnsplash([photo('a', 'Ivan Petrov'), photo('b')]);
      const result = await refillCoverReserve();
      expect(result.added).toBeGreaterThanOrEqual(2);

      const { rows } = await dbQuery<{ url: string; credit_name: string; topic: string }>(
        'SELECT url, credit_name, topic FROM cover_reserve ORDER BY url'
      );
      const stored = rows.find((row) => row.url === normalized('a'));
      expect(stored?.credit_name).toBe('Ivan Petrov');
      expect(stored?.topic).not.toBe('');
    });

    it('skips photos already used on the blog', async () => {
      await seedPost('p1', normalized('taken'));
      mockUnsplash([photo('taken'), photo('fresh')]);
      await refillCoverReserve();

      const { rows } = await dbQuery<{ url: string }>('SELECT url FROM cover_reserve');
      const urls = rows.map((row) => row.url);
      expect(urls).toContain(normalized('fresh'));
      expect(urls).not.toContain(normalized('taken'));
    });

    it('stores a photo Unsplash hands back twice only once', async () => {
      mockUnsplash([photo('dup'), photo('dup'), photo('other')]);
      await refillCoverReserve();

      const { rows } = await dbQuery<{ url: string }>(
        'SELECT url FROM cover_reserve WHERE url = $1',
        [normalized('dup')]
      );
      expect(rows).toHaveLength(1);
    });

    it('fails soft when Unsplash is unreachable — no throw, reserve untouched', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch;
      await expect(refillCoverReserve()).resolves.toEqual({ added: 0, depth: 0 });
      expect(await reserveDepth()).toBe(0);
    });

    it('fails soft on an HTTP error and stops hammering the API', async () => {
      const calls = mockUnsplash({ errors: ['Rate Limit Exceeded'] }, 403);
      await expect(refillCoverReserve()).resolves.toEqual({ added: 0, depth: 0 });
      // One failed request ends the run instead of burning the rate limit.
      expect(calls).toHaveLength(1);
    });

    it('makes no request once the reserve is deep enough', async () => {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await stash(normalized(`stock-${i}`), 'ai');
      }
      const calls = mockUnsplash([photo('extra')]);
      const result = await refillCoverReserve();
      expect(result.added).toBe(0);
      expect(calls).toHaveLength(0);
    });
  });
});
