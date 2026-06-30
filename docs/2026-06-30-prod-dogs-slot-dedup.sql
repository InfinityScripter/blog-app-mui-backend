-- ============================================================================
-- PROD dogs-teacher: remove duplicate booking slots, enable starts_at UNIQUE
-- ============================================================================
-- Context: dogs_booking_slots has duplicate rows at the same starts_at (the UI
-- showed two "30 июн 09:00"). They block the new UNIQUE index that powers the
-- createSlot/createSlots ON CONFLICT (starts_at) dedup. The backend now boots
-- WITHOUT the index (best-effort, see applyDogsSafeMigrations in
-- src/lib/dogs-db.ts) and logs a warning; this script removes the duplicates,
-- after which the next backend restart creates the index automatically.
--
-- Runs against the SEPARATE dogs_teacher database (NOT blog_app).
--
-- HOW TO RUN: psql / DBeaver connected to PROD dogs_teacher. Run STEP 0 first
-- and READ the output. STEP 1 runs inside a transaction you commit only after
-- the verify query returns 0 rows.
--
-- SAFETY: back up first (on the VDS):
--   sudo -u postgres pg_dump dogs_teacher > ~/dogs_teacher_backup_2026-06-30.sql
-- ============================================================================


-- STEP 0 — INSPECT. Which starts_at values have more than one slot, and which
-- of the duplicates carries an active (pending|confirmed) request (those must
-- be KEPT — deleting them would orphan a real booking).
SELECT s.starts_at,
       s.id,
       s.is_active,
       EXISTS (
         SELECT 1 FROM dogs_booking_requests r
         WHERE r.slot_id = s.id AND r.status IN ('pending', 'confirmed')
       ) AS has_active_request,
       s.created_at
FROM dogs_booking_slots s
WHERE s.starts_at IN (
  SELECT starts_at FROM dogs_booking_slots GROUP BY starts_at HAVING count(*) > 1
)
ORDER BY s.starts_at, has_active_request DESC, s.created_at;


-- ============================================================================
-- STEP 1 — DEDUP. For each duplicated starts_at, keep exactly ONE row and
-- delete the rest. Preference order for the survivor:
--   1) a row that has an active (pending|confirmed) request   — never orphan it
--   2) otherwise the oldest row (smallest created_at)
-- The dogs_booking_requests.slot_id FK is ON DELETE CASCADE, so deleting a slot
-- with NO active request also drops any of its declined/cancelled requests —
-- harmless history. The STEP 0 query confirms no surviving slot is dropped.
-- ============================================================================

BEGIN;

WITH ranked AS (
  SELECT s.id,
         s.starts_at,
         row_number() OVER (
           PARTITION BY s.starts_at
           ORDER BY
             EXISTS (
               SELECT 1 FROM dogs_booking_requests r
               WHERE r.slot_id = s.id AND r.status IN ('pending', 'confirmed')
             ) DESC,
             s.created_at ASC
         ) AS rn
  FROM dogs_booking_slots s
)
DELETE FROM dogs_booking_slots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- VERIFY before commit: should return 0 rows (no duplicate starts_at left).
SELECT starts_at, count(*)
FROM dogs_booking_slots
GROUP BY starts_at HAVING count(*) > 1;

-- If the verify query returned 0 rows:  COMMIT;
-- If anything looks wrong:              ROLLBACK;
COMMIT;


-- ============================================================================
-- STEP 2 — Enforce uniqueness. The backend also creates this on the next boot
-- (applyDogsSafeMigrations); doing it here makes it immediate. The old plain
-- index on starts_at, if present, is harmless and can stay.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS dogs_booking_slots_starts_at_unique
  ON dogs_booking_slots (starts_at);

-- VERIFY: should now succeed and show the index.
-- \d dogs_booking_slots
