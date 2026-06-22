# Containerization plan (deferred) — Docker Compose, NOT Kubernetes

**Date:** 2026-06-20
**Status:** Deferred. Do it when a real move/scale need appears.

## Decision

- **Kubernetes: NO.** Overkill for 2 services on 1 VDS — k8s control-plane alone
  eats more RAM/disk than the apps. Justified only at ~10+ services / multi-node.
- **Docker Compose: YES, when needed.** Solves the actual goal — "move to another
  server in one command" — and kills the OOM `next build` on the small VDS
  (images build in CI, the VDS only `pull`s).

## Why deferred now

Everything runs (systemd: blog-backend, blog-newsbot, nginx, postgres). No move
pending. Disk just cleaned (3.1G/9.6G). See [[vds-layout]].

## Trigger to actually do it

Any of: real server migration · tired of manual deploy / OOM builds · adding more
services (frontend self-host, cache, queue).

## Scope (~half a day)

1. **`Dockerfile` for backend** — multi-stage, Next.js `output: 'standalone'` to
   shrink the image (~200–300M). Build stage runs `next build` (off the VDS →
   fixes OOM); runtime stage copies `.next/standalone` + `node_modules` slim.
2. **`Dockerfile` for bot** (ai-bot-tg) — node:20-slim, `npm ci`, run
   `node --import tsx src/index.ts`. SQLite file lives on a **named volume** (the
   dedup ledger must survive container restarts) — ~150–200M image.
3. **`compose.yml`** — services: `backend` (:7272), `bot`, `postgres:14` (named
   volume for data), optional `nginx`. Shared network so bot reaches backend by
   service name (`http://backend:7272`). Env via `.env` files (not committed).
4. **Postgres migration** — EITHER keep host Postgres (compose connects to it,
   least risk to data) OR move into a container with a volume + a one-time
   `pg_dump | pg_restore`. **Back up the DB first either way.**
5. **CI change** — build+push images (GHCR) on push to main; VDS does
   `docker compose pull && up -d` instead of scp+build. Removes the OOM step.

## Disk cost

~1–1.3G total (docker engine ~0.4G one-time + backend ~0.25G + bot ~0.18G +
postgres ~0.15G). Net new ~1G (images duplicate node_modules already on disk).
Current free space (6.5G) is plenty.

## Gotchas

- **SQLite volume** — without a named volume the bot loses its dedup ledger on
  restart (re-sends every news item). Mount it.
- **Postgres data** — never run the containerized PG against the host's data dir;
  use a fresh volume + dump/restore. Back up before touching.
- **x-ui / VPN** — unrelated, stays on the host. Don't containerize. See [[vds-layout]].
- **Migration = one command goal** — `git clone && docker compose up -d` only
  works once the env files + DB dump are placed; document that in a RUNBOOK.
