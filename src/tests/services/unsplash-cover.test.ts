import '@jest/globals';
import {
  pingUnsplashDownload,
  isUnsplashConfigured,
  fetchUnsplashCandidates,
} from '@/src/services/unsplash-cover';

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

describe('fetchUnsplashCandidates', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.UNSPLASH_ACCESS_KEY;
    jest.restoreAllMocks();
  });

  it('returns nothing and makes no request when no key is configured', async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    const calls = mockUnsplash([photo('aaa')]);
    expect(await fetchUnsplashCandidates('ai')).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(isUnsplashConfigured()).toBe(false);
  });

  it('asks /photos/random with the Client-ID header and a topic-derived query', async () => {
    const calls = mockUnsplash([photo('aaa')]);
    await fetchUnsplashCandidates('ai');
    expect(calls[0].url).toContain('api.unsplash.com/photos/random');
    expect(calls[0].url).toContain('orientation=landscape');
    expect(calls[0].headers.Authorization).toBe('Client-ID test-access-key');
  });

  it('falls back to a generic query for an unknown topic', async () => {
    const calls = mockUnsplash([photo('aaa')]);
    await fetchUnsplashCandidates(null);
    expect(calls[0].url).toContain(encodeURIComponent('technology abstract'));
  });

  it('normalizes URLs: no tracking params, same shape as the static pool', async () => {
    mockUnsplash([photo('1620712943543-bcc4688e7485')]);
    const [candidate] = await fetchUnsplashCandidates('ai');
    // Tracking params must be dropped — ixid varies per request, so keeping it
    // would make the SAME photo look like a new URL and defeat the used-check.
    expect(candidate.url).toBe(
      'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1200&q=80'
    );
  });

  it('returns EVERY usable candidate — one round trip stocks many publishes', async () => {
    mockUnsplash([photo('a'), photo('b'), photo('c')]);
    expect(await fetchUnsplashCandidates('ai')).toHaveLength(3);
  });

  it('drops candidates whose URL cannot be parsed', async () => {
    mockUnsplash([{ urls: { raw: 'not a url' } }, photo('good')]);
    const candidates = await fetchUnsplashCandidates('ai');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].url).toContain('photo-good');
  });

  it('carries the photographer credit required by the Unsplash API terms', async () => {
    mockUnsplash([photo('aaa', 'Ivan Petrov')]);
    const [candidate] = await fetchUnsplashCandidates('ai');
    expect(candidate.creditName).toBe('Ivan Petrov');
    expect(candidate.creditUrl).toContain('unsplash.com/@Ivan Petrov');
    expect(candidate.creditUrl).toContain('utm_source=');
    expect(candidate.downloadLocation).toContain('/download');
  });

  it('does NOT ping download_location while merely stocking the reserve', async () => {
    // A stashed photo is not a used photo — the ping belongs to the claim.
    const calls = mockUnsplash([photo('aaa')]);
    await fetchUnsplashCandidates('ai');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(calls.some((call) => call.url.includes('/download'))).toBe(false);
  });

  it('fails soft on an HTTP error', async () => {
    mockUnsplash({ errors: ['Rate Limit Exceeded'] }, 403);
    expect(await fetchUnsplashCandidates('ai')).toEqual([]);
  });

  it('fails soft when the network throws', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await fetchUnsplashCandidates('ai')).toEqual([]);
  });

  it('fails soft on a malformed body', async () => {
    mockUnsplash({ not: 'an array' });
    expect(await fetchUnsplashCandidates('ai')).toEqual([]);
  });
});

describe('pingUnsplashDownload', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.UNSPLASH_ACCESS_KEY;
  });

  it('pings the attribution endpoint with the Client-ID header', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    const calls = mockUnsplash([]);
    pingUnsplashDownload('https://api.unsplash.com/photos/x/download');
    expect(calls[0].headers.Authorization).toBe('Client-ID test-access-key');
  });

  it('stays quiet without a location or a key', () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    const calls = mockUnsplash([]);
    pingUnsplashDownload(null);
    delete process.env.UNSPLASH_ACCESS_KEY;
    pingUnsplashDownload('https://api.unsplash.com/photos/x/download');
    expect(calls).toHaveLength(0);
  });

  it('swallows a failed ping — attribution bookkeeping never breaks a publish', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-access-key';
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(() => pingUnsplashDownload('https://api.unsplash.com/photos/x/download')).not.toThrow();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
});
