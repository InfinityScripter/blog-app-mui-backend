import '@jest/globals';
import { dogsBookingService } from '@/src/services/dogs-booking';
import {
  handleDogsTelegramUpdate,
  notifyDogsClientReminder,
  notifyDogsOwnerNewRequest,
  notifyDogsClientStatusChange,
  notifyDogsClientRequestReceived,
} from '@/src/services/dogs-telegram';

interface TelegramCall {
  url: string;
  body: {
    chat_id: number | string;
    text: string;
    reply_markup?: { inline_keyboard: { text: string; url: string }[][] };
  };
}

function mockTelegramFetch() {
  const calls: TelegramCall[] = [];
  const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init?.body ?? '{}') });
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

describe('dogs telegram service', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.DOGS_TELEGRAM_BOT_TOKEN = 'test-token';
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.DOGS_TELEGRAM_BOT_TOKEN;
    delete process.env.DOGS_CONTACT_TEXT;
    delete process.env.DOGS_OWNER_TELEGRAM_ID;
    jest.restoreAllMocks();
  });

  it('answers /contacts with a Yandex Maps link', async () => {
    const calls = mockTelegramFetch();
    await handleDogsTelegramUpdate({ message: { text: '/contacts', chat: { id: 555 } } });

    expect(calls).toHaveLength(1);
    expect(calls[0].body.text).toContain('Телефон');
    expect(calls[0].body.text).toContain('yandex.ru/maps');
  });

  it('notifies a linked client when status changes', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-01T09:00:00.000Z',
      endsAt: '2027-06-01T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 444 55 66',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });
    await dogsBookingService.linkTelegramClient(request.client.accessToken, '987654');

    const calls = mockTelegramFetch();
    const { booking } = await dogsBookingService.updateBookingStatus(request.id, 'confirmed');
    await notifyDogsClientStatusChange(booking);

    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.chat_id)).toBe('987654');
    expect(calls[0].body.text).toContain('подтверждена');
  });

  it('does not notify an unlinked client', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-02T09:00:00.000Z',
      endsAt: '2027-06-02T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 555 66 77',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    const { booking } = await dogsBookingService.updateBookingStatus(request.id, 'declined');
    await notifyDogsClientStatusChange(booking);

    expect(calls).toHaveLength(0);
  });

  it('notifies every owner when DOGS_OWNER_TELEGRAM_ID has multiple comma-separated ids', async () => {
    process.env.DOGS_OWNER_TELEGRAM_ID = '111, 222';
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-03T09:00:00.000Z',
      endsAt: '2027-06-03T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Олег',
      phone: '+7 900 111 22 33',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => String(c.body.chat_id)).sort()).toEqual(['111', '222']);
  });

  it('notifies a single owner when DOGS_OWNER_TELEGRAM_ID has one id', async () => {
    process.env.DOGS_OWNER_TELEGRAM_ID = '111';
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-04T09:00:00.000Z',
      endsAt: '2027-06-04T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Инна',
      phone: '+7 900 222 33 44',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.chat_id)).toBe('111');
  });

  it('acknowledges a new request to a linked client and renders the business-TZ time', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-05T09:00:00.000Z', // 14:00 in Asia/Yekaterinburg, суббота
      endsAt: '2027-06-05T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Анна',
      phone: '+7 900 777 88 99',
      dog: 'Бим',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });
    await dogsBookingService.linkTelegramClient(request.client.accessToken, '424242');

    const calls = mockTelegramFetch();
    await notifyDogsClientRequestReceived(request);

    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.chat_id)).toBe('424242');
    expect(calls[0].body.text).toContain('Заявка получена');
    expect(calls[0].body.text).toContain('в 14:00');
  });

  it('does not acknowledge a new request to an unlinked client', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-06T09:00:00.000Z',
      endsAt: '2027-06-06T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Пётр',
      phone: '+7 900 888 99 00',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsClientRequestReceived(request);
    await notifyDogsClientReminder(request);

    expect(calls).toHaveLength(0);
  });

  it('sends a reminder with contacts to a linked client', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-07T09:00:00.000Z',
      endsAt: '2027-06-07T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Инна',
      phone: '+7 900 999 00 11',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });
    await dogsBookingService.linkTelegramClient(request.client.accessToken, '515151');

    const calls = mockTelegramFetch();
    await notifyDogsClientReminder(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].body.text).toContain('Напоминание');
    expect(calls[0].body.text).toContain('Телефон');
  });

  it('deep-links "Мои заявки" to the cabinet for a linked client on /start', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-08T09:00:00.000Z',
      endsAt: '2027-06-08T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Олег',
      phone: '+7 900 123 45 67',
      serviceId: 'training',
      slotId: slot!.id,
      source: 'site',
    });
    await dogsBookingService.linkTelegramClient(request.client.accessToken, '616161');

    const calls = mockTelegramFetch();
    await handleDogsTelegramUpdate({
      message: { text: '/start', chat: { id: 616161 }, from: { id: 616161 } },
    });

    expect(calls).toHaveLength(1);
    const buttons = calls[0].body.reply_markup?.inline_keyboard.flat() ?? [];
    const myBookings = buttons.find((button) => button.text === 'Мои заявки');
    expect(myBookings?.url).toContain(`/booking/client/${request.client.accessToken}`);
    const contacts = buttons.find((button) => button.text === 'Контакты');
    expect(contacts?.url).toContain('/#location');
  });

  it('does not notify anyone when DOGS_OWNER_TELEGRAM_ID is unset', async () => {
    const slot = await dogsBookingService.createSlot({
      startsAt: '2027-06-05T09:00:00.000Z',
      endsAt: '2027-06-05T10:00:00.000Z',
    });
    const request = await dogsBookingService.createRequest({
      name: 'Юрий',
      phone: '+7 900 333 44 55',
      serviceId: 'training',
      slotId: slot.id,
      source: 'site',
    });

    const calls = mockTelegramFetch();
    await notifyDogsOwnerNewRequest(request);

    expect(calls).toHaveLength(0);
  });
});
