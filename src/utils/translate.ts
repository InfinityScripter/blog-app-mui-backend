import { HTTP_METHOD } from '@/src/constants/http';

// Machine translation provider abstraction. Two implementations: an LLM
// (GPT-5.6 Luna through OpenRouter) and DeepL. The interface lets the
// post-translation service stay provider-agnostic (and lets tests inject a mock
// without hitting the network).
//
// Which one runs is decided by env at module load — see createProvider at the
// bottom. The LLM wins when OPENROUTER_API_KEY is set; DeepL is the fallback.
//
// No HTTP dependency: both use the global fetch (Node 18+ / Next 14).

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

// DeepL's free tier rate-limits bursts with HTTP 429; it can also return
// transient 5xx. Retry those a few times with growing backoff so a busy read
// (e.g. translating a whole list on a cold cache) rides out the limit instead
// of degrading to the original and poisoning the cache with an error row.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);
const RETRY_BACKOFF_MS: readonly number[] = [600, 1500, 4000, 9000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// A bare fetch has NO timeout: a provider that accepts the connection and then
// goes quiet would hang the caller forever. The read paths carry their own time
// budget, but the warmup does not — it is supposed to grind for minutes, so an
// unbounded single request there would wedge the whole run.
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Sends one provider request, retrying rate-limit / transient statuses with
 * backoff. `send` is the provider-specific POST; `label` names it in the error.
 * `attempt` recurses (es5 target forbids loops) up to RETRY_BACKOFF_MS.length.
 * Returns the OK response — a final failure throws, and the post-translation
 * service degrades to the original text.
 */
async function sendWithRetry(
  send: () => Promise<Response>,
  label: string,
  attempt = 0
): Promise<Response> {
  const response = await send();

  if (!response.ok) {
    if (RETRY_STATUSES.has(response.status) && attempt < RETRY_BACKOFF_MS.length) {
      await sleep(RETRY_BACKOFF_MS[attempt]);
      return sendWithRetry(send, label, attempt + 1);
    }
    throw new Error(`${label} request failed with status ${response.status}`);
  }
  return response;
}

async function postToDeepL(
  chunk: string,
  opts: TranslateOptions,
  authKey: string
): Promise<Response> {
  const params = new URLSearchParams();
  params.append('text', chunk);
  params.append('source_lang', opts.source);
  params.append('target_lang', opts.target);
  params.append('tag_handling', 'html');

  return fetch(DEEPL_ENDPOINT, {
    method: HTTP_METHOD.POST,
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Translates a single (already size-bounded) chunk via one DeepL request. */
async function translateChunk(
  chunk: string,
  opts: TranslateOptions,
  authKey: string
): Promise<string> {
  const response = await sendWithRetry(() => postToDeepL(chunk, opts, authKey), 'DeepL');

  const data = (await response.json()) as DeepLResponse;
  const out = data.translations?.map((t) => t.text).join('');
  if (out === undefined) {
    throw new Error('DeepL response missing translations');
  }
  return out;
}

/**
 * Translates `text` one chunk at a time, SEQUENTIALLY — never in parallel. A
 * fan-out here, multiplied across a whole list of posts, is exactly what trips
 * provider rate limits (429). Serial is slower, but the result is cached, so
 * only the first view pays for it.
 */
function translateChunksInOrder(
  text: string,
  maxChars: number,
  translateOne: (chunk: string) => Promise<string>
): Promise<string> {
  return chunkHtml(text, maxChars)
    .reduce<Promise<string[]>>(async (accPromise, chunk) => {
      const acc = await accPromise;
      return [...acc, await translateOne(chunk)];
    }, Promise.resolve([]))
    .then((pieces) => pieces.join(''));
}

const deepLProvider: TranslationProvider = {
  translateHtml(text: string, opts: TranslateOptions): Promise<string> {
    if (text === '') {
      return Promise.resolve('');
    }

    const authKey = process.env.DEEPL_AUTH_KEY;
    if (!authKey) {
      return Promise.reject(new Error('DEEPL_AUTH_KEY is not configured'));
    }

    return translateChunksInOrder(text, MAX_CHUNK_CHARS, (chunk) =>
      translateChunk(chunk, opts, authKey)
    );
  },
};

// OpenRouter's OpenAI-compatible endpoint — one key already proxies many
// upstreams for the news bot, and it dodges the per-provider geo blocks that
// killed the DeepL path from this box.
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TRANSLATION_MODEL = 'openai/gpt-5.6-luna';

// Chunks are much smaller than DeepL's. DeepL's limit is a REQUEST-BODY cap, so
// 24k characters fit fine; a model has to REPRODUCE the whole chunk in its
// answer, so the real bound is max_tokens. ~6k characters of Russian come back
// as ~2k tokens of English, comfortably inside the cap below even if the
// translation runs longer than the source.
const LLM_MAX_CHUNK_CHARS = 6_000;
const LLM_MAX_TOKENS = 8_192;

// Prompt-friendly names for the DeepL language codes the service passes in.
// Unknown codes fall through as-is — a model reads 'PT-BR' fine.
const LANGUAGE_NAMES: Record<string, string> = {
  RU: 'Russian',
  'EN-US': 'English (US)',
  'EN-GB': 'English (UK)',
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * The whole contract with the model. It is strict about two things that would
 * otherwise corrupt the site: markup must survive byte-for-byte (post bodies are
 * real HTML), and the reply must be the translation ALONE — any "Here is the
 * translation:" preamble would be cached and rendered as article text.
 */
function translationSystemPrompt(opts: TranslateOptions): string {
  return [
    `You are a translation engine. Translate the user's message from ${languageName(opts.source)} to ${languageName(opts.target)}.`,
    'Output ONLY the translation. No preamble, no notes, no code fences, no quotes around it.',
    'The input may be HTML. Preserve every tag, attribute, entity and whitespace structure exactly; translate only the human-readable text between tags.',
    'Never translate code, URLs, file paths, or the contents of <code> and <pre>.',
    'Keep proper nouns, product names and brand names as they are.',
    'If the text is already in the target language, return it unchanged.',
  ].join('\n');
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
}

async function postToOpenRouter(
  chunk: string,
  opts: TranslateOptions,
  apiKey: string
): Promise<Response> {
  return fetch(OPENROUTER_ENDPOINT, {
    method: HTTP_METHOD.POST,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TRANSLATION_MODEL,
      max_tokens: LLM_MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: translationSystemPrompt(opts) },
        { role: 'user', content: chunk },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function translateChunkWithLlm(
  chunk: string,
  opts: TranslateOptions,
  apiKey: string
): Promise<string> {
  const response = await sendWithRetry(() => postToOpenRouter(chunk, opts, apiKey), 'OpenRouter');
  const data = (await response.json()) as ChatCompletionResponse;
  const choice = data.choices?.[0];

  // finish_reason 'length' means the answer was CUT OFF mid-translation.
  // Returning it would cache half an article as a successful translation and
  // serve that forever — so this is an error, and the caller degrades to the
  // original text instead.
  if (choice?.finish_reason === 'length') {
    throw new Error('OpenRouter response was truncated (finish_reason=length)');
  }

  const text = choice?.message?.content;
  // An empty string is NOT a valid translation of non-empty input — caching it
  // would blank the post. Treated the same as a missing field.
  if (!text) {
    throw new Error('OpenRouter response missing or empty text content');
  }
  return text;
}

const llmProvider: TranslationProvider = {
  translateHtml(text: string, opts: TranslateOptions): Promise<string> {
    if (text === '') {
      return Promise.resolve('');
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Promise.reject(new Error('OPENROUTER_API_KEY is not configured'));
    }

    return translateChunksInOrder(text, LLM_MAX_CHUNK_CHARS, (chunk) =>
      translateChunkWithLlm(chunk, opts, apiKey)
    );
  },
};

// Chosen by env at module load. The LLM path wins when its key is present;
// without it we stay on DeepL, so the box keeps working unchanged until the key
// is actually deployed.
function createProvider(): TranslationProvider {
  return process.env.OPENROUTER_API_KEY ? llmProvider : deepLProvider;
}

export const translationProvider: TranslationProvider = createProvider();
