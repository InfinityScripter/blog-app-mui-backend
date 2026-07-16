#!/usr/bin/env node
// Post cover backfill + de-duplication.
//
// Two problems this fixes on EXISTING posts:
//   1) Posts with NO cover at all (cover_url = '') — the column defaults to ''
//      and a few legacy rows never got one, so they render a broken image.
//   2) Posts that all share the SAME cover — every post created without an
//      explicit cover used to collapse onto cover-1.webp (the old single
//      default). The once-daily news-bot batch omits coverUrl, so its posts are
//      the bulk of these: past posts look identical.
//
// The fix mirrors the backend's new behaviour (src/utils/post-payload.ts
// pickDefaultCover): deterministically spread each affected post across the 24
// bundled cover images, seeded on the post title. Same seed → same cover, so the
// script is IDEMPOTENT — re-running assigns the identical covers and only ever
// touches posts still empty or still on the old default.
//
// SCOPE — a post is a candidate ONLY when its cover is:
//   • '' (empty), or
//   • the legacy default '/assets/images/cover/cover-1.webp'.
// Anything else is left untouched: uploaded covers ('/api/file/…'), external
// URLs, and any other deliberately-chosen '/assets/images/cover/cover-N.webp'
// (N ≠ 1). Reversible — it only rewrites cover_url; re-run or restore from the
// backup to undo.
//
// SAFE BY DEFAULT — dry run. Prints what WOULD change and touches nothing.
//
//   DATABASE_URL=postgres://… node scripts/backfill-post-covers.mjs                 # dry run
//   DATABASE_URL=postgres://… node scripts/backfill-post-covers.mjs --apply         # write covers
//   DATABASE_URL=postgres://… node scripts/backfill-post-covers.mjs --report-files  # + duplicate-blob report
//
// SAFETY: back up first (on the VDS):
//   sudo -u postgres pg_dump blog_app > ~/blog_app_backup_$(date +%F).sql
// Always run the dry run first and eyeball the counts before --apply.

import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const REPORT_FILES = process.argv.includes('--report-files');

// Keep in sync with public/assets/images/cover (cover-1.webp … cover-24.webp)
// and src/utils/post-payload.ts.
const COVER_ASSET_BASE = '/assets/images/cover';
const COVER_ASSET_COUNT = 24;
const LEGACY_DEFAULT_COVER = `${COVER_ASSET_BASE}/cover-1.webp`;

/**
 * Deterministic cover picker — a byte-for-byte port of pickDefaultCover in
 * src/utils/post-payload.ts (polynomial rolling hash → 1…24). A backfilled post
 * gets the exact cover the backend would now assign a fresh post with the same
 * title.
 */
function pickDefaultCover(seed) {
  const key = (seed ?? '').trim();
  if (!key) {
    return LEGACY_DEFAULT_COVER;
  }

  // Polynomial rolling hash — arithmetic only, byte-for-byte identical to
  // pickDefaultCover in src/utils/post-payload.ts.
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 1000000007;
  }

  const index = (hash % COVER_ASSET_COUNT) + 1; // 1 … 24
  return `${COVER_ASSET_BASE}/cover-${index}.webp`;
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n' +
      '  DATABASE_URL=postgres://… node scripts/backfill-post-covers.mjs'
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** Renders a compact "coverN×count" distribution of the assigned covers. */
function summarizeDistribution(covers) {
  const counts = new Map();
  for (const cover of covers) {
    counts.set(cover, (counts.get(cover) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cover, n]) => [cover.replace(`${COVER_ASSET_BASE}/`, '').replace('.webp', ''), n])
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}×${n}`)
    .join('  ');
}

async function reportDuplicateFileBlobs() {
  // Informational + read-only: identical uploaded blobs stored more than once
  // (same bytes → same md5). Deduping the files table is out of scope for this
  // script (it re-points coverUrls and is riskier); this just surfaces whether
  // it's worth doing.
  const { rows } = await pool.query(`
    SELECT md5(data) AS digest, count(*)::int AS copies, sum(size)::bigint AS total_bytes
      FROM files
     GROUP BY md5(data)
    HAVING count(*) > 1
     ORDER BY copies DESC, total_bytes DESC`);

  console.log('\n=== Duplicate uploaded file blobs (informational, read-only) ===');
  if (rows.length === 0) {
    console.log('No byte-identical duplicate blobs in the files table. ✅');
    return;
  }
  const wastedBytes = rows.reduce(
    (sum, r) => sum + Number(r.total_bytes) - Number(r.total_bytes) / r.copies,
    0
  );
  console.log(`distinct images stored more than once : ${rows.length}`);
  console.log(
    `~reclaimable if deduped               : ${(wastedBytes / 1024 / 1024).toFixed(2)} MiB`
  );
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.digest}  ×${r.copies}`);
  }
  if (rows.length > 20) {
    console.log(`  … and ${rows.length - 20} more`);
  }
  console.log('(files-table dedup is a separate, larger change — not done here.)');
}

async function main() {
  const total = (await pool.query('SELECT count(*)::int AS n FROM posts')).rows[0].n;

  // Candidates: empty cover OR the legacy single default. Order is stable so
  // dry-run and --apply operate on the same set.
  const { rows } = await pool.query(
    `SELECT id, title, cover_url
       FROM posts
      WHERE cover_url = '' OR cover_url = $1
      ORDER BY created_at ASC, id ASC`,
    [LEGACY_DEFAULT_COVER]
  );

  const empties = rows.filter((r) => r.cover_url === '');
  const legacyDefaults = rows.filter((r) => r.cover_url === LEGACY_DEFAULT_COVER);

  // Seed on title (matches the backend), fall back to id for the rare untitled row.
  const planned = rows.map((r) => ({
    id: r.id,
    title: r.title,
    from: r.cover_url,
    to: pickDefaultCover(r.title || r.id),
  }));
  // A cover-1 post whose title happens to hash back to cover-1 is already
  // "correct" and doesn't need writing; empty covers always need writing.
  const changes = planned.filter((p) => p.to !== p.from);

  console.log(`\n=== Post cover backfill ${APPLY ? '(APPLY)' : '(dry run)'} ===`);
  console.log(`posts total                       : ${total}`);
  console.log(`without a cover (cover_url = '')   : ${empties.length}`);
  console.log(`on the legacy default (cover-1)    : ${legacyDefaults.length}`);
  console.log(`will be (re)assigned a cover       : ${changes.length}`);
  if (changes.length > 0) {
    console.log(
      `new cover spread                  : ${summarizeDistribution(changes.map((c) => c.to))}`
    );
  }

  if (REPORT_FILES) {
    await reportDuplicateFileBlobs();
  }

  if (changes.length === 0) {
    console.log('\nNothing to backfill — every post already has a diversified cover. ✅');
    return;
  }

  if (!APPLY) {
    console.log('\nSample of planned changes (first 15):');
    for (const c of changes.slice(0, 15)) {
      const to = c.to.replace(`${COVER_ASSET_BASE}/`, '').replace('.webp', '');
      const from =
        c.from === '' ? '(empty)' : c.from.replace(`${COVER_ASSET_BASE}/`, '').replace('.webp', '');
      console.log(`  ${from} → ${to}   ${c.title}`);
    }
    if (changes.length > 15) {
      console.log(`  … and ${changes.length - 15} more`);
    }
    console.log(
      '\nDry run — nothing changed. If the counts look right, re-run with --apply.\n' +
        'Only empty covers and the old cover-1 default are touched; uploaded and\n' +
        'deliberately-chosen covers are left alone. Reversible via the pg_dump backup.'
    );
    return;
  }

  // --apply: one bulk UPDATE, in a transaction. Two array params via unnest —
  // no per-row placeholders (dodges the 65535-param cap and any VALUES type
  // inference quirks), explicit ::text[] casts pin the column types.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = changes.map((c) => c.id);
    const covers = changes.map((c) => c.to);
    const res = await client.query(
      `UPDATE posts AS p
          SET cover_url = v.cover, updated_at = NOW()
         FROM unnest($1::text[], $2::text[]) AS v(id, cover)
        WHERE p.id = v.id`,
      [ids, covers]
    );
    await client.query('COMMIT');
    console.log(`\nUpdated ${res.rowCount} post cover(s).`);
    console.log('Reversible: re-run assigns the same covers, or restore from the backup.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('backfill-post-covers failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
