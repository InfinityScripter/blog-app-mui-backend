import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { translationProvider } from '@/src/utils/translate';
import {
  translatePosts,
  warmPostSummary,
  getTranslatedPostFields,
} from '@/src/services/post-translation';

// Мок провайдера перевода: по умолчанию отказывает, как отказывал DeepL с 13.08
// (456 «Quota exceeded»). Тесты, которым нужен успех, переопределяют поведение.
jest.mock('@/src/utils/translate', () => ({
  translationProvider: { translateHtml: jest.fn() },
}));

const mockedTranslateHtml = jest.mocked(translationProvider.translateHtml);

const POST = {
  id: 'a1b2c3d4-0000-0000-0000-00000000abcd',
  title: 'Заголовок',
  description: 'Описание',
  content: '<p>Тело</p>',
};

/** Отматывает время последней попытки назад, имитируя прошедший кулдаун. */
async function ageCacheRow(hours: number) {
  await dbQuery(
    `UPDATE post_translations SET updated_at = NOW() - INTERVAL '${hours} hours' WHERE post_id = $1`,
    [POST.id]
  );
}

async function readRow() {
  const result = await dbQuery<{ status: string; scope: string }>(
    'SELECT status, scope FROM post_translations WHERE post_id = $1 AND lang = $2',
    [POST.id, 'en']
  );
  return result.rows[0] ?? null;
}

beforeEach(() => {
  mockedTranslateHtml.mockReset();
  mockedTranslateHtml.mockRejectedValue(new Error('DeepL request failed with status 456'));
});

describe('Пауза после отказа переводчика', () => {
  it('после отказа записывает строку об ошибке, чтобы было от чего отсчитывать паузу', async () => {
    await translatePosts([POST], 'en', 5000);

    const row = await readRow();
    expect(row).not.toBeNull();
    expect(row?.status).toBe('error');
  });

  it('в течение паузы больше не дёргает переводчик по тому же посту', async () => {
    await translatePosts([POST], 'en', 5000);
    expect(mockedTranslateHtml).toHaveBeenCalled();
    mockedTranslateHtml.mockClear();

    // Второе и третье чтение ленты — именно они раньше и создавали шторм.
    await translatePosts([POST], 'en', 5000);
    await translatePosts([POST], 'en', 5000);

    expect(mockedTranslateHtml).not.toHaveBeenCalled();
  });

  it('после истечения паузы пробует снова', async () => {
    await translatePosts([POST], 'en', 5000);
    mockedTranslateHtml.mockClear();
    await ageCacheRow(7);

    await translatePosts([POST], 'en', 5000);

    expect(mockedTranslateHtml).toHaveBeenCalled();
  });

  it('успешный перевод после паузы отдаётся и вытесняет строку об ошибке', async () => {
    await translatePosts([POST], 'en', 5000);
    await ageCacheRow(7);
    mockedTranslateHtml.mockReset();
    mockedTranslateHtml.mockImplementation((text: string) => Promise.resolve(`[EN] ${text}`));

    const result = await translatePosts([POST], 'en', 5000);

    expect(result[0].title).toBe('[EN] Заголовок');
    expect((await readRow())?.status).toBe('ok');
  });

  it('прогрев паузу игнорирует — это ручной способ повторить попытку сейчас', async () => {
    await translatePosts([POST], 'en', 5000);
    mockedTranslateHtml.mockClear();

    const outcome = await warmPostSummary(POST, 'en');

    expect(mockedTranslateHtml).toHaveBeenCalled();
    expect(outcome).toBe('error');
  });
});

describe('Неудачный перевод тела не должен стирать готовый перевод заголовка', () => {
  it('оставляет строку scope=summary нетронутой, когда тело перевести не удалось', async () => {
    // Так выглядят 108 постов, залитых скриптом import-translations: заголовок и
    // описание переведены (scope='summary'), тело осталось оригинальным.
    mockedTranslateHtml.mockReset();
    mockedTranslateHtml.mockImplementation((text: string) => Promise.resolve(`[EN] ${text}`));
    await translatePosts([POST], 'en', 5000);
    expect((await readRow())?.status).toBe('ok');

    // Теперь читатель открывает английскую страницу поста, а переводчик отказывает.
    mockedTranslateHtml.mockReset();
    mockedTranslateHtml.mockRejectedValue(new Error('DeepL request failed with status 456'));
    const fields = await getTranslatedPostFields(POST, 'en');

    // Заголовок остаётся переведённым и в ответе, и в кеше — иначе пост вернулся
    // бы в ленту по-русски, хотя перевод для неё уже был.
    expect(fields.title).toBe('[EN] Заголовок');
    expect(fields.content).toBe(POST.content);
    const row = await readRow();
    expect(row?.status).toBe('ok');
    expect(row?.scope).toBe('summary');
  });
});
