import { HTTP_METHOD } from '@/src/constants/http';

// Machine translation provider abstraction. The only implementation today is
// DeepL, but the interface lets the post-translation service stay
// provider-agnostic (and lets tests inject a mock without hitting the network).
//
// No HTTP dependency: uses the global fetch (Node 18+ / Next 14).

export interface TranslateOptions {
  /** Source language, DeepL code (e.g. 'RU'). */
  source: string;
  /** Target language, DeepL code (e.g. 'EN-US'). */
  target: string;
}

export interface TranslationProvider {
  /**
   * Translates HTML/Markdown text, preserving tags. Returns the translated
   * string. Throws on a provider/config error — the caller decides whether to
   * degrade to the original.
   */
  translateHtml(text: string, opts: TranslateOptions): Promise<string>;
}

const DEEPL_ENDPOINT = 'https://api-free.deepl.com/v2/translate';

// DeepL caps a single request body at 128 KiB. We keep a conservative
// character budget per chunk (well under the byte cap even for multi-byte
// Cyrillic) and split long content on block boundaries so tags never break
// across a chunk.
const MAX_CHUNK_CHARS = 24_000;

// Boundaries we prefer to split on, best first: closing block tags, then blank
// lines. Kept simple on purpose — a safe chunker, not a full HTML parser.
const BLOCK_BOUNDARY = /(<\/(?:p|div|section|article|li|ul|ol|h[1-6]|blockquote|pre|table)>|\n\n)/i;

/**
 * Splits text into chunks under MAX_CHUNK_CHARS, cutting on block boundaries
 * where possible so HTML tags stay intact. A single oversized token with no
 * boundary is sent whole (DeepL will still handle bodies up to its own cap).
 */
export function chunkHtml(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  // Split while keeping the delimiters (capture group), then greedily pack
  // pieces into chunks. Reduce keeps this loop-free (es5 target forbids for-of).
  const pieces = text.split(BLOCK_BOUNDARY).filter((piece) => piece !== '');

  const { chunks, current } = pieces.reduce<{ chunks: string[]; current: string }>(
    (acc, piece) => {
      if (acc.current.length + piece.length <= maxChars || acc.current === '') {
        return { chunks: acc.chunks, current: acc.current + piece };
      }
      return { chunks: [...acc.chunks, acc.current], current: piece };
    },
    { chunks: [], current: '' }
  );

  return current === '' ? chunks : [...chunks, current];
}

interface DeepLResponse {
  translations?: { text: string }[];
}

/** Translates a single (already size-bounded) chunk via one DeepL request. */
async function translateChunk(
  chunk: string,
  opts: TranslateOptions,
  authKey: string
): Promise<string> {
  const params = new URLSearchParams();
  params.append('text', chunk);
  params.append('source_lang', opts.source);
  params.append('target_lang', opts.target);
  params.append('tag_handling', 'html');

  const response = await fetch(DEEPL_ENDPOINT, {
    method: HTTP_METHOD.POST,
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`DeepL request failed with status ${response.status}`);
  }

  const data = (await response.json()) as DeepLResponse;
  const out = data.translations?.map((t) => t.text).join('');
  if (out === undefined) {
    throw new Error('DeepL response missing translations');
  }
  return out;
}

class DeepLProvider implements TranslationProvider {
  // eslint-disable-next-line class-methods-use-this
  async translateHtml(text: string, opts: TranslateOptions): Promise<string> {
    if (text === '') {
      return '';
    }

    const authKey = process.env.DEEPL_AUTH_KEY;
    if (!authKey) {
      throw new Error('DEEPL_AUTH_KEY is not configured');
    }

    const chunks = chunkHtml(text);
    const translated = await Promise.all(
      chunks.map((chunk) => translateChunk(chunk, opts, authKey))
    );
    return translated.join('');
  }
}

// Singleton chosen by env. Only DeepL exists today; the switch keeps the door
// open for a future provider without changing callers.
function createProvider(): TranslationProvider {
  return new DeepLProvider();
}

export const translationProvider: TranslationProvider = createProvider();
