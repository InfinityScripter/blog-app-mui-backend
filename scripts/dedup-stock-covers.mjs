#!/usr/bin/env node
// Stock-cover de-duplication for the EXISTING post backlog.
//
// The real cover duplication on the blog is not cover-1 (that's
// backfill-post-covers.mjs) but the news bot reusing a handful of Unsplash stock
// photos: on the live DB one image sat on 11 posts, another on 9, a third on 7.
// The bot picks covers from topical pools (ai-bot-tg src/blog/defaultCovers.ts),
// but bare `новости` posts (the majority) fell to a tiny universal pool, so they
// cycled the same few images. The bot side is fixed separately; this script
// re-spreads the EXISTING posts across each topic's full pool so they stop
// repeating.
//
// The pools live in scripts/cover-pools.json — a snapshot ported verbatim from
// ai-bot-tg src/blog/defaultCovers.ts (99 verified Unsplash image URLs), same
// pattern as seed-changelog.mjs + changelog-seed-data.json. A post is a candidate
// ONLY if its cover is one of those URLs (i.e. an auto-assigned bot cover).
// Feed/og images (e.g. 3dnews.ru), uploads (/api/file/...), the bundled /assets
// covers, and anything else are LEFT UNTOUCHED.
//
// For each candidate the post's tags choose a topical pool (same mapping as the
// bot); within that pool the posts are ordered by created_at and assigned
// pool[i % poolSize], so a topic's posts cycle its whole pool before any repeat.
// Deterministic + idempotent (stable order → same assignment), so re-running is a
// no-op once spread. --apply guards each write on the scanned cover, so a post
// re-covered in the app meanwhile is skipped, not clobbered.
//
// SAFE BY DEFAULT — dry run.
//   DATABASE_URL=postgres://… node scripts/dedup-stock-covers.mjs            # dry run
//   DATABASE_URL=postgres://… node scripts/dedup-stock-covers.mjs --apply    # write
//
// SAFETY: back up first (on the VDS):
//   cd /tmp && sudo -u postgres pg_dump blog_app > /root/blog_app_backup_$(date +%F).sql

import { readFileSync } from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// Topical Unsplash cover pools + tag→pool map, ported from ai-bot-tg
// src/blog/defaultCovers.ts. Kept as data (not code) so a re-port is a data edit.
const { pools: POOLS, tagMap: TAG_TO_POOL } = JSON.parse(
  readFileSync(new URL('./cover-pools.json', import.meta.url), 'utf8')
);

// Universal fallback = the full de-duplicated union of every topical pool
// (matches the bot fix). Also the membership set for "is this a bot cover?".
const UNIVERSAL = [...new Set(Object.values(POOLS).flat())];
const POOL_SET = new Set(UNIVERSAL);

/** First topical tag that maps to a pool wins; else the universal pool. */
function poolFor(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const id = list.map((tag) => TAG_TO_POOL[String(tag).toLowerCase().trim()]).find(Boolean);
  return id && POOLS[id] ? POOLS[id] : UNIVERSAL;
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n  DATABASE_URL=postgres://… node scripts/dedup-stock-covers.mjs'
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });

function topCounts(covers, n) {
  const counts = new Map();
  for (const cover of covers) counts.set(cover, (counts.get(cover) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
const shortUrl = (url) => (url.length > 60 ? `${url.slice(0, 57)}…` : url);

async function main() {
  const { rows } = await pool.query(
    'SELECT id, title, cover_url, tags, created_at FROM posts ORDER BY created_at ASC, id ASC'
  );
  // Candidates: posts whose cover is one of the bot's stock pool URLs.
  const candidates = rows.filter((row) => POOL_SET.has(row.cover_url));

  // Group candidates by their topical pool (stable created_at order preserved).
  const byPool = new Map();
  for (const row of candidates) {
    const themePool = poolFor(row.tags);
    if (!byPool.has(themePool)) byPool.set(themePool, []);
    byPool.get(themePool).push(row);
  }
  // Assign pool[i % size] within each group; keep only the real changes.
  const changes = [];
  for (const [themePool, group] of byPool) {
    group.forEach((row, i) => {
      const to = themePool[i % themePool.length];
      if (to !== row.cover_url) {
        changes.push({ id: row.id, from: row.cover_url, to, title: row.title });
      }
    });
  }

  const beforeTop = topCounts(
    candidates.map((row) => row.cover_url),
    6
  );
  const afterByCover = new Map(changes.map((change) => [change.id, change.to]));
  const afterTop = topCounts(
    candidates.map((row) => afterByCover.get(row.id) ?? row.cover_url),
    6
  );

  console.log(`\n=== Stock-cover dedup ${APPLY ? '(APPLY)' : '(dry run)'} ===`);
  console.log(`posts total                        : ${rows.length}`);
  console.log(`on a bot stock cover (candidates)  : ${candidates.length}`);
  console.log(`will be re-spread                  : ${changes.length}`);
  console.log(`most-duplicated BEFORE             : ${beforeTop[0]?.[1] ?? 0} posts on one cover`);
  console.log(`most-duplicated AFTER              : ${afterTop[0]?.[1] ?? 0} posts on one cover`);
  if (beforeTop.length > 0) {
    console.log('\ntop covers BEFORE:');
    for (const [cover, n] of beforeTop)
      console.log(`  ${String(n).padStart(3)}  ${shortUrl(cover)}`);
  }

  if (changes.length === 0) {
    console.log('\nNothing to dedup — stock covers are already spread. ✅');
    return;
  }
  if (!APPLY) {
    console.log('\nSample of planned changes (first 12):');
    for (const change of changes.slice(0, 12)) {
      console.log(`  ${shortUrl(change.from)}  →  ${shortUrl(change.to)}   ${change.title}`);
    }
    if (changes.length > 12) console.log(`  … and ${changes.length - 12} more`);
    console.log('\nDry run — nothing changed. Re-run with --apply if the AFTER count looks right.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = changes.map((change) => change.id);
    const tos = changes.map((change) => change.to);
    const froms = changes.map((change) => change.from);
    // Guard on the scanned cover (from_cover): a post re-covered in the app
    // between scan and write no longer matches and is skipped, not clobbered.
    const res = await client.query(
      `UPDATE posts AS p
          SET cover_url = v.cover, updated_at = NOW()
         FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, cover, from_cover)
        WHERE p.id = v.id AND p.cover_url = v.from_cover`,
      [ids, tos, froms]
    );
    await client.query('COMMIT');
    console.log(`\nUpdated ${res.rowCount} post cover(s).`);
    if (res.rowCount < changes.length) {
      console.log(
        `Note: ${changes.length - res.rowCount} candidate(s) changed between scan and write — skipped (guard held).`
      );
    }
    console.log('Reversible: re-run is a no-op, or restore from the backup.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('dedup-stock-covers failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
