import '@jest/globals';
import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { calendarService } from '@/src/services/calendar';

describe('calendarService', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await User.create({ _id: 'owner', name: 'Owner', email: 'o@e.com', passwordHash: 'x' });
    await User.create({ _id: 'other', name: 'Other', email: 'ot@e.com', passwordHash: 'x' });
  });

  it('createEvent + listEvents: owner sees their own private event', async () => {
    const ev = await calendarService.createEvent({
      userId: 'owner',
      title: 'Standup',
      start: '2026-01-01T09:00:00Z',
      end: '2026-01-01T09:30:00Z',
      type: 'private',
    });
    expect(ev.id).toBeTruthy();
    const events = await calendarService.listEvents('owner');
    expect(events.some((e) => e.id === ev.id)).toBe(true);
  });

  it('listEvents: another user does NOT see a private event', async () => {
    await calendarService.createEvent({
      userId: 'owner',
      title: 'Private',
      start: '2026-01-02T09:00:00Z',
      end: '2026-01-02T10:00:00Z',
      type: 'private',
    });
    const otherEvents = await calendarService.listEvents('other');
    expect(otherEvents).toHaveLength(0);
  });

  it('listEvents: public events are visible to everyone', async () => {
    await calendarService.createEvent({
      userId: 'owner',
      title: 'Public',
      start: '2026-01-03T09:00:00Z',
      end: '2026-01-03T10:00:00Z',
      type: 'public',
    });
    const otherEvents = await calendarService.listEvents('other');
    expect(otherEvents).toHaveLength(1);
  });

  it('createEvent: missing required field → AppError 400', async () => {
    await expect(
      calendarService.createEvent({ userId: 'owner', title: '', start: '', end: '', type: '' })
    ).rejects.toBeInstanceOf(AppError);
  });
});
