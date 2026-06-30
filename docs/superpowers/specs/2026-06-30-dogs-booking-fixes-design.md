# Dogs-teacher booking — 6 fixes design

Date: 2026-06-30
Repos: `blog-app-mui-backend` (API), `dogs-teacher` (Next.js 16 frontend)

## Problem → root cause → fix

| #   | Problem                                                             | Root cause                                                                        | Fix                                                                                     |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Client gets no notification when they book                          | Only owner is notified (`notifyDogsOwnerNewRequest`); no client channel           | Email on request created (+ Telegram if linked)                                         |
| 2   | Slots duplicate (two "30 июн 09:00")                                | No UNIQUE on `dogs_booking_slots.starts_at`; no dedup in create/createSlots/batch | UNIQUE index + `ON CONFLICT DO NOTHING`; clean existing prod dups first                 |
| 3   | Slot picker is one flat list                                        | Single `<select>` over all slots                                                  | Calendar → time: pick a day (days without slots disabled), then time chips for that day |
| 4   | Only admin gets confirm/request notifications, not clients          | Site clients never have `telegramUserId` (only set via bot `/start <token>`)      | Email is the universal channel; Telegram deep-link for those who opt in                 |
| 5   | "Мои занятия" button leads to booking form even when already booked | Client token not persisted (no localStorage)                                      | Persist token to localStorage; show "Мои заявки" banner/route to cabinet                |
| 6   | Client can't see/cancel their bookings                              | Cabinet is read-only; no client cancel endpoint                                   | localStorage token + cancel button + new client-cancel API                              |

## Notification channel decision

Client notifications go through **two channels**:

- **Email — universal, primary.** Every client may provide an email at booking time. Sent on: request created, status changed (confirmed/declined/cancelled).
- **Telegram — optional, opt-in.** Deep-link `t.me/dogs_teacher_bot?start=<accessToken>` shown on the site and in the cabinet. The bot already handles `/start <token>` → `linkTelegramClient`. Once linked, `notifyDogsClientStatusChange` (already implemented) delivers.

Email is optional per-client (phone stays the only required contact). No email + not linked → client still uses the web cabinet (status visible, cancel available).

## Backend changes (`blog-app-mui-backend`)

### Schema (`src/lib/dogs-db.ts`)

- Add `email TEXT` column to `dogs_clients` (nullable).
- Add `CREATE UNIQUE INDEX IF NOT EXISTS dogs_booking_slots_starts_at_unique ON dogs_booking_slots (starts_at)`.
  - **Pre-req:** prod has duplicate `starts_at` rows → the index creation would fail. A one-time cleanup (keep one row per `starts_at`, prefer the one with a request; delete the rest) runs on the VDS **before** deploying the unique-index code.

### Dedup (#2)

- `createSlot`, `createSlots`, batch INSERT → add `ON CONFLICT (starts_at) DO NOTHING RETURNING *`. Batch returns only the rows actually inserted, so the frontend can report "added N, skipped M".

### Client email capture (#1/#4)

- `createDogsBookingRequestSchema` → add optional `email` (zod `.email().optional()`).
- `createRequest` / client upsert → store email on `dogs_clients`.
- New `src/utils/dogs-email.ts` (reuses the nodemailer transport pattern from `src/utils/email.ts`): `sendDogsRequestReceived(client, request)` and `sendDogsStatusChanged(client, request)`. Both no-op if `EMAIL_USER` unset or client has no email. Fired non-blocking (`.catch`) from the request-create and status-PATCH routes — must never break the API response.

### Client cancel (#6)

- New route `PATCH /api/dogs/booking/client/[token]/cancel` (body `{ requestId }`), no admin auth — token IS the auth.
- New service `cancelClientRequest(accessToken, requestId)`: verify the request belongs to the client owning that token, status is `pending`|`confirmed`, set `status='cancelled'` (frees the slot via the existing active-slot rule). Notify owner ("client cancelled") + email/telegram client.
- Frontend API: `cancelDogsBookingRequest(token, requestId)`.

### Telegram (already works, just surfaced)

- `notifyDogsClientStatusChange` already sends on status change when linked — no change.
- Optionally send a Telegram "request received" on create **only if already linked** (rare at first booking) — low priority, can skip.

## Frontend changes (`dogs-teacher`)

### Calendar slot picker (#3)

- Add deps `@mui/x-date-pickers` + `dayjs` (MUI standard; admin currently uses native `<input type=date>` — booking form gets the richer calendar).
- Replace the `<TextField select>` in `src/sections/landing/booking/index.tsx` with `DateCalendar`:
  - `shouldDisableDate` disables days with no available slots.
  - On day select → render time chips/buttons for that day only; clicking a time sets `slotId`.
- Keep RHF integration (`slotId` is the form value).

### Token persistence + cabinet routing (#5)

- After successful booking: `localStorage.setItem('dogs_client_token', accessToken)`.
- Booking form: if a stored token exists, show a "У вас уже есть заявки → Мои заявки" banner linking to `/booking/client/<token>`.
- (Telegram bot "Мои заявки" already routes correctly; this fix is site-side.)

### Cabinet cancel + telegram link (#6)

- `src/app/booking/client/[token]/client-booking-view.tsx`: add a "Отменить" button on `pending`/`confirmed` requests → `cancelDogsBookingRequest` → refetch. Add a "Получать уведомления в Telegram" deep-link button.

### Email field (#1)

- Add an optional `email` field (RHF + zod) to the booking form; pass through to `createDogsBookingRequest`.

## Tests (TDD — write first, watch fail, implement)

### Backend (Jest, pg-mem)

- **Dedup:** `createSlot` twice same `starts_at` → 1 row; `createSlots`/batch with internal dups + an existing-row dup → only uniques inserted; returned count reflects inserts.
- **Client cancel:** owner-token cancels own `pending` → `cancelled` + slot returns to availability; wrong token → 403/404; already-`declined` → rejected; cancelling fires owner notify.
- **Email:** request-create with email stores it + calls `sendDogsRequestReceived`; status PATCH calls `sendDogsStatusChanged`; no email / no `EMAIL_USER` → no send, response still ok; email send throwing does NOT break the API response.
- **Schema:** booking request accepts optional valid email, rejects malformed email.

### Frontend (e2e Playwright + unit where cheap)

- localStorage `dogs_client_token` set after a successful booking.
- "Мои заявки" banner appears when a token is stored, routes to cabinet.
- Cabinet renders a cancel button on cancellable requests; clicking calls the cancel API and updates status.
- Calendar disables days without slots; selecting a day shows only that day's times; selecting a time enables submit.

## Rollout / ordering

1. **Backend first:** dedup + email + client-cancel + tests → clean prod dups on VDS → deploy (push main → CI). Add no new prod env (email already configured).
2. **Frontend second:** calendar + token persistence + cabinet cancel + email field + tests → deploy (push main → Vercel).

Two safe stages; backend cancel API must exist before the frontend cancel button ships.

## Out of scope / non-goals

- Multi-day recurring booking, payments, reschedule (only cancel).
- Replacing the admin native date input (only the public booking form gets the calendar).
- SMS notifications.
