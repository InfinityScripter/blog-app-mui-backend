# Ops scripts

Standalone Node scripts (plain `.mjs`, use the `pg` dependency directly — no
Next runtime, no build step). They connect with `DATABASE_URL`, the same var the
API uses. Run them against prod by exporting the prod `DATABASE_URL`.

## `relevance-shadow-summary.mjs` — calibrate the bot relevance filter

The news bot runs a topic-relevance filter in **shadow mode** by default: it
logs every decision to the audit log (`bot.relevance_*`) but drops nothing. This
script summarizes those decisions so you can check the filter isn't eating good
AI/tech stories before you flip it to `RELEVANCE_MODE=on`.

```bash
DATABASE_URL=postgres://… npm run relevance:summary -- --days 14 --limit 30
```

Read-only. Prints kept vs would-drop counts, a stage breakdown, and a sample of
would-drop titles (LLM-stage first — those are the judgement calls to eyeball).
When the would-drop list looks right, set `RELEVANCE_MODE=on` in the bot's
`.env.production` and restart `blog-newsbot`.

## `find-offtopic-news.mjs` — clean up legacy off-topic news

Old posts from the bot's early general-news feeds (fashion/celebrity/sport) are
tagged `новости` and still show in `/news`. This finds them.

```bash
# 1) DRY RUN — review the candidate list, changes nothing:
DATABASE_URL=postgres://… npm run news:offtopic

# 2) Only after the list looks right — remove the 'новости' tag from them:
DATABASE_URL=postgres://… npm run news:offtopic -- --apply
```

`--apply` removes the `новости` tag (so the post leaves `/news`); it does **not**
delete the row — re-add the tag to undo. Hand-written blog posts (no `новости`
tag) are never touched, and any post that also matches an on-topic AI/tech marker
is protected from the cleanup.

## `backfill-post-covers.mjs` — diversify duplicated covers + fill missing ones

Every post created without an explicit cover used to collapse onto the single
default `cover-1.webp`, so past posts (chiefly the once-daily news-bot batch,
whose publisher omits `coverUrl`) all looked identical; a few legacy rows have no
cover at all (`cover_url = ''`). The backend now spreads new posts across the 24
bundled covers deterministically (`pickDefaultCover` in
`src/utils/post-payload.ts`); this script applies the same fix to the existing
backlog.

```bash
# 1) DRY RUN — prints the counts + a sample of planned changes, touches nothing:
DATABASE_URL=postgres://… npm run posts:covers

# 2) Only after the counts look right — write the diversified covers:
DATABASE_URL=postgres://… npm run posts:covers -- --apply

# Optional: also print a read-only report of byte-identical duplicate uploads:
DATABASE_URL=postgres://… npm run posts:covers -- --report-files
```

Scope: only posts whose cover is empty **or** the legacy `cover-1.webp` default
are touched — uploaded covers (`/api/file/…`), external URLs, and any other
deliberately-chosen `cover-N.webp` are left alone. Deterministic and idempotent
(same title → same cover), so re-running is safe and only ever touches rows still
empty or still on the old default. It rewrites `cover_url` only — reversible via
the `pg_dump` backup (take one first). `--report-files` is informational only:
files-table blob dedup is a separate, larger change and is **not** performed here.

## `dedup-stock-covers.mjs` — make every auto-assigned cover unique

The real cover-duplication source was never `cover-1` but the news bot rotating
`pool[candidateId % poolSize]` inside the pool matching the post's topic. Nearly
every post is AI-tagged, so 62 posts cycled 19 images while 80 others went
unused: on the live DB (2026-07-25) 69 stock-covered posts shared just 26
distinct photos, one of them on 5 posts. Cover assignment now lives in the blog
(`src/services/cover-assign.ts`), where `posts.cover_url` is the ledger of what
is taken; this script applies the same rule to posts already published.

```bash
# 1) DRY RUN — prints the duplicate count, free pool capacity and a sample:
DATABASE_URL=postgres://… npm run posts:dedup-covers

# 2) Only after the numbers look right — write the new covers:
DATABASE_URL=postgres://… npm run posts:dedup-covers -- --apply
```

For every cover carried by more than one post, the **oldest** post keeps it and
each later one gets a cover no post uses — topical first, then anything free
(an off-topic but unique photo beats the same photo twice). Candidates come only
from the auto-assigned inventory in `src/data/cover-pool.json` — the same file
the runtime reads, so the two can't drift; the article's own scraped image,
uploads (`/api/file/…`) and already-unique covers are left alone. Duplicated
covers outside the pool are reported, never rewritten. Offline — no Unsplash key
needed; if free covers run out the script says so instead of reusing an image.
Deterministic + idempotent (re-running is a no-op); `--apply` guards each write
on the scanned cover, so a post re-covered in the app meanwhile is skipped.
Reversible via the `pg_dump` backup.

## `seed-changelog.mjs` — seed `/changelog` with real model releases

Loads the curated set of real AI model releases from
`scripts/changelog-seed-data.json` into the `model_releases` table, so
`/changelog` is populated on a fresh/empty deploy.

```bash
# 1) DRY RUN — validates the data file and prints what would be inserted:
DATABASE_URL=postgres://… npm run seed:changelog

# 2) Insert the missing releases:
DATABASE_URL=postgres://… npm run seed:changelog -- --apply
```

Idempotent: inserts with `ON CONFLICT (slug) DO NOTHING`, so re-running never
duplicates and never overwrites a release that already exists (e.g. one the bot
published). Slugs are computed exactly like the backend
(`vendor-model-version`), so a seeded row and a bot/API row for the same
release collide on slug and only one wins. The prod deploy
(`.github/workflows/backend-cicd.yml`) already runs it with `--apply` after
every successful healthcheck — run it manually only for ad-hoc seeding or to
dry-run new entries in the data file.
