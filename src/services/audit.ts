import type { AuditRecord, AuditLogRow, ListAuditParams } from '@/src/types/audit';

import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { MAX_LIMIT } from '@/src/constants/pagination';

// Audit trail of business actions. No HTTP. Fire-and-forget: record() NEVER
// throws and is NEVER awaited in the business path — an audit failure must not
// break or roll back the action it describes (best-effort, like applySafeMigrations).
// Contracts live in src/types/audit.ts.

const INSERT_SQL = `
  INSERT INTO audit_logs
    (id, action, actor_id, actor_role, target_type, target_id, metadata, ip, request_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
`;

/**
 * Records an audit event. Fire-and-forget: returns void, swallows any insert
 * error (logged), and must never be awaited in the business flow.
 */
function record(rec: AuditRecord): void {
  const params = [
    uuidv4(),
    rec.action,
    rec.actorId ?? null,
    rec.actorRole ?? null,
    rec.targetType ?? null,
    rec.targetId ?? null,
    JSON.stringify(rec.metadata ?? {}),
    rec.ip ?? null,
    rec.requestId ?? null,
  ];

  dbQuery(INSERT_SQL, params).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[audit] insert failed for action', rec.action, error);
  });
}

/**
 * Async variant for tests / callers that need to assert the write landed.
 * Production code uses record() (fire-and-forget) — do not await in the
 * business path.
 */
async function recordAndWait(rec: AuditRecord): Promise<void> {
  const params = [
    uuidv4(),
    rec.action,
    rec.actorId ?? null,
    rec.actorRole ?? null,
    rec.targetType ?? null,
    rec.targetId ?? null,
    JSON.stringify(rec.metadata ?? {}),
    rec.ip ?? null,
    rec.requestId ?? null,
  ];
  await dbQuery(INSERT_SQL, params);
}

/**
 * Lists audit logs newest-first with optional filters and pagination.
 * Returns rows mapped to camelCase plus the total count for the same filters.
 */
async function list(params: ListAuditParams = {}) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (params.action) {
    values.push(params.action);
    clauses.push(`action = $${values.length}`);
  }
  if (params.actorId) {
    values.push(params.actorId);
    clauses.push(`actor_id = $${values.length}`);
  }
  if (params.targetType) {
    values.push(params.targetType);
    clauses.push(`target_type = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);

  const countResult = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const rowsResult = await dbQuery<{
    id: string;
    action: string;
    actor_id: string | null;
    actor_role: string | null;
    target_type: string | null;
    target_id: string | null;
    metadata: Record<string, unknown>;
    ip: string | null;
    request_id: string | null;
    created_at: Date;
  }>(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${
      values.length + 1
    } OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );

  const logs: AuditLogRow[] = rowsResult.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    ip: row.ip,
    requestId: row.request_id,
    createdAt: row.created_at,
  }));

  return { logs, total, limit, offset };
}

export const auditService = { record, recordAndWait, list };
