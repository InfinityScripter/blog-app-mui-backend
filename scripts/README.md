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
