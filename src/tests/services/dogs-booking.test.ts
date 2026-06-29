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
});
