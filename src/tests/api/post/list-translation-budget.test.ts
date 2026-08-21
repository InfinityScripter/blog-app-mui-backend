import '@jest/globals';
import { translationProvider } from '@/src/utils/translate';
import { translatePosts } from '@/src/services/post-translation';

// Мок провайдера перевода: реального запроса в DeepL нет, задержку каждый тест
// задаёт сам. Это ровно та переменная, из-за которой лента вставала: провайдер
// может отвечать не мгновенно, а очень долго (или не ответить никогда).
jest.mock('@/src/utils/translate', () => ({
  translationProvider: { translateHtml: jest.fn() },
}));

const mockedTranslateHtml = jest.mocked(translationProvider.translateHtml);

function makePost(id: string) {
  return {
    id,
    title: `Заголовок ${id}`,
    description: `Описание ${id}`,
    content: `<p>Тело ${id}</p>`,
  };
}

/** Провайдер, который отвечает переводом через `ms` миллисекунд. */
function echoAfter(ms: number) {
  return (text: string) =>
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(`[EN] ${text}`), ms);
    });
}

beforeEach(() => {
  mockedTranslateHtml.mockReset();
});

describe('translatePosts — бюджет времени на перевод ленты', () => {
  it('перестаёт звать провайдер, когда бюджет исчерпан, и отдаёт остальные посты как есть', async () => {
    mockedTranslateHtml.mockImplementation(echoAfter(60));
    const posts = [makePost('a'), makePost('b'), makePost('c')];

    const result = await translatePosts(posts, 'en', 20);

    // Ни один пост не успел перевестись в бюджет — все отданы оригиналом.
    expect(result.map((post) => post.title)).toEqual(posts.map((post) => post.title));
    // Главное: за дедлайном работа не начинается вовсе. Провайдер видел только
    // первый пост; до постов b и c дело не дошло, хотя без бюджета он сходил бы
    // за каждым из трёх.
    const asked = mockedTranslateHtml.mock.calls.map(([text]) => String(text));
    expect(asked.some((text) => text.endsWith(' b') || text.endsWith(' c'))).toBe(false);
  });

  it('не ждёт зависший перевод дольше бюджета', async () => {
    // Провайдер, который не отвечает никогда — так вёл себя DeepL, отвечая 429
    // на каждый запрос: цепочка повторов с паузами тянулась ~15 секунд на поле.
    mockedTranslateHtml.mockImplementation(() => new Promise<string>(() => {}));
    const posts = [makePost('a'), makePost('b')];

    const startedAt = Date.now();
    const result = await translatePosts(posts, 'en', 50);
    const spentMs = Date.now() - startedAt;

    expect(spentMs).toBeLessThan(1000);
    expect(result.map((post) => post.title)).toEqual(posts.map((post) => post.title));
  });

  it('отдаёт уже закешированные переводы даже при нулевом бюджете', async () => {
    mockedTranslateHtml.mockImplementation(echoAfter(0));
    const posts = [makePost('a')];
    // Прогрев: первый проход кладёт перевод в кеш.
    await translatePosts(posts, 'en', 5000);
    mockedTranslateHtml.mockClear();

    // Бюджет кончился ещё до первого поста — но кеш это чтение из базы, а не
    // поход к провайдеру, поэтому переведённый заголовок обязан остаться.
    const result = await translatePosts(posts, 'en', 0);

    expect(result[0].title).toBe('[EN] Заголовок a');
    expect(mockedTranslateHtml).not.toHaveBeenCalled();
  });
});
