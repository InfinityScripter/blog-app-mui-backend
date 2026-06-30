import '@jest/globals';
import { dogsBookingService } from '@/src/services/dogs-booking';

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
});
