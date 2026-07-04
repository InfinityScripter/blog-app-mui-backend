import type { PoolClient } from 'pg';

import '@jest/globals';
import dogsDbConnect from '@/src/lib/dogs-db';
import { dogsBookingService } from '@/src/services/dogs-booking';

type DogsPool = Awaited<ReturnType<typeof dogsDbConnect>>;

interface TracedStatement {
  sql: string;
  connection: number;
}

// Records every SQL statement (uppercased) with the connection it ran on:
// 0 = pool.query, 1+ = clients checked out via pool.connect. An optional
// `intercept` can reject a matching statement to simulate a concurrent
// conflict (e.g. a unique violation on the telegram claim).
function instrumentDogsPool(pool: DogsPool, intercept?: (sql: string) => Error | undefined) {
  const statements: TracedStatement[] = [];
  let connectionSeq = 0;

  const record = (connection: number, text: unknown): Error | undefined => {
    if (typeof text !== 'string') {
      return undefined;
    }
    statements.push({ sql: text.trim().toUpperCase(), connection });
    return intercept?.(text);
  };

  const originalPoolQuery = pool.query.bind(pool) as (t: unknown, p?: unknown) => Promise<unknown>;
  jest.spyOn(pool, 'query').mockImplementation(((text: unknown, params?: unknown) => {
    const error = record(0, text);
    if (error) {
      return Promise.reject(error);
    }
    return originalPoolQuery(text, params);
  }) as unknown as typeof pool.query);

  const originalConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
  jest.spyOn(pool, 'connect').mockImplementation((async () => {
    const client = await originalConnect();
    connectionSeq += 1;
    const connection = connectionSeq;
    const originalQuery = client.query.bind(client) as (
      t: unknown,
      p?: unknown
    ) => Promise<unknown>;
    client.query = ((text: unknown, params?: unknown) => {
      const error = record(connection, text);
      if (error) {
        return Promise.reject(error);
      }
      return originalQuery(text, params);
    }) as typeof client.query;
    return client;
  }) as unknown as typeof pool.connect);

  return statements;
}

describe('dogsBookingService', () => {
  it('creates a slot and lists it as available', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-01-01T09:00:00.000Z',
      endsAt: '2027-01-01T10:00:00.000Z',
    });

    const slots = await dogsBookingService.listAvailableSlots({});
    expect(slots.some((item) => item.id === slot.id)).toBe(true);
  });

  it('creates a request and exposes it in the client portal', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-01-02T09:00:00.000Z',
      endsAt: '2027-01-02T10:00:00.000Z',
    });

    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      dog: 'Бим, корги',
      comment: 'Тянет поводок',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    expect(request.status).toBe('pending');
    expect(request.client.accessToken).toBeTruthy();

    const portal = await dogsBookingService.getClientPortal(request.client.accessToken);
    expect(portal.requests).toHaveLength(1);
    expect(portal.requests[0].id).toBe(request.id);
  });

  it('does not list a slot with an active request and rejects a second active request', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-01-03T09:00:00.000Z',
      endsAt: '2027-01-03T10:00:00.000Z',
    });

    await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const slots = await dogsBookingService.listAvailableSlots({});
    expect(slots.some((item) => item.id === slot.id)).toBe(false);

    await expect(
      dogsBookingService.createRequest({
        name: 'Пётр',
        phone: '+7 900 222 33 44',
        serviceId: 'training',
        slotId: slot.id,
        source: 'site',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('returns declined slot back to availability', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-01-04T09:00:00.000Z',
      endsAt: '2027-01-04T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    await dogsBookingService.updateBookingStatus(request.id, 'declined');

    const slots = await dogsBookingService.listAvailableSlots({});
    expect(slots.some((item) => item.id === slot.id)).toBe(true);
  });

  it('creates a batch of slots in one call', async () => {
    const created = await dogsBookingService.createSlots([
      { startsAt: '2027-03-01T09:00:00.000Z', endsAt: '2027-03-01T10:00:00.000Z' },
      { startsAt: '2027-03-01T10:00:00.000Z', endsAt: '2027-03-01T11:00:00.000Z' },
      { startsAt: '2027-03-01T11:00:00.000Z', endsAt: '2027-03-01T12:00:00.000Z' },
    ]);

    expect(created).toHaveLength(3);
    const ids = created.map((slot) => slot.id);
    expect(new Set(ids).size).toBe(3);

    const available = await dogsBookingService.listAvailableSlots({});
    ids.forEach((id) => expect(available.some((slot) => slot.id === id)).toBe(true));
  });

  it('deletes a slot and 404s on a missing one', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-03-02T09:00:00.000Z',
      endsAt: '2027-03-02T10:00:00.000Z',
    });

    await dogsBookingService.deleteSlot(slot.id);

    const available = await dogsBookingService.listAvailableSlots({});
    expect(available.some((item) => item.id === slot.id)).toBe(false);

    await expect(dogsBookingService.deleteSlot('missing-slot')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deletes a booking request and frees its slot', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-03-03T09:00:00.000Z',
      endsAt: '2027-03-03T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    await dogsBookingService.deleteRequest(request.id);

    await expect(dogsBookingService.deleteRequest(request.id)).rejects.toMatchObject({
      status: 404,
    });

    const available = await dogsBookingService.listAvailableSlots({});
    expect(available.some((item) => item.id === slot.id)).toBe(true);
  });

  it('dedups a slot created twice at the same start time', async () => {
    const first = await dogsBookingService.createSlot({
      startsAt: '2027-04-01T09:00:00.000Z',
      endsAt: '2027-04-01T10:00:00.000Z',
    });
    const second = await dogsBookingService.createSlot({
      startsAt: '2027-04-01T09:00:00.000Z',
      endsAt: '2027-04-01T11:00:00.000Z',
    });

    expect(second).toBeNull();

    const available = await dogsBookingService.listAvailableSlots({});
    const matches = available.filter((slot) => slot.startsAt === '2027-04-01T09:00:00.000Z');
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(first!.id);
  });

  it('dedups a batch with internal and pre-existing duplicates, returning only inserts', async () => {
    await dogsBookingService.createSlot({
      startsAt: '2027-04-02T09:00:00.000Z',
      endsAt: '2027-04-02T10:00:00.000Z',
    });

    const created = await dogsBookingService.createSlots([
      { startsAt: '2027-04-02T09:00:00.000Z', endsAt: '2027-04-02T10:00:00.000Z' }, // dup of existing
      { startsAt: '2027-04-02T10:00:00.000Z', endsAt: '2027-04-02T11:00:00.000Z' }, // new
      { startsAt: '2027-04-02T10:00:00.000Z', endsAt: '2027-04-02T11:30:00.000Z' }, // internal dup
      { startsAt: '2027-04-02T11:00:00.000Z', endsAt: '2027-04-02T12:00:00.000Z' }, // new
    ]);

    expect(created).toHaveLength(2);
    const starts = created.map((slot) => slot.startsAt).sort();
    expect(starts).toEqual(['2027-04-02T10:00:00.000Z', '2027-04-02T11:00:00.000Z']);
  });

  it('stores the client email on a request and exposes it on the request and portal', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-04-05T09:00:00.000Z',
      endsAt: '2027-04-05T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      email: 'anna@example.com',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    expect(request.client.email).toBe('anna@example.com');

    const portal = await dogsBookingService.getClientPortal(request.client.accessToken);
    expect(portal.client.email).toBe('anna@example.com');
  });

  it('leaves email null when not provided', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-04-06T09:00:00.000Z',
      endsAt: '2027-04-06T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 222 33 44',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    expect(request.client.email).toBeNull();
  });

  it('lets the owning client cancel a pending request and frees the slot', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-01T09:00:00.000Z',
      endsAt: '2027-07-01T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    const cancelled = await dogsBookingService.cancelClientRequest(
      request.client.accessToken,
      request.id
    );
    expect(cancelled.status).toBe('cancelled');

    const available = await dogsBookingService.listAvailableSlots({});
    expect(available.some((item) => item.id === slot!.id)).toBe(true);
  });

  it('lets the owning client cancel a confirmed request', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-02T09:00:00.000Z',
      endsAt: '2027-07-02T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });
    await dogsBookingService.updateBookingStatus(request.id, 'confirmed');

    const cancelled = await dogsBookingService.cancelClientRequest(
      request.client.accessToken,
      request.id
    );
    expect(cancelled.status).toBe('cancelled');
  });

  it('rejects a cancel with a token that does not own the request', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-03T09:00:00.000Z',
      endsAt: '2027-07-03T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    const otherSlot = await dogsBookingService.createSlot({
      startsAt: '2027-07-03T11:00:00.000Z',
      endsAt: '2027-07-03T12:00:00.000Z',
    });
    const other = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 222 33 44',
      serviceId: 'training',
      slotId: otherSlot!.id,
      source: 'site',
    });

    await expect(
      dogsBookingService.cancelClientRequest(other.client.accessToken, request.id)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a cancel for an unknown token', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-04T09:00:00.000Z',
      endsAt: '2027-07-04T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    await expect(
      dogsBookingService.cancelClientRequest('definitely-not-a-real-token', request.id)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects cancelling a request that is already declined', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-05T09:00:00.000Z',
      endsAt: '2027-07-05T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });
    await dogsBookingService.updateBookingStatus(request.id, 'declined');

    await expect(
      dogsBookingService.cancelClientRequest(request.client.accessToken, request.id)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a second cancel of an already-cancelled request (idempotent guard)', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-06T09:00:00.000Z',
      endsAt: '2027-07-06T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    await dogsBookingService.cancelClientRequest(request.client.accessToken, request.id);

    await expect(
      dogsBookingService.cancelClientRequest(request.client.accessToken, request.id)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('does not overwrite an admin decision made after the client read (atomic status guard)', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-07-07T09:00:00.000Z',
      endsAt: '2027-07-07T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    // Admin declines first; a client cancel must then be rejected, not silently
    // overwrite the 'declined' status with 'cancelled'.
    await dogsBookingService.updateBookingStatus(request.id, 'declined');

    await expect(
      dogsBookingService.cancelClientRequest(request.client.accessToken, request.id)
    ).rejects.toMatchObject({ status: 409 });

    const portal = await dogsBookingService.getClientPortal(request.client.accessToken);
    expect(portal.requests[0].status).toBe('declined');
  });

  it('resolves a client by id', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-03-04T09:00:00.000Z',
      endsAt: '2027-03-04T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Мария',
      phone: '+7 900 333 44 55',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const client = await dogsBookingService.getClientById(request.client.id);
    expect(client?.id).toBe(request.client.id);
    expect(client?.telegramUserId).toBeNull();

    expect(await dogsBookingService.getClientById('missing-client')).toBeNull();
  });

  describe('linkTelegramClient atomicity', () => {
    // pg-mem parses BEGIN/COMMIT/ROLLBACK but executes them as no-ops (no
    // isolation, no revert), so these tests cannot assert that a rollback
    // restores the previous holder's link. They pin the command protocol
    // instead: release+claim must run on ONE connection inside a
    // BEGIN/COMMIT bracket, and a failed claim must issue ROLLBACK — which
    // on real Postgres undoes the release, so a losing concurrent claim can
    // no longer strand the previous holder unlinked.
    const CLAIM_SQL = 'SET telegram_user_id = $1';

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function createLinkableClient(startsAt: string, phone: string) {
      const slot = await dogsBookingService.createSlot({
        startsAt,
        endsAt: startsAt.replace('T09:', 'T10:'),
      });
      const request = await dogsBookingService.createRequest({
        name: 'Михаил',
        phone,
        serviceId: 'training',
        slotId: slot!.id,
        source: 'site',
      });
      return request.client;
    }

    it('moves the link with release+claim in one transaction on one connection', async () => {
      const first = await createLinkableClient('2027-08-01T09:00:00.000Z', '+7 900 601 11 22');
      const second = await createLinkableClient('2027-08-02T09:00:00.000Z', '+7 900 601 22 33');
      await dogsBookingService.linkTelegramClient(first.accessToken, '900100');

      const pool = await dogsDbConnect();
      const statements = instrumentDogsPool(pool);

      await dogsBookingService.linkTelegramClient(second.accessToken, '900100');

      const begin = statements.findIndex((s) => s.sql === 'BEGIN');
      const release = statements.findIndex((s) => s.sql.includes('TELEGRAM_USER_ID = NULL'));
      const claim = statements.findIndex((s) => s.sql.includes(CLAIM_SQL.toUpperCase()));
      const commit = statements.findIndex((s) => s.sql === 'COMMIT');

      expect(begin).toBeGreaterThanOrEqual(0);
      expect(release).toBeGreaterThan(begin);
      expect(claim).toBeGreaterThan(release);
      expect(commit).toBeGreaterThan(claim);

      const txConnection = statements[begin].connection;
      expect(txConnection).toBeGreaterThan(0);
      [release, claim, commit].forEach((index) => {
        expect(statements[index].connection).toBe(txConnection);
      });

      const linked = await dogsBookingService.getClientByTelegramId('900100');
      expect(linked?.id).toBe(second.id);
      const previous = await dogsBookingService.getClientById(first.id);
      expect(previous?.telegramUserId).toBeNull();
    });

    it('rolls back the transaction when the claim loses a concurrent race (23505)', async () => {
      const first = await createLinkableClient('2027-08-03T09:00:00.000Z', '+7 900 602 11 22');
      const second = await createLinkableClient('2027-08-04T09:00:00.000Z', '+7 900 602 22 33');
      await dogsBookingService.linkTelegramClient(first.accessToken, '900200');

      const pool = await dogsDbConnect();
      const uniqueViolation = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505' }
      );
      // Simulated interleaving: another request claims the id between our
      // release and claim, so our claim UPDATE hits the unique constraint.
      const statements = instrumentDogsPool(pool, (sql) =>
        sql.includes(CLAIM_SQL) ? uniqueViolation : undefined
      );

      await expect(
        dogsBookingService.linkTelegramClient(second.accessToken, '900200')
      ).rejects.toMatchObject({ status: 409 });

      const claim = statements.findIndex((s) => s.sql.includes(CLAIM_SQL.toUpperCase()));
      expect(claim).toBeGreaterThanOrEqual(0);
      const txConnection = statements[claim].connection;
      expect(txConnection).toBeGreaterThan(0);
      const after = statements.slice(claim + 1);
      expect(after.some((s) => s.connection === txConnection && s.sql === 'ROLLBACK')).toBe(true);
      expect(statements.some((s) => s.connection === txConnection && s.sql === 'COMMIT')).toBe(
        false
      );

      // The losing claim must not link the target client.
      const loser = await dogsBookingService.getClientById(second.id);
      expect(loser?.telegramUserId).toBeNull();
    });
  });
});
