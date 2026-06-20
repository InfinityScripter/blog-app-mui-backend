# News-Bot (ai-bot-tg) — Design

**Date:** 2026-06-20
**Status:** Approved, ready for implementation
**Author:** Talalaev M (via Claude)

## Goal

A standalone Telegram bot service that collects news from trusted RSS feeds once
a day, rewrites each item into a unique blog post via Claude, DMs the owner with
**Publish / Skip** buttons, and on Publish posts the article to the existing blog
(`talalaev.su`) authored by the owner — approved remotely from a phone.

## Decisions (locked)

| Decision                | Choice                                 | Why                                                                    |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Remote approval channel | Telegram bot                           | One-tap approve from phone; `ai-bot-tg/` already reserved              |
| Content processing      | Claude rewrite into a unique post      | "Cool portal" wants unique content, not copy-paste; SEO/copyright safe |
| Sources                 | General-news RSS (config-driven list)  | Stable format, easy to parse, easy to swap feeds                       |
| Cadence                 | Once-daily digest batch                | Less noise, predictable Claude cost                                    |
| Bot → blog auth         | Shared service token (`BOT_API_TOKEN`) | No expiring JWT, separately revocable, owner resolved server-side      |
| Architecture            | Standalone service in `ai-bot-tg/`     | Clean separation; bot crash/redeploy never touches blog uptime         |

## Architecture

```
┌─────────────────────── ai-bot-tg/ (new standalone service) ──────────────────┐
│                                                                               │
│  croner 0 9 * * * ─► collector.run() ────────────────────────────────────┐   │
│   (Europe/Moscow)        │                                                │   │
│                          ▼                                                │   │
│   feeds.ts ─► parse RSS (per-feed try/catch) ─► FeedItem[]                │   │
│                          │                                                │   │
│                          ▼                                                │   │
│   store.ts ─► dedup by canonical-url key (INSERT OR IGNORE) ─► new items  │   │
│                          │                                                │   │
│                          ▼                                                │   │
│   rewriter.ts ─► Claude (haiku-4-5, structured output) ─► RewriteResult   │   │
│                          │                                                │   │
│                          ▼                                                │   │
│   bot.ts ─► DM owner: title + summary + [✅ Опубликовать] [❌ Пропустить] │   │
│                          │                                                │   │
│        owner taps Publish (callback_query)                                │   │
│                          ▼                                                │   │
│   publisher.ts ─► POST {BLOG_API_URL}/api/post/new  (Bearer BOT_API_TOKEN)│   │
└──────────────────────────┼────────────────────────────────────────────────┘  │
                           ▼
   blog backend: requireAuth recognizes BOT_API_TOKEN (timing-safe) →
     resolves owner by OWNER_EMAIL → req.user = {_id: owner, role: 'admin'} →
     postService.createPost → post live on talalaev.su, authored by owner
```

The bot talks to the blog **only** over the HTTP publish API — that is the single
integration seam. The bot owns its own state (SQLite); the blog owns posts.

## Component layout — `ai-bot-tg/src/` (one purpose per file)

| File           | Responsibility                                                                                                                         | Depends on                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `index.ts`     | Entrypoint: load config → init store → register cron → start bot → graceful shutdown (SIGINT/SIGTERM)                                  | all                              |
| `config.ts`    | Read + zod-validate env; export typed `CONFIG`; fail fast on missing vars                                                              | zod                              |
| `types.ts`     | `FeedItem`, `Candidate`, `CandidateState`, `RewriteResult`, `BlogPostBody`                                                             | —                                |
| `feeds.ts`     | `DEFAULT_FEEDS` + `fetchAllFeeds()`: rss-parser, per-feed try/catch, normalize to `FeedItem[]` with `dedupKey`                         | rss-parser, config               |
| `store.ts`     | better-sqlite3: schema, `isSeen`, `insertCollected`, `getCandidate`, `setState`, `attachRewrite`, `setTelegramMessage`, `setPublished` | better-sqlite3, config           |
| `rewriter.ts`  | Anthropic client + `rewriteToPost(item)`: structured JSON via `messages.parse` + zod, defensive fallback                               | @anthropic-ai/sdk, zod, config   |
| `publisher.ts` | `publish(candidate)`: `fetch` POST to `/api/post/new`, returns blog post id or throws                                                  | config                           |
| `bot.ts`       | grammy Bot: owner-lock middleware, `/start` `/ping` `/fetch`, `sendApproval`, `callback_query:data` handler                            | grammy, store, publisher, config |
| `collector.ts` | `runCollection()`: feeds → dedup → rewrite → store → DM owner. The cron job and `/fetch` both call this                                | feeds, store, rewriter, bot      |
| `scheduler.ts` | croner `Cron(CRON_SCHEDULE, {timezone})` → `runCollection()`; exports the job so `/fetch` can `.trigger()`                             | croner, collector, config        |

## Candidate lifecycle

```
collected ─► rewriting ─► pending_review ─► publishing ─► published
                 │              │                  └─► publish_failed
                 └─► rewrite_failed   └─► skipped
```

- `collected` — passed dedup; row inserted, reserving `dedup_key` so the same URL
  never double-processes even across retries.
- `rewriting` → `rewrite_failed` (Claude/JSON error, surfaced in DM) or `pending_review`.
- `pending_review` — DM sent with buttons; `tg_message_id` stored.
- Owner taps **Skip** → `skipped`. Taps **Publish** → `publishing` → POST →
  `published` (store `blog_post_id`) or `publish_failed` (DM edited, retry button).

**Dedup key:** `lowercase(stripTrackingParams(item.guid ?? item.link))` — prefer
`guid`, fall back to `link`; strip `utm_*` / `fbclid` / fragment / trailing slash.
Uniqueness enforced by a SQLite unique index; `INSERT OR IGNORE`, 0 rows = dup → skip.

**SQLite schema:**

```sql
CREATE TABLE IF NOT EXISTS candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key     TEXT UNIQUE NOT NULL,
  source_url    TEXT NOT NULL,
  source_title  TEXT,
  feed_title    TEXT,
  state         TEXT NOT NULL,
  rewrite_json  TEXT,           -- serialized RewriteResult
  tg_message_id INTEGER,        -- DM to edit on decision
  blog_post_id  TEXT,           -- set after publish
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Claude rewrite

- **Model:** `claude-haiku-4-5` — cheap, sufficient for rewrite (~20 articles/day ≈ pennies).
- **Method:** `client.messages.parse()` with `zodOutputFormat(RewriteSchema)` for
  guaranteed valid JSON; if `parsed_output` is null (refusal / parse failure),
  mark candidate `rewrite_failed`, show the error in the DM — never crash the batch.
- **Output schema:**

```ts
const RewriteSchema = z.object({
  title: z.string(),
  description: z.string(), // one-paragraph summary
  content: z.string(), // markdown body
  tags: z.array(z.string()),
  metaTitle: z.string(),
  metaDescription: z.string(),
});
```

- System prompt instructs: write an original Russian-language blog post from the
  source title + snippet, attribute the source at the end with a link, neutral
  journalistic tone. System prompt is constant → eligible for prompt caching.

## Blog publish request

- `POST {BLOG_API_URL}/api/post/new`
- Headers: `Authorization: Bearer ${BOT_API_TOKEN}`, `Content-Type: application/json`
- Body matches `buildNewPostPayload`:

```json
{
  "title": "...",
  "description": "...",
  "content": "... markdown ...",
  "tags": ["..."],
  "metaTitle": "...",
  "metaDescription": "...",
  "metaKeywords": ["..."],
  "publish": "published"
}
```

- Success: 201, `{ success: true, post: {...} }` → store `post.id`.
- `coverUrl` omitted → backend applies its default cover.

## Backend change (blog-app-mui-backend)

**One file:** `src/utils/auth.ts`. Add a service-token short-circuit **before** JWT
verification in `requireAuth`:

1. If `BOT_API_TOKEN` is set and the bearer token matches it (via
   `crypto.timingSafeEqual` on equal-length buffers — length-guarded to avoid
   throwing), resolve the owner:
   - `OWNER_EMAIL` must be set (else 500 — misconfiguration).
   - `User.findOne({ email: OWNER_EMAIL })` (case-insensitive — `findOne` already
     uses `LOWER(email)`; this respects the known email-case bug class).
   - Owner must exist and have `role === 'admin'` (else 401).
   - Set `req.user = { _id: owner._id, role: 'admin' }`, mint `requestId`, call handler.
2. Otherwise fall through to the existing JWT path unchanged.

`createPost(req.user._id, body)` then embeds the author snapshot
`{ name: owner.name, avatarUrl: owner.avatarURL }` automatically — posts appear
authored by the owner. No change to `post/new.ts`, `services/post.ts`, or
`post-payload.ts`.

**Test:** `src/tests/api/post/new.bot-token.test.ts` — valid token → 201 authored
by owner; wrong token → 401; absent token → 401; owner-not-admin → 401. Uses the
existing `node-mocks-http` + `createMocks` + `resetDatabase()` pattern.

## Security

1. **Owner-lock the bot.** Reject every update where
   `ctx.from?.id !== OWNER_TELEGRAM_ID` — commands _and_ callbacks.
2. **Timing-safe token compare** + require `role === 'admin'` on the backend — a
   leaked token otherwise authors arbitrary posts as the owner.
3. **Idempotent publish.** The Publish handler acts only if `state === 'pending_review'`
   and flips to `publishing` before the HTTP call — double-tap or a stale message
   after restart cannot double-post. On success the DM keyboard is removed.
4. **`BOT_API_TOKEN`** is a long random secret, never committed; lives in both
   services' env and the VDS `.env.production`.

## Resilience

- Each feed parsed in its own try/catch with a ~10s timeout — one bad XML never
  kills the daily run.
- Claude failures route a single candidate to `rewrite_failed` (error shown in DM),
  not an unhandled throw.
- `bot.start()` runs last in `index.ts`; cron registered before it; `/fetch` uses
  `job.trigger()`, not a second `start`. SIGINT/SIGTERM → `bot.stop()` + `db.close()`.

## Env vars

**Bot (`ai-bot-tg/.env`):**

```
TELEGRAM_BOT_TOKEN=    # from @BotFather
OWNER_TELEGRAM_ID=     # numeric chat id (DM target + auth allowlist)
ANTHROPIC_API_KEY=
BLOG_API_URL=https://api.talalaev.su:8444   # dev: http://localhost:7272
BOT_API_TOKEN=         # long random shared secret; MUST equal backend's
SQLITE_PATH=./data/candidates.db
CRON_SCHEDULE=0 9 * * *
CRON_TZ=Europe/Moscow
RSS_FEEDS=             # optional CSV override of the default feed list
```

**Backend (add to `.env` + VDS `.env.production`):**

```
BOT_API_TOKEN=         # same secret as the bot
OWNER_EMAIL=talalaev.misha@gmail.com
```

> Set `BOT_API_TOKEN` / `OWNER_EMAIL` in the VDS `.env.production` before/with the
> merge or the bot's publish path returns 500/401.

## Dependencies

```
grammy rss-parser @anthropic-ai/sdk croner better-sqlite3 dotenv zod
-D typescript tsx @types/node @types/better-sqlite3
```

Node 18+ (croner requirement). Native `fetch` for the publisher — no axios.

## Testing & verification

- **Bot unit tests (Vitest or node:test + tsx):**
  - `feeds`: parse a fixture RSS string → expected `FeedItem[]`; a malformed feed
    is skipped, not thrown.
  - `store`: insert + dedup (second insert of same key is a no-op); state transitions.
  - `rewriter`: mock the Anthropic client → valid `RewriteResult`; null parse →
    `rewrite_failed`.
  - `publisher`: mock `fetch` → 201 returns post id; non-201 throws.
  - `dedupKey`: tracking params stripped, guid preferred.
- **Backend test:** the bot-token auth test above (Jest, pg-mem).
- **Typecheck:** `tsc --noEmit` (bot) + `npm run ts` (backend).
- **End-to-end (manual, documented in bot README):** set env, run `npm run dev`,
  send `/fetch` in Telegram, tap Publish, confirm the post on the blog.

## Out of scope (YAGNI)

- Editing the rewrite before publishing (possible phase 2).
- Per-source filtering / topic classification.
- Multiple owners / multi-tenant.
- Webhook mode (long-polling is fine for a single-user bot).
