import '@jest/globals';
import {
  pickDefaultCover,
  COVER_ASSET_BASE,
  COVER_ASSET_COUNT,
  buildNewPostPayload,
  buildPostPatchPayload,
  DEFAULT_POST_COVER_URL,
} from '@/src/utils/post-payload';

const author = { name: 'Автор', avatarUrl: null };
const coverRe = new RegExp(`^${COVER_ASSET_BASE}/cover-(\\d+)\\.webp$`);

function coverIndex(url: string): number {
  const match = coverRe.exec(url);
  if (!match) throw new Error(`not a bundled cover: ${url}`);
  return Number(match[1]);
}

describe('pickDefaultCover', () => {
  it('always returns a bundled cover in the 1…24 range', () => {
    ['a', 'Заголовок новости', 'x'.repeat(200), 'GPT-5 вышел', '123'].forEach((seed) => {
      const index = coverIndex(pickDefaultCover(seed));
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(COVER_ASSET_COUNT);
    });
  });

  it('is deterministic — same seed maps to the same cover', () => {
    expect(pickDefaultCover('Заголовок новости')).toBe(pickDefaultCover('Заголовок новости'));
  });

  it('falls back to the legacy default for an empty/whitespace seed', () => {
    expect(pickDefaultCover('')).toBe(DEFAULT_POST_COVER_URL);
    expect(pickDefaultCover('   ')).toBe(DEFAULT_POST_COVER_URL);
    expect(pickDefaultCover(undefined)).toBe(DEFAULT_POST_COVER_URL);
  });

  it('spreads distinct titles across many covers (no cover-1 monoculture)', () => {
    const titles = Array.from({ length: 300 }, (_, i) => `Новость номер ${i} про ИИ`);
    const indexes = new Set(titles.map((t) => coverIndex(pickDefaultCover(t))));
    // A healthy hash should hit most of the 24 buckets, and certainly not funnel
    // everything to cover-1 the way the old single default did.
    expect(indexes.size).toBeGreaterThan(COVER_ASSET_COUNT / 2);
  });
});

describe('buildNewPostPayload cover handling', () => {
  it('assigns a title-derived varied cover when coverUrl is omitted', () => {
    const payload = buildNewPostPayload({ title: 'Заголовок новости' }, author, 'user-1');
    expect(payload.coverUrl).toBe(pickDefaultCover('Заголовок новости'));
    expect(coverRe.test(payload.coverUrl as string)).toBe(true);
  });

  it('does not funnel every coverless post onto cover-1', () => {
    const covers = Array.from(
      { length: 50 },
      (_, i) => buildNewPostPayload({ title: `Пост ${i}` }, author, 'user-1').coverUrl
    );
    const onCover1 = covers.filter((c) => c === DEFAULT_POST_COVER_URL).length;
    expect(onCover1).toBeLessThan(covers.length); // not all identical
    expect(new Set(covers).size).toBeGreaterThan(1);
  });

  it('preserves an explicitly provided string cover', () => {
    const payload = buildNewPostPayload(
      { title: 'T', coverUrl: '/api/file/abc-123' },
      author,
      'user-1'
    );
    expect(payload.coverUrl).toBe('/api/file/abc-123');
  });

  it('uses an upload object path, else the varied default', () => {
    const withPath = buildNewPostPayload(
      { title: 'T', coverUrl: { path: '/api/file/xyz' } },
      author,
      'user-1'
    );
    expect(withPath.coverUrl).toBe('/api/file/xyz');

    const noPath = buildNewPostPayload({ title: 'Заголовок', coverUrl: {} }, author, 'user-1');
    expect(noPath.coverUrl).toBe(pickDefaultCover('Заголовок'));
  });
});

describe('buildPostPatchPayload cover handling', () => {
  it('keeps the existing cover as the fallback and never invents one', () => {
    // coverUrl omitted → the field is absent from the patch (existing kept).
    const patch = buildPostPatchPayload({ title: 'new' }, { coverUrlFallback: '/api/file/keep' });
    expect('coverUrl' in patch).toBe(false);
  });

  it('falls back to the existing cover for an upload object with no path', () => {
    const patch = buildPostPatchPayload(
      { coverUrl: {} },
      { coverUrlFallback: '/assets/images/cover/cover-7.webp' }
    );
    expect(patch.coverUrl).toBe('/assets/images/cover/cover-7.webp');
  });
});
