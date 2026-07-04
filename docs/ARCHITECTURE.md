# Backend Architecture — layered pattern

Hard layering for the Next.js Pages-Router API. Goal: thin routes, zero
inline magic, every concern has exactly one home. New code MUST follow this;
existing routes are migrated domain-by-domain.

## Directory layout

```
src/
  pages/api/<domain>/   HTTP layer ONLY. parse → validate → service → respond.
  services/<domain>.ts  Business logic. Pure-ish: takes data, returns data or
                        throws a typed AppError. NO req/res, NO HTTP status.
  models/               DB access (class-based User/Post/File). No HTTP.
  schemas/<domain>.ts   zod request schemas + inferred body types.
  middlewares/          Handler wrappers: requireAuth, requireAdmin,
                        requireDogsAdmin, validateBody/validateQuery,
                        withRateLimit, withMethods. Compose around a handler.
                        (CORS is NOT here — it lives in src/middleware.ts,
                        the Next.js edge middleware, one place for all /api/*.)
  lib/                  External clients / infra: db, dogs-db, jwt, passport.
  constants/            http status codes, user-facing messages, shared
                        domain constants (auth, pagination, dogs). NO logic.
  types/                Shared TS contracts (api, audit, bot-control,
                        system-metrics, subscriber, model-release, kanban, dogs).
  utils/                PURE helpers only (response, email, audit-context,
                        normalize-email, slug, uuid…). No route logic.
```

## Hard rules (enforced in review; lint where possible)

1. **Routes are thin.** A route handler only: runs middlewares, reads the
   validated body/params, calls ONE service, maps the result to a response
   via `ok()/fail()`. No bcrypt/jsonwebtoken/pg/business branching in routes.
2. **No inline magic.** No literal HTTP numbers or user-facing strings inside
   routes/services — import from `constants/`. (`HTTP.BAD_REQUEST`,
   `MSG.WRONG_CREDENTIALS`.)
3. **One home per concern.**
   - validation → `schemas/`
   - business logic → `services/`
   - DB → `models/`
   - cross-cutting HTTP → `middlewares/`
   - shared shapes → `types/`
4. **Services don't know HTTP.** They return data or `throw new AppError(code,
message)`. The route (or an error wrapper) maps `AppError` → status.
5. **`utils/` is pure.** Anything touching req/res/DB/env is NOT a util — it's
   a middleware, service, or lib.
6. **Per-domain trio.** Each domain gets `schemas/<d>.ts`, `services/<d>.ts`,
   and (if needed) `types/<d>.ts`.

## Canonical route shape

```ts
// pages/api/auth/sign-in.ts
import { withMethods } from '@/src/middlewares/with-methods';
import { validateBody } from '@/src/middlewares/validate';
import { signInSchema } from '@/src/schemas/auth';
import { authService } from '@/src/services/auth';
import { ok, sendError } from '@/src/utils/response';
import { HTTP } from '@/src/constants/http';

async function handler(req, res) {
  try {
    const { accessToken, user } = await authService.signIn(req.body); // validated
    return ok(res, { accessToken, user });
  } catch (err) {
    return sendError(res, err); // maps AppError → status
  }
}

export default withMethods(['POST'])(validateBody(signInSchema)(handler));
```

## Migration order (each = its own branch, TDD, e2e, merge)

1. Foundation: `constants/http`, `constants/messages`, `types/api`,
   `AppError` + `sendError`, `withMethods` middleware. + auth domain as the
   reference implementation (authService, thin sign-in/sign-up).
2. post domain → `services/post`, thin routes.
3. chat / kanban / calendar domains.
4. ✅ DONE (2026-07-04): `utils/{auth,admin,dogs-admin-auth,validate,rate-limit}`
   → `middlewares/` (kebab-case names). Per-route `utils/cors` deleted — the
   edge middleware (`src/middleware.ts`) is the single CORS source.
   `utils/response` intentionally stays in `utils/` (helper, not a wrapper).

## Frontend contract caveat

Success payload keys (`posts`, `post`, `accessToken`, `user`, `channel`…)
are read directly by the frontend. Services may restructure internals but the
route's final JSON keys MUST stay stable unless the frontend is updated in the
same change.
