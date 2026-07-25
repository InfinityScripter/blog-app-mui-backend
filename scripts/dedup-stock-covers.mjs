#!/usr/bin/env node
// Post-cover de-duplication for the EXISTING backlog.
//
// On the live DB (2026-07-25) 136 posts shared 92 covers: 69 of them sat on an
// auto-assigned stock photo, but only 26 DISTINCT ones — one image was on 5
// posts, several on 4. Cause: the news bot picked `pool[candidateId % poolSize]`
// from the pool matching the post's topic, and nearly every post is AI-tagged,
// so 62 posts rotated 19 images while 80 others went unused.
//
// The runtime fix moved cover assignment to the blog (src/services/cover-assign.ts),
// where posts.cover_url IS the ledger of what is taken. This script applies the
// same rule to the posts already published: for every cover carried by MORE THAN
// ONE post, the OLDEST post keeps it and each later one gets a cover no post
// uses. Result: every auto-assigned cover appears exactly once.
//
// SCOPE — a post is a candidate ONLY when its cover is one of the auto-assigned
// ones (src/data/cover-pool.json: the stock URLs or the bundled /assets covers)
// AND that cover is shared with an older post. Left untouched: the article's own
// image scraped from the source, uploads (/api/file/…), and any auto cover that
// is already unique. Duplicated NON-pool covers are reported, never rewritten —
// two posts sharing a source image is the source's business, not ours.
//
// Deterministic and idempotent: candidates are processed oldest-first and free
// covers are handed out in pool order, so a re-run after --apply finds nothing
// left to do. Reversible — it only rewrites cover_url (and bumps updated_at).
//
// Offline: no Unsplash key needed. The static pool has enough free slots for the
// backlog; if it ever doesn't, the script says so instead of reusing an image.
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

// The SAME data file the runtime reads (src/data/cover-pool.json) — the pool
// used to be copy-pasted per consumer and the copies drifted.
const {
  pools: POOLS,
  tagMap: TAG_TO_TOPIC,
  bundled: BUNDLED,
} = JSON.parse(readFileSync(new URL('../src/data/cover-pool.json', import.meta.url), 'utf8'));

const STOCK = [...new Set(Object.values(POOLS).flat())];
// Priority order when handing out a free cover: stock first, bundled assets as
// the tail — mirrors the ladder in src/services/cover-assign.ts.
const INVENTORY = [...STOCK, ...BUNDLED];
const AUTO_COVERS = new Set(INVENTORY);

/** First tag with a topic mapping wins; null = no topical preference. */
function topicalCovers(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const topic = list.map((tag) => TAG_TO_TOPIC[String(tag).toLowerCase().trim()]).find(Boolean);
  return topic && POOLS[topic] ? POOLS[topic] : [];
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n  DATABASE_URL=postgres://… node scripts/dedup-stock-covers.mjs'
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DATABASE_URL });

function countBy(covers) {
  const counts = new Map();
  for (const cover of covers) counts.set(cover, (counts.get(cover) ?? 0) + 1);
  return counts;
}
const shortUrl = (url) => (url.length > 60 ? `${url.slice(0, 57)}…` : url);

async function main() {
  const { rows } = await pool.query(
    'SELECT id, title, cover_url, tags, created_at FROM posts ORDER BY created_at ASC, id ASC'
  );
  const counts = countBy(rows.map((row) => row.cover_url).filter(Boolean));

  // Duplicated covers we do NOT own — reported for visibility only.
  const foreignDupes = [...counts.entries()].filter(
    ([cover, n]) => n > 1 && !AUTO_COVERS.has(cover)
  );

  // Oldest post on each duplicated auto cover keeps it; every later one moves.
  const seen = new Set();
  const toReassign = [];
  for (const row of rows) {
    if (!AUTO_COVERS.has(row.cover_url)) continue;
    if (seen.has(row.cover_url)) toReassign.push(row);
    else seen.add(row.cover_url);
  }

  // Free = never used by ANY post (including the ones we are about to free up:
  // those stay with their oldest holder, so they are not free).
  const used = new Set(rows.map((row) => row.cover_url).filter(Boolean));
  const free = INVENTORY.filter((cover) => !used.has(cover));
  const freeSet = new Set(free);

  const take = (tags) => {
    // Topical first, then anything free — an off-topic but unique cover beats
    // the same photo twice (the whole point of the fix).
    const topical = topicalCovers(tags).find((cover) => freeSet.has(cover));
    const chosen = topical ?? free.find((cover) => freeSet.has(cover));
    if (chosen) freeSet.delete(chosen);
    return chosen ?? null;
  };

  const changes = [];
  const unresolved = [];
  for (const row of toReassign) {
    const to = take(row.tags);
    if (to) changes.push({ id: row.id, from: row.cover_url, to, title: row.title });
    else unresolved.push(row);
  }

  const worstBefore = Math.max(0, ...[...counts.values()]);
  console.log(`\n=== Cover dedup ${APPLY ? '(APPLY)' : '(dry run)'} ===`);
  console.log(`posts total                        : ${rows.length}`);
  console.log(`distinct covers                    : ${counts.size}`);
  console.log(`most posts on ONE cover (before)   : ${worstBefore}`);
  console.log(`duplicate posts to re-cover        : ${toReassign.length}`);
  console.log(`free covers in the pool            : ${free.length} of ${INVENTORY.length}`);
  console.log(`free left after this run           : ${freeSet.size}`);

  if (foreignDupes.length > 0) {
    console.log('\nDuplicated covers NOT from the pool (left untouched by design):');
    for (const [cover, n] of foreignDupes)
      console.log(`  ${String(n).padStart(3)}  ${shortUrl(cover)}`);
  }
  if (unresolved.length > 0) {
    console.log(
      `\n⚠️  ${unresolved.length} post(s) stay duplicated — the pool ran out of free covers.` +
        '\n   Add URLs to src/data/cover-pool.json and re-run.'
    );
  }

  if (changes.length === 0) {
    console.log('\nNothing to dedup — every auto-assigned cover is already unique. ✅');
    return;
  }
  if (!APPLY) {
    console.log('\nPlanned changes (first 12):');
    for (const change of changes.slice(0, 12)) {
      console.log(`  ${shortUrl(change.from)}\n    → ${shortUrl(change.to)}   [${change.title}]`);
    }
    if (changes.length > 12) console.log(`  … and ${changes.length - 12} more`);
    console.log('\nDry run — nothing changed. Re-run with --apply when the numbers look right.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Guard on the scanned cover (from_cover): a post re-covered in the app
    // between scan and write no longer matches and is skipped, not clobbered.
    const res = await client.query(
      `UPDATE posts AS p
          SET cover_url = v.cover, cover_credit_name = NULL, cover_credit_url = NULL, updated_at = NOW()
         FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, cover, from_cover)
        WHERE p.id = v.id AND p.cover_url = v.from_cover`,
      [changes.map((c) => c.id), changes.map((c) => c.to), changes.map((c) => c.from)]
    );
    await client.query('COMMIT');
    console.log(`\nUpdated ${res.rowCount} post cover(s).`);
    if (res.rowCount < changes.length) {
      console.log(
        `Note: ${changes.length - res.rowCount} candidate(s) changed between scan and write — skipped (guard held).`
      );
    }
    console.log('Re-running is a no-op; restore from the backup to undo.');
    // The script writes straight to the DB, so Next.js ISR (revalidate = 3600)
    // keeps serving the old covers for up to an hour. Nothing here can clear it:
    // the frontend's /api/revalidate is guarded by an admin session cookie.
    console.log(
      'Public pages are ISR-cached for up to 1h — trigger a revalidate from the\n' +
        'admin panel (or just wait) for the new covers to show on the site.'
    );
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
