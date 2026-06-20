import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';

// Audit trail of business actions. No HTTP. Fire-and-forget: record() NEVER
// throws and is NEVER awaited in the business path — an audit failure must not
// break or roll back the action it describes (best-effort, like applySafeMigrations).

export interface AuditContext {
  actorId?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  requestId?: string | null;
}

export interface AuditRecord extends AuditContext {
  /** dot.case event name, e.g. 'post.created'. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Non-PII context only (ids, enums, field names, counts). */
  metadata?: Record<string, unknown>;
}

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

export const auditService = { record, recordAndWait };
