import '@jest/globals';
import { safeEqual } from '@/src/utils/safe-equal';

describe('safeEqual', () => {
  it('is true for identical strings', () => {
    expect(safeEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('is false for different strings of equal length', () => {
    expect(safeEqual('secret-token', 'secret-taken')).toBe(false);
  });

  it('is false for different lengths (never throws)', () => {
    expect(safeEqual('short', 'a-much-longer-secret')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('is true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
