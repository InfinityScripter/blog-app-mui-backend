-- ============================================================================
-- PROD email duplicate merge + enable case-insensitive email uniqueness
-- ============================================================================
-- Context: users table has case-only duplicates (e.g. Mtal-va@mail.ru and
-- mtal-va@mail.ru) that block the LOWER(email) unique index. The backend now
-- boots without the index (best-effort); this script merges the duplicates and
-- then creates the index so case-insensitive uniqueness is enforced.
--
-- HOW TO RUN: paste into DBeaver SQL Editor connected to PROD blog_app (via the
-- SSH tunnel you already set up). Run STEP 0 first and READ the output before
-- running anything else. Steps 1+ run inside a single transaction you commit
-- only after verifying.
--
-- SAFETY: take a backup first (on the VDS):
--   sudo -u postgres pg_dump blog_app > ~/blog_app_backup_2026-06-20.sql
-- ============================================================================


-- STEP 0 — INSPECT. Run this alone, read it, decide which row is "canonical".
-- Pick the account to KEEP (usually the one with a real password_hash, verified,
-- the most posts, and the oldest created_at).
SELECT u.id,
       u.email,
       u.role,
       u.is_email_verified,
       (u.password_hash IS NOT NULL) AS has_pw,
       u.created_at,
       (SELECT count(*) FROM posts            p WHERE p.user_id   = u.id) AS posts,
       (SELECT count(*) FROM files            f WHERE f.user_id   = u.id) AS files,
       (SELECT count(*) FROM calendar_events  c WHERE c.created_by = u.id) AS events,
       (SELECT count(*) FROM kanban_boards    k WHERE k.created_by = u.id) AS boards,
       (SELECT count(*) FROM chat_messages    m WHERE m.sender_id = u.id) AS messages
FROM users u
WHERE LOWER(u.email) IN (
  SELECT LOWER(email) FROM users GROUP BY LOWER(email) HAVING count(*) > 1
)
ORDER BY LOWER(u.email), u.created_at;


-- ============================================================================
-- STEP 1+ — MERGE one duplicate pair. Fill in the two ids from STEP 0:
--   :keep_id  = the canonical account to KEEP
--   :drop_id  = the duplicate to remove (its data is re-pointed to :keep_id)
-- Repeat this whole block for each duplicate pair if there is more than one.
-- ============================================================================

BEGIN;

-- Re-point every users(id) foreign key from the duplicate to the canonical row.
-- NOT NULL FKs (posts, files, chat_members, kanban_board_members, calendar):
UPDATE posts                SET user_id   = :keep_id WHERE user_id   = :drop_id;
UPDATE files                SET user_id   = :keep_id WHERE user_id   = :drop_id;
UPDATE calendar_events      SET created_by = :keep_id WHERE created_by = :drop_id;

-- chat_members / kanban_board_members are (channel/board, user) PKs — a plain
-- UPDATE can collide if the canonical user is ALSO already a member. Move only
-- the rows that would not collide, then drop the rest.
UPDATE chat_members cm SET user_id = :keep_id
  WHERE cm.user_id = :drop_id
    AND NOT EXISTS (SELECT 1 FROM chat_members x
                    WHERE x.channel_id = cm.channel_id AND x.user_id = :keep_id);
DELETE FROM chat_members WHERE user_id = :drop_id;

UPDATE kanban_board_members km SET user_id = :keep_id
  WHERE km.user_id = :drop_id
    AND NOT EXISTS (SELECT 1 FROM kanban_board_members x
                    WHERE x.board_id = km.board_id AND x.user_id = :keep_id);
DELETE FROM kanban_board_members WHERE user_id = :drop_id;

-- Nullable FKs (created_by / sender_id) — just re-point:
UPDATE chat_channels   SET created_by = :keep_id WHERE created_by = :drop_id;
UPDATE chat_messages   SET sender_id  = :keep_id WHERE sender_id  = :drop_id;
UPDATE kanban_boards   SET created_by = :keep_id WHERE created_by = :drop_id;
UPDATE kanban_tasks    SET created_by = :keep_id WHERE created_by = :drop_id;

-- Finally remove the duplicate account.
DELETE FROM users WHERE id = :drop_id;

-- VERIFY before commit: should return 0 rows (no case-duplicates left).
SELECT LOWER(email) AS email, count(*)
FROM users GROUP BY LOWER(email) HAVING count(*) > 1;

-- If the verify query returned 0 rows:  COMMIT;
-- If anything looks wrong:              ROLLBACK;
COMMIT;


-- ============================================================================
-- STEP 2 — Enforce case-insensitive uniqueness. Run after ALL pairs merged.
-- The old case-sensitive UNIQUE(email) constraint (if it still exists on the
-- prod table) must be dropped, then create the functional unique index.
-- ============================================================================

-- Drop the legacy case-sensitive unique constraint if present (name may vary;
-- check with \d users — typical name is users_email_key).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- Create the case-insensitive unique index (the backend also tries this on
-- boot; doing it here makes it immediate).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

-- VERIFY: should now succeed and show the index.
-- \d users
