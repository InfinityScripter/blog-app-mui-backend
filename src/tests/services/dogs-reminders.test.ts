import '@jest/globals';

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail: sendMailMock,
      verify: jest.fn(),
    })),
  },
}));

/* eslint-disable import/first */
import { resetDogsDatabase } from '@/src/lib/dogs-db';
import { runDogsReminders } from '@/src/services/dogs-reminders';
import { dogsBookingService } from '@/src/services/dogs-booking';
/* eslint-enable import/first */

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// email: null → the client leaves no address (undefined would re-trigger the
// default parameter value).
async function createBooking(startInHours: number, email: string | null = 'anna@example.com') {
  const slot = await dogsBookingService.createSlot({
    startsAt: hoursFromNow(startInHours),
    endsAt: hoursFromNow(startInHours + 1),
  });
  if (!slot) {
    throw new Error('slot was not created');
  }
  return dogsBookingService.createRequest({
    name: 'Анна',
    phone: `+7 900 ${Math.floor(Math.random() * 900 + 100)} ${Math.floor(
      Math.random() * 90 + 10
    )} ${Math.floor(Math.random() * 90 + 10)}`,
    email: email ?? undefined,
    dog: 'Бим',
    serviceId: 'training',
    slotId: slot.id,
    source: 'site',
  });
}

describe('dogs reminders', () => {
  const originalUser = process.env.EMAIL_USER;
  const originalPassword = process.env.EMAIL_PASSWORD;

  beforeEach(async () => {
    await resetDogsDatabase();
    sendMailMock.mockClear();
    process.env.EMAIL_USER = 'owner@example.com';
    process.env.EMAIL_PASSWORD = 'secret';
    delete process.env.DOGS_TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    process.env.EMAIL_USER = originalUser;
    process.env.EMAIL_PASSWORD = originalPassword;
  });

  it('sends exactly one reminder for a confirmed lesson inside the window', async () => {
    const request = await createBooking(20);
    await dogsBookingService.updateBookingStatus(request.id, 'confirmed');

    const first = await runDogsReminders();
    expect(first).toEqual({ due: 1, sent: 1 });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe('anna@example.com');
    expect(String(sendMailMock.mock.calls[0][0].subject)).toContain('Напоминание');

    // Second run must be a no-op: the claim already happened.
    const second = await runDogsReminders();
    expect(second).toEqual({ due: 0, sent: 0 });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('skips pending requests and lessons outside the window', async () => {
    await createBooking(20, 'pending@example.com'); // stays pending
    const far = await createBooking(80, 'far@example.com');
    await dogsBookingService.updateBookingStatus(far.id, 'confirmed');

    const result = await runDogsReminders();
    expect(result).toEqual({ due: 0, sent: 0 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('still counts the reminder when the client has no email (other channels)', async () => {
    const request = await createBooking(10, null);
    await dogsBookingService.updateBookingStatus(request.id, 'confirmed');

    const result = await runDogsReminders();
    expect(result).toEqual({ due: 1, sent: 1 });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
