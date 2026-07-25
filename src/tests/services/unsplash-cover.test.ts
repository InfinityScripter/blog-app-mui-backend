import '@jest/globals';
import { fetchUnsplashCover } from '@/src/services/unsplash-cover';

type FetchCall = { url: string; headers: Record<string, string> };

/** A minimal /photos/random item — only the fields the client reads. */
function photo(id: string, author = 'Аня Фотографова') {
  return {
    urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=tracking-${Math.random()}` },
    links: { download_location: `https://api.unsplash.com/photos/${id}/download` },
    user: { name: author, links: { html: `https://unsplash.com/@${author}` } },
  };
}

function mockUnsplash(payload: unknown, status = 200) {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('fetchUnsplashCover', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.UNSPLASH_ACCESS_KEY;
    jest.restoreAllMocks();
  });

  it('returns null and makes no request when no key is configured', async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    const calls = mockUnsplash([photo('aaa')]);
    expect(await fetchUnsplashCover(['ai'], new Set())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('asks /photos/random with the Client-ID header and a tag-derived query', async () => {
    const calls = mockUnsplash([photo('aaa')]);
    await fetchUnsplashCover(['нейросети'], new Set());
    expect(calls[0].url).toContain('api.unsplash.com/photos/random');
    expect(calls[0].url).toContain('orientation=landscape');
    expect(calls[0].headers.Authorization).toBe('Client-ID test-access-key');
  });

  it('normalizes the URL: no tracking params, same shape as the static pool', async () => {
    mockUnsplash([photo('1620712943543-bcc4688e7485')]);
    const cover = await fetchUnsplashCover(['ai'], new Set());
    // Tracking params must be dropped — ixid varies per request, so keeping it
    // would make the SAME photo look like a new URL and defeat the used-check.
    expect(cover?.url).toBe(
      'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1200&q=80'
    );
  });

  it('skips photos already used on the blog', async () => {
    mockUnsplash([photo('taken'), photo('free')]);
    const used = new Set([
      'https://images.unsplash.com/photo-taken?auto=format&fit=crop&w=1200&q=80',
    ]);
    const cover = await fetchUnsplashCover(['ai'], used);
    expect(cover?.url).toContain('photo-free');
  });

  it('returns null when every returned photo is already used', async () => {
    mockUnsplash([photo('a'), photo('b')]);
    const used = new Set(
      ['a', 'b'].map(
        (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`
      )
    );
    expect(await fetchUnsplashCover(['ai'], used)).toBeNull();
  });

  it('carries the photographer credit required by the Unsplash API terms', async () => {
    mockUnsplash([photo('aaa', 'Ivan Petrov')]);
    const cover = await fetchUnsplashCover(['ai'], new Set());
    expect(cover?.creditName).toBe('Ivan Petrov');
    expect(cover?.creditUrl).toContain('unsplash.com/@Ivan Petrov');
    expect(cover?.creditUrl).toContain('utm_source=');
  });

  it('pings download_location, as the API terms require', async () => {
    const calls = mockUnsplash([photo('aaa')]);
    await fetchUnsplashCover(['ai'], new Set());
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(calls.some((call) => call.url.includes('/download'))).toBe(true);
  });

  it('fails soft on an HTTP error', async () => {
    mockUnsplash({ errors: ['Rate Limit Exceeded'] }, 403);
    expect(await fetchUnsplashCover(['ai'], new Set())).toBeNull();
  });

  it('fails soft when the network throws', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await fetchUnsplashCover(['ai'], new Set())).toBeNull();
  });

  it('fails soft on a malformed body', async () => {
    mockUnsplash({ not: 'an array' });
    expect(await fetchUnsplashCover(['ai'], new Set())).toBeNull();
  });
});
