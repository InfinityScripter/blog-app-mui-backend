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

/** Ответ OpenRouter в формате chat completions. */
function llmReply(text: string, finishReason = 'stop') {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ choices: [{ message: { content: text }, finish_reason: finishReason }] }),
  } as unknown as Response;
}

function httpError(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as unknown as Response;
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

describe('Переводчик на GPT-5.6 Luna через OpenRouter', () => {
  it('включается, когда задан OPENROUTER_API_KEY', async () => {
    const fetchMock = jest.fn().mockResolvedValue(llmReply('Hello'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({
      OPENROUTER_API_KEY: 'test-key',
      DEEPL_AUTH_KEY: 'deepl-key',
    });

    const result = await translationProvider.translateHtml('Привет', OPTS);

    expect(result).toBe('Hello');
    expect(String(fetchMock.mock.calls[0][0])).toContain('openrouter.ai');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('openai/gpt-5.6-luna');
  });

  it('без OPENROUTER_API_KEY остаётся на DeepL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ translations: [{ text: 'Hello' }] }),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({
      OPENROUTER_API_KEY: undefined,
      DEEPL_AUTH_KEY: 'deepl-key',
    });

    await translationProvider.translateHtml('Привет', OPTS);

    expect(String(fetchMock.mock.calls[0][0])).toContain('deepl.com');
  });

  it('просит модель сохранять разметку и не добавлять ничего от себя', async () => {
    const fetchMock = jest.fn().mockResolvedValue(llmReply('<p>Hello</p>'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    await translationProvider.translateHtml('<p>Привет</p>', OPTS);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const system = body.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toMatch(/HTML/i);
    expect(system).toMatch(/Russian/);
    expect(system).toMatch(/English/);
    // Исходник уходит модели байт в байт, без обёрток.
    expect(body.messages.find((m: { role: string }) => m.role === 'user').content).toBe(
      '<p>Привет</p>'
    );
    expect(body.temperature).toBe(0);
  });

  it('пустой текст не отправляет запрос вовсе', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    expect(await translationProvider.translateHtml('', OPTS)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('длинный текст режет на куски и склеивает ответы по порядку', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(llmReply('one'))
      .mockResolvedValueOnce(llmReply('two'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider, chunkHtml } = await loadTranslate({
      OPENROUTER_API_KEY: 'test-key',
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
      .mockResolvedValue(llmReply('Beginning of the text', 'length')) as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    await expect(translationProvider.translateHtml('<p>Привет</p>', OPTS)).rejects.toThrow(
      /truncat/i
    );
  });

  it('пустой ответ модели — тоже ошибка, а не пустой перевод', async () => {
    global.fetch = jest.fn().mockResolvedValue(llmReply('')) as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    await expect(translationProvider.translateHtml('<p>Привет</p>', OPTS)).rejects.toThrow(
      /empty|missing/i
    );
  });

  it('повторяет запрос при 429 и отдаёт перевод со второй попытки', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(llmReply('Hello'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    expect(await translationProvider.translateHtml('Привет', OPTS)).toBe('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it('бросает исключение, когда провайдер отказывает окончательно', async () => {
    global.fetch = jest.fn().mockResolvedValue(httpError(401)) as unknown as typeof fetch;
    const { translationProvider } = await loadTranslate({ OPENROUTER_API_KEY: 'test-key' });

    await expect(translationProvider.translateHtml('Привет', OPTS)).rejects.toThrow(/401/);
  });
});
