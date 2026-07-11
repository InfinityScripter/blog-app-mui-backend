// Average adult reading speed (words per minute). Mirrors the frontend util
// (src/utils/reading-time.ts) so a list row's precomputed readingTime matches
// what the detail page would compute from the full body.
const WORDS_PER_MINUTE = 200;

/**
 * Estimate reading time in whole minutes from raw HTML content (Tiptap output).
 * Strips tags + entities, counts words, divides by reading speed. Always >= 1.
 */
export function getReadingTime(content?: string): number {
  if (!content) return 1;

  const text = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .trim();

  if (!text) return 1;

  const words = text.split(/\s+/).filter(Boolean).length;

  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
