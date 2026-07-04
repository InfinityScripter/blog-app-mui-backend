#!/usr/bin/env node
// Changelog seed — loads a curated set of real AI model releases into the
// `model_releases` table so /changelog is populated on a fresh/empty deploy.
//
// IDEMPOTENT: inserts with ON CONFLICT (slug) DO NOTHING, so re-running never
// duplicates and never overwrites a release that already exists (e.g. one the
// bot published). Slug is computed exactly like the backend's slugify + the
// modelReleaseService.create fallback (`vendor-model-version`), so a seeded row
// and a bot/API row for the same release collide on slug and only one wins.
//
// Connects with DATABASE_URL — the same var the API uses. Dry-run by default;
// pass --apply to actually write.
//
//   DATABASE_URL=postgres://… node scripts/seed-changelog.mjs            # dry run (prints plan)
//   DATABASE_URL=postgres://… node scripts/seed-changelog.mjs --apply    # insert missing releases
//
// Data lives in scripts/changelog-seed-data.json (one object per release,
// matching the frozen CreateReleasePayload contract).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const APPLY = process.argv.includes('--apply');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'changelog-seed-data.json');

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Example:\n  DATABASE_URL=postgres://… node scripts/seed-changelog.mjs --apply'
  );
  process.exit(1);
}

// Mirror of backend src/utils/slug.ts — keep in sync. Lowercase, collapse any
// non-alphanumeric run into a single hyphen, trim leading/trailing hyphens.
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Same fallback the API uses when no explicit slug is given.
function slugFor(release) {
  return release.slug
    ? slugify(release.slug)
    : slugify(`${release.vendor}-${release.model}-${release.version}`);
}

function loadReleases() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const releases = JSON.parse(raw);
  if (!Array.isArray(releases)) {
    throw new Error('changelog-seed-data.json must be a JSON array');
  }
  return releases;
}

// Guard against a malformed data file silently seeding junk. Mirrors the zod
// schema's required/nullable fields without pulling zod into a plain .mjs.
function validate(release, index) {
  const problems = [];
  const req = ['vendor', 'model', 'version', 'releasedAt', 'sourceUrl'];
  req.forEach((key) => {
    if (key === 'version') {
      if (typeof release.version !== 'string') problems.push('version must be a string');
      return;
    }
    if (typeof release[key] !== 'string' || release[key].trim() === '') {
      problems.push(`${key} must be a non-empty string`);
    }
  });
  if (release.releasedAt && Number.isNaN(Date.parse(release.releasedAt))) {
    problems.push(`releasedAt is not a valid date: ${release.releasedAt}`);
  }
  ['contextTokens', 'priceIn', 'priceOut'].forEach((key) => {
    const v = release[key];
    if (v !== null && v !== undefined && typeof v !== 'number') {
      problems.push(`${key} must be a number or null`);
    }
  });
  if (release.changes !== undefined && !Array.isArray(release.changes)) {
    problems.push('changes must be an array');
  }
  if (problems.length) {
    throw new Error(`Release #${index} (${release.model ?? '?'}) invalid: ${problems.join('; ')}`);
  }
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  const releases = loadReleases();
  releases.forEach(validate);

  // Detect duplicate slugs inside the data file itself before touching the DB.
  const slugs = releases.map(slugFor);
  const seen = new Set();
  const dupes = slugs.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
  if (dupes.length) {
    throw new Error(`Duplicate slugs in seed data: ${[...new Set(dupes)].join(', ')}`);
  }

  const existing = await pool.query('SELECT slug FROM model_releases');
  const existingSlugs = new Set(existing.rows.map((r) => r.slug));

  const toInsert = releases.filter((r) => !existingSlugs.has(slugFor(r)));
  const skipped = releases.length - toInsert.length;

  console.log(`Seed data:   ${releases.length} releases`);
  console.log(`Already in DB: ${existingSlugs.size} releases`);
  console.log(`Will insert:  ${toInsert.length}`);
  console.log(`Skipped (slug already present): ${skipped}`);

  if (!toInsert.length) {
    console.log('\nNothing to insert — DB already has every seeded release.');
    return;
  }

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to write. Would insert:');
    toInsert
      .slice()
      .sort((a, b) => Date.parse(a.releasedAt) - Date.parse(b.releasedAt))
      .forEach((r) => {
        console.log(
          `  ${r.releasedAt.slice(0, 10)}  ${r.vendor.padEnd(10)} ${r.model} ${r.version}`.trimEnd()
        );
      });
    return;
  }

  let inserted = 0;
  // Sequential inserts (few dozen rows) keep the ON CONFLICT semantics simple
  // and the output ordered; performance is irrelevant at this size.
  await toInsert.reduce(
    (chain, release) =>
      chain.then(async () => {
        const id = crypto.randomUUID();
        const slug = slugFor(release);
        const result = await pool.query(
          `INSERT INTO model_releases
             (id, vendor, model, version, slug, released_at, context_tokens,
              price_in, price_out, changes, verdict, source_url, source_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
           ON CONFLICT (slug) DO NOTHING
           RETURNING id`,
          [
            id,
            release.vendor,
            release.model,
            release.version,
            slug,
            release.releasedAt,
            release.contextTokens ?? null,
            release.priceIn ?? null,
            release.priceOut ?? null,
            JSON.stringify(release.changes ?? []),
            release.verdict ?? null,
            release.sourceUrl,
            release.sourceName ?? null,
          ]
        );
        if (result.rowCount > 0) {
          inserted += 1;
          console.log(`  + ${release.vendor} ${release.model} ${release.version}`.trimEnd());
        }
      }),
    Promise.resolve()
  );

  console.log(`\nInserted ${inserted} release(s).`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
