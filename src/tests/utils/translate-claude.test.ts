import type * as TranslateModule from '@/src/utils/translate';

import '@jest/globals';

// Провайдер выбирается ОДИН раз при загрузке модуля, поэтому каждый тест
// подгружает src/utils/translate заново с нужным окружением. Окружение держим
// подменённым до конца теста: ключ читается не при загрузке, а в момент вызова.
async function loadTranslate(env: Record<string, string | undefined>) {
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  let mod: typeof TranslateModule;
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/src/utils/translate');
  });
  // @ts-expect-error — присваивается внутри isolateModulesAsync выше.
  return mod;
}

/** Ответ Anthropic с одним текстовым блоком. */
function claudeReply(text: string, stopReason = 'end_turn') {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ content: [{ type: 'text', text }], stop_reason: stopReason }),
  } as unknown as Response;
}

function httpError(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response;
}

const OPTS = { source: 'RU', target: 'EN-US' };

const originalFetch = global.fetch;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = savedEnv;
});

describe('Переводчик на Claude', () => {
  it('включается, когда задан ANTHROPIC_API_KEY', async () => {
    const fetchMock = jest.fn().mockResolvedValue(claudeReply('Hello'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({
      ANTHROPIC_API_KEY: 'test-key',
      DEEPL_AUTH_KEY: 'deepl-key',
    });

    const result = await translationProvider.translateHtml('Привет', OPTS);

    expect(result).toBe('Hello');
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.anthropic.com');
  });

  it('без ANTHROPIC_API_KEY остаётся на DeepL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ translations: [{ text: 'Hello' }] }),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({
      ANTHROPIC_API_KEY: undefined,
      DEEPL_AUTH_KEY: 'deepl-key',
    });

    await translationProvider.translateHtml('Привет', OPTS);

    expect(String(fetchMock.mock.calls[0][0])).toContain('deepl.com');
  });

  it('просит модель сохранять разметку и не добавлять ничего от себя', async () => {
    const fetchMock = jest.fn().mockResolvedValue(claudeReply('<p>Hello</p>'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ ANTHROPIC_API_KEY: 'test-key' });

    await translationProvider.translateHtml('<p>Привет</p>', OPTS);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toMatch(/HTML/i);
    expect(body.system).toMatch(/Russian/);
    expect(body.system).toMatch(/English/);
    // Исходник уходит модели байт в байт, без обёрток.
    expect(body.messages[0].content).toBe('<p>Привет</p>');
    expect(body.temperature).toBe(0);
  });

  it('пустой текст не отправляет запрос вовсе', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ ANTHROPIC_API_KEY: 'test-key' });

    expect(await translationProvider.translateHtml('', OPTS)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('длинный текст режет на куски и склеивает ответы по порядку', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(claudeReply('one'))
      .mockResolvedValueOnce(claudeReply('two'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider, chunkHtml } = await loadTranslate({
      ANTHROPIC_API_KEY: 'test-key',
    });

    // Два блока, каждый заведомо крупнее лимита куска для LLM.
    const long = `<p>${'а'.repeat(5000)}</p><p>${'б'.repeat(5000)}</p>`;
    expect(chunkHtml(long, 6000).length).toBeGreaterThan(1);
    const result = await translationProvider.translateHtml(long, OPTS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toBe('onetwo');
  });

  it('обрыв ответа по лимиту токенов — это ошибка, а не половина перевода', async () => {
    // Иначе обрезанный текст лёг бы в кеш как удачный перевод и навсегда
    // подменил бы пост половиной статьи.
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        claudeReply('Beginning of the text', 'max_tokens')
      ) as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ ANTHROPIC_API_KEY: 'test-key' });

    await expect(translationProvider.translateHtml('<p>Привет</p>', OPTS)).rejects.toThrow(
      /max_tokens|обрыв|truncat/i
    );
  });

  it('повторяет запрос при 429 и отдаёт перевод со второй попытки', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(claudeReply('Hello'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ ANTHROPIC_API_KEY: 'test-key' });

    expect(await translationProvider.translateHtml('Привет', OPTS)).toBe('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it('бросает исключение, когда провайдер отказывает окончательно', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpError(401)) as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ ANTHROPIC_API_KEY: 'test-key' });

    await expect(translationProvider.translateHtml('Привет', OPTS)).rejects.toThrow(/401/);
  });
});
