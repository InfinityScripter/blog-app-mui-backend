#!/usr/bin/env node
// Legacy off-topic-news finder + cleanup.
//
// Early on, the news bot pulled general-news RSS (meduza/lenta) which created
// off-topic posts (fashion, celebrity, sport) tagged 'новости'. The relevance
// filter now stops NEW ones, but old rows remain. This finds them so you can
// remove them from /news.
//
// SAFE BY DEFAULT — dry run. Prints the candidates and does NOT touch the DB.
// Cleanup, when you pass --apply, REMOVES the 'новости' tag from the matched
// posts (so they leave /news). It does NOT delete the row — fully reversible by
// re-adding the tag. Hand-written blog posts (no 'новости' tag) are never
// touched. AI-relevant items are protected: any post that ALSO matches an
// on-topic marker is excluded from the candidate set.
//
//   DATABASE_URL=postgres://… node scripts/find-offtopic-news.mjs            # dry run
//   DATABASE_URL=postgres://… node scripts/find-offtopic-news.mjs --apply    # untag candidates
//
// Always run the dry run first and eyeball the list before --apply.

import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// Mirrors src/relevance.ts in the bot. OFF-topic = unambiguous non-tech markers.
const OFF_TOPIC = [
  'гороскоп',
  'футбол',
  'матч',
  'погода',
  'шоу-бизнес',
  'знаменитост',
  'свадьб',
  'развод',
  'диета',
  'рецепт',
  'сериал',
  'спорт',
  'олимпиад',
  'эстрад',
  'певиц',
  'певец',
  'актрис',
  'актёр',
  'мода',
  'гламур',
  'липа',
  'платье',
];
// ON-topic guard — if a post matches any of these it is NOT a cleanup candidate,
// even if it tripped an off-topic word (e.g. "ИИ предсказал погоду").
const ON_TOPIC = [
  'ии',
  'нейросет',
  'llm',
  'gpt',
  'claude',
  'openai',
  'anthropic',
  'чип',
  'процессор',
  'gpu',
  'разработ',
  'opensource',
  'алгоритм',
  'программир',
  'kubernetes',
  'linux',
  'ai',
  'ml',
  'модель',
  'датасет',
  'трансформер',
  'агент',
];

const NEWS_TAG = 'новости';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n  DATABASE_URL=postgres://… node scripts/find-offtopic-news.mjs'
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Build a Postgres regex alternation from a marker list (already lowercase).
const offRe = OFF_TOPIC.join('|');
const onRe = ON_TOPIC.map((w) => `\\m${w}`).join('|'); // \m = word boundary, avoids 'ai' in 'кайф' etc.

async function main() {
  // News posts that match an off-topic marker AND do NOT match any on-topic one.
  const findSql = `
    SELECT id, title, tags, created_at
      FROM posts
     WHERE tags @> $1::jsonb
       AND lower(title || ' ' || coalesce(description,'')) ~ $2
       AND lower(title || ' ' || coalesce(description,'')) !~ $3
     ORDER BY created_at DESC`;
  const params = [JSON.stringify([NEWS_TAG]), offRe, onRe];

  const { rows } = await pool.query(findSql, params);

  const totalNews = (
    await pool.query(`SELECT count(*)::int AS n FROM posts WHERE tags @> $1::jsonb`, [
      JSON.stringify([NEWS_TAG]),
    ])
  ).rows[0].n;

  console.log(`\n=== Off-topic news cleanup ${APPLY ? '(APPLY)' : '(dry run)'} ===`);
  console.log(`news posts total            : ${totalNews}`);
  console.log(`off-topic candidates        : ${rows.length}`);
  console.log('(matched an off-topic marker, no on-topic marker; on-topic items are protected)\n');

  if (rows.length === 0) {
    console.log('Nothing to clean up. ✅');
    return;
  }

  for (const r of rows) {
    const when = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '????-??-??';
    console.log(`  ${when}  ${r.title}`);
  }

  if (!APPLY) {
    console.log(
      `\nDry run — nothing changed. Review the list above. If it looks right, re-run\n` +
        `with --apply to remove the '${NEWS_TAG}' tag from these ${rows.length} posts (they\n` +
        `leave /news but are NOT deleted — re-add the tag to undo).`
    );
    return;
  }

  // --apply: remove the news tag from the matched ids only.
  const ids = rows.map((r) => r.id);
  const untagSql = `
    UPDATE posts
       SET tags = (
         SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
           FROM jsonb_array_elements(tags) t
          WHERE t <> $1::jsonb
       )
     WHERE id = ANY($2::text[])`;
  const res = await pool.query(untagSql, [JSON.stringify(NEWS_TAG), ids]);
  console.log(`\nUntagged ${res.rowCount} post(s) — they no longer appear in /news.`);
  console.log(`Reversible: re-add "${NEWS_TAG}" to a post's tags to restore it.`);
}

main()
  .catch((err) => {
    console.error('find-offtopic-news failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
