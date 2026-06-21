#!/usr/bin/env node
// Relevance shadow-mode calibration summary.
//
// The news bot mirrors every relevance-filter decision into the audit log
// (actions bot.relevance_shadow_dropped / _dropped / _kept). Before flipping the
// bot to RELEVANCE_MODE=on, run this to see WHAT the filter would have dropped,
// so you can sanity-check it isn't eating good AI/tech stories.
//
// READ-ONLY. Never writes. Connects with DATABASE_URL (same var the API uses).
//
//   DATABASE_URL=postgres://… node scripts/relevance-shadow-summary.mjs [--days 14] [--limit 30]
//
// --days  N  : only look at the last N days of decisions (default 14).
// --limit N  : how many sample "would-drop" titles to print (default 30).

import pg from 'pg';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const DAYS = arg('--days', 14);
const SAMPLE_LIMIT = arg('--limit', 30);

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n  DATABASE_URL=postgres://… node scripts/relevance-shadow-summary.mjs'
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

async function main() {
  const since = `${DAYS} days`;

  // Counts by action (kept / shadow-dropped / dropped) in the window.
  const byAction = await pool.query(
    `SELECT action, count(*)::int AS n
       FROM audit_logs
      WHERE action LIKE 'bot.relevance%'
        AND created_at >= NOW() - $1::interval
      GROUP BY action
      ORDER BY action`,
    [since]
  );

  const counts = Object.fromEntries(byAction.rows.map((r) => [r.action, r.n]));
  const kept = counts['bot.relevance_kept'] ?? 0;
  const shadowDropped = counts['bot.relevance_shadow_dropped'] ?? 0;
  const dropped = counts['bot.relevance_dropped'] ?? 0;
  const total = kept + shadowDropped + dropped;

  console.log(`\n=== Relevance decisions — last ${DAYS} days ===`);
  if (total === 0) {
    console.log(
      'No bot.relevance_* audit rows yet. The bot logs decisions on each cron run\n' +
        '(default 09:00 Europe/Moscow). Wait for a run or trigger /fetch, then re-run.'
    );
    return;
  }
  console.log(`total decisions emitted : ${total}`);
  console.log(`  kept (LLM/fail-open)  : ${kept}  (${pct(kept, total)})`);
  console.log(`  WOULD-drop (shadow)   : ${shadowDropped}  (${pct(shadowDropped, total)})`);
  console.log(`  actually dropped (on) : ${dropped}  (${pct(dropped, total)})`);

  // Breakdown of would-drop by stage (blocklist vs llm) — blocklist drops are
  // keyword-certain; llm drops are the ones to eyeball for false negatives.
  const byStage = await pool.query(
    `SELECT COALESCE(metadata->>'stage','?') AS stage, count(*)::int AS n
       FROM audit_logs
      WHERE action IN ('bot.relevance_shadow_dropped','bot.relevance_dropped')
        AND created_at >= NOW() - $1::interval
      GROUP BY 1 ORDER BY n DESC`,
    [since]
  );
  if (byStage.rows.length) {
    console.log('\n--- would-drop by stage ---');
    for (const r of byStage.rows) console.log(`  ${r.stage.padEnd(10)} ${r.n}`);
  }

  // Sample of would-drop titles + reason — eyeball for AI/tech stories that
  // should NOT have been dropped (false negatives). LLM-stage drops first, since
  // those are the judgement calls (blocklist drops are keyword-obvious).
  const sample = await pool.query(
    `SELECT metadata->>'title' AS title,
            metadata->>'stage' AS stage,
            metadata->>'score' AS score,
            metadata->>'reason' AS reason
       FROM audit_logs
      WHERE action IN ('bot.relevance_shadow_dropped','bot.relevance_dropped')
        AND created_at >= NOW() - $1::interval
      ORDER BY (metadata->>'stage' = 'llm') DESC, created_at DESC
      LIMIT $2`,
    [since, SAMPLE_LIMIT]
  );
  if (sample.rows.length) {
    console.log(
      `\n--- would-drop sample (≤${SAMPLE_LIMIT}, LLM-stage first — check for false drops) ---`
    );
    for (const r of sample.rows) {
      const score = r.score == null ? '-' : r.score;
      console.log(`  [${(r.stage ?? '?').padEnd(9)} score=${score}] ${r.title ?? '(no title)'}`);
      if (r.reason) console.log(`      ↳ ${r.reason}`);
    }
  }

  console.log(
    '\nNext: if the would-drop list looks right (no good AI/tech stories), set\n' +
      'RELEVANCE_MODE=on in the bot .env.production and restart blog-newsbot.\n'
  );
}

main()
  .catch((err) => {
    console.error('relevance-shadow-summary failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
