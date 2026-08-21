#!/usr/bin/env node
// Импорт готовых переводов постов в кеш `post_translations`.
//
// Зачем отдельный скрипт: обычный путь наполнения кеша — прогрев, который сам
// ходит к машинному переводчику. Когда переводчик недоступен (DeepL отдаёт нам
// 456 с 13.08.2026), перевод можно сделать вне сервера и просто ЗАЛИТЬ сюда.
//
// Файл на входе — JSON-массив: [{ id, title, description, content? }], где id —
// это posts.id, а остальные поля уже на целевом языке.
//
// source_hash СЧИТАЕТСЯ ЗДЕСЬ из живой строки поста (title + ' ' + description
// + ' ' + content), ровно как в src/services/post-translation.ts. Иначе бэкенд
// счёл бы импортированную строку устаревшей и полез бы переводить заново.
//
// Область строки зависит от того, дали ли перевод тела:
//  - без content → scope='summary', тело остаётся оригинальным. Ленты рендерят
//    только заголовок и описание, а страницу поста дотянет details.
//  - с content   → scope='full', переведён весь пост. Details отдаёт такую
//    строку как есть и к переводчику не ходит.
//
// ИДЕМПОТЕНТЕН: ON CONFLICT (post_id, lang) DO UPDATE. Сухой прогон по
// умолчанию, запись только с --apply.
//
//   DATABASE_URL=postgres://… node scripts/import-translations.mjs data.json
//   DATABASE_URL=postgres://… node scripts/import-translations.mjs data.json --apply

import fs from 'node:fs';
import crypto from 'node:crypto';

import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const LANG = 'en';
const DATA_PATH = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

if (!DATA_PATH) {
  console.error(
    'Нужен путь к JSON-файлу с переводами:\n  node scripts/import-translations.mjs data.json --apply'
  );
  process.exit(1);
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('DATABASE_URL обязателен.');
  process.exit(1);
}

// Копия sourceHash из src/services/post-translation.ts — держать синхронно.
function sourceHash({ title, description, content }) {
  return crypto.createHash('sha256').update([title, description, content].join(' ')).digest('hex');
}

const rows = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const stats = { imported: 0, missing: 0, skipped: 0 };

for (const row of rows) {
  if (!row.id || !row.title || !row.description) {
    console.warn(`пропуск: неполная запись ${row.id ?? '(без id)'}`);
    stats.skipped += 1;
    continue;
  }

  // eslint-disable-next-line no-await-in-loop
  const post = await pool.query('SELECT title, description, content FROM posts WHERE id = $1', [
    row.id,
  ]);
  if (post.rows.length === 0) {
    console.warn(`пропуск: поста ${row.id} больше нет`);
    stats.missing += 1;
    continue;
  }

  const hash = sourceHash(post.rows[0]);
  // Тело перевели → строка полная; не перевели → оригинальное тело и summary.
  const scope = row.content ? 'full' : 'summary';
  const content = row.content ?? post.rows[0].content;

  if (!APPLY) {
    console.log(`[сухой прогон] ${scope} ${row.id} → ${row.title.slice(0, 55)}`);
    stats.imported += 1;
    continue;
  }

  // eslint-disable-next-line no-await-in-loop
  await pool.query(
    `INSERT INTO post_translations (post_id, lang, title, description, content, source_hash, status, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'ok', $7, NOW())
     ON CONFLICT (post_id, lang) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       content = EXCLUDED.content,
       source_hash = EXCLUDED.source_hash,
       status = 'ok',
       scope = EXCLUDED.scope,
       updated_at = NOW()`,
    [row.id, LANG, row.title, row.description, content, hash, scope]
  );
  stats.imported += 1;
}

await pool.end();
console.log(
  `${APPLY ? 'Импортировано' : 'К импорту'}: ${stats.imported}, постов не найдено: ${stats.missing}, пропущено: ${stats.skipped}`
);
