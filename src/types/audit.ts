// Audit-trail contracts. The service lives in src/services/audit.ts; the
// request-context builder in src/utils/audit-context.ts.

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

export interface ListAuditParams {
  action?: string;
  actorId?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogRow {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: Date;
}
