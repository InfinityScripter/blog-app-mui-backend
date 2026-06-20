import '@jest/globals';
import User from '@/src/models/User';
import { dbQuery } from '@/src/lib/db';
import { auditService } from '@/src/services/audit';

interface AuditRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  request_id: string | null;
}

async function rows() {
  const r = await dbQuery<AuditRow>('SELECT * FROM audit_logs ORDER BY created_at');
  return r.rows;
}

describe('auditService', () => {
  beforeEach(async () => {
    await dbQuery('DELETE FROM audit_logs');
    await User.deleteMany({});
    await User.create({ _id: 'actor-1', name: 'Actor', email: 'a@e.com', passwordHash: 'x' });
  });

  it('records an action with actor, target and metadata', async () => {
    await auditService.recordAndWait({
      action: 'post.created',
      actorId: 'actor-1',
      actorRole: 'user',
      targetType: 'post',
      targetId: 'post-9',
      ip: '1.2.3.4',
      requestId: 'req-1',
      metadata: { title: 'Hello' },
    });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].action).toBe('post.created');
    expect(all[0].actor_id).toBe('actor-1');
    expect(all[0].actor_role).toBe('user');
    expect(all[0].target_type).toBe('post');
    expect(all[0].target_id).toBe('post-9');
    expect(all[0].ip).toBe('1.2.3.4');
    expect(all[0].request_id).toBe('req-1');
    expect(all[0].metadata).toEqual({ title: 'Hello' });
  });

  it('allows an anonymous actor (actorId null) — e.g. failed login / public route', async () => {
    await auditService.recordAndWait({ action: 'auth.login.failed', actorId: null });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].actor_id).toBeNull();
    expect(all[0].actor_role).toBeNull();
    expect(all[0].metadata).toEqual({});
  });

  it('record() is fire-and-forget — returns void and does not throw synchronously', () => {
    expect(auditService.record({ action: 'post.deleted', actorId: 'actor-1' })).toBeUndefined();
  });

  it('record() swallows a failing insert without throwing into the caller', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // action is NOT NULL — passing a bad record drives the insert to reject; the
    // fire-and-forget .catch must absorb it.
    expect(() =>
      auditService.record({ action: null as unknown as string, actorId: 'actor-1' })
    ).not.toThrow();
    // give the async .catch a tick to run
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    spy.mockRestore();
  });

  it('preserves the audit trail when the actor user is deleted (ON DELETE SET NULL)', async () => {
    await auditService.recordAndWait({
      action: 'post.created',
      actorId: 'actor-1',
      actorRole: 'user',
    });
    await User.deleteMany({ _id: 'actor-1' } as never);
    const all = await rows();
    expect(all).toHaveLength(1); // row survives
    expect(all[0].actor_id).toBeNull(); // FK nulled, not cascaded
  });
});
