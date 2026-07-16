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
