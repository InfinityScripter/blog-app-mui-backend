import type { DogsBookingRequest } from '@/src/services/dogs-booking';

import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { dogsBookingService } from '@/src/services/dogs-booking';

interface TelegramMessage {
  text?: string;
  chat: { id: number | string };
  from?: { id: number | string };
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

interface TelegramReplyMarkup {
  inline_keyboard: { text: string; url: string }[][];
}

function getBotToken() {
  const token = process.env.DOGS_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Dogs Telegram bot token is not configured');
  }
  return token;
}

function getSiteUrl() {
  return (process.env.DOGS_SITE_URL || 'https://dogs-teacher.vercel.app').replace(/\/$/, '');
}

function getOwnerChatId() {
  return process.env.DOGS_OWNER_TELEGRAM_ID;
}

// Contact details for the bot's "Контакты" reply. Defaults mirror the site
// persona (DOG-CITY, Ноябрьск); each line is overridable via env so the bot
// can be reused without code changes.
const CONTACT_DEFAULTS = {
  phone: '+7 922 254 14 87',
  address: 'Ноябрьск, ул. Молодёжная, 4 (ближнее СМП), центр DOG-CITY',
  landmark: 'Следующее здание после ветклиники «Айболит»',
  mapsLink:
    'https://yandex.ru/maps/11231/noyabrsk/house/molodyozhnaya_ulitsa_4/Y0wYcgZkTEQGQFhpfX10c3xnYQ==/?ll=75.414861%2C63.151911&z=17',
};

function buildContactsText() {
  if (process.env.DOGS_CONTACT_TEXT) {
    return process.env.DOGS_CONTACT_TEXT;
  }

  const phone = process.env.DOGS_CONTACT_PHONE || CONTACT_DEFAULTS.phone;
  const address = process.env.DOGS_CONTACT_ADDRESS || CONTACT_DEFAULTS.address;
  const landmark = process.env.DOGS_CONTACT_LANDMARK || CONTACT_DEFAULTS.landmark;
  const mapsLink = process.env.DOGS_CONTACT_MAPS_LINK || CONTACT_DEFAULTS.mapsLink;

  return [
    '📞 Телефон',
    phone,
    '',
    '📍 Где меня найти',
    address,
    landmark,
    '',
    '🗺 Яндекс Карты (маршрут и точка)',
    mapsLink,
  ].join('\n');
}

const STATUS_MESSAGES: Record<string, string> = {
  confirmed: '✅ Ваша заявка подтверждена. Ждём вас на занятии!',
  declined: '❌ К сожалению, заявку пришлось отклонить. Напишите нам, подберём другое время.',
  cancelled: 'ℹ️ Ваша заявка отменена.',
  pending: 'ℹ️ Статус заявки обновлён: ожидает подтверждения.',
};

async function sendMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramReplyMarkup
) {
  const response = await fetch(`https://api.telegram.org/bot${getBotToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    throw new AppError(HTTP.SERVICE_UNAVAILABLE, 'Telegram API request failed');
  }
}

function mainMenuMarkup(): TelegramReplyMarkup {
  const siteUrl = getSiteUrl();
  return {
    inline_keyboard: [
      [{ text: 'Записаться', url: `${siteUrl}/booking?source=telegram` }],
      [{ text: 'Мои заявки', url: `${siteUrl}/booking` }],
      [{ text: 'Контакты', url: `${siteUrl}/#booking` }],
    ],
  };
}

function bookingLink(accessToken: string) {
  return `${getSiteUrl()}/booking/client/${accessToken}`;
}

async function sendStart(chatId: number | string) {
  await sendMessage(
    chatId,
    'Здравствуйте! Здесь можно записаться на занятие к кинологу и посмотреть свои заявки.',
    mainMenuMarkup()
  );
}

async function sendContacts(chatId: number | string) {
  await sendMessage(chatId, buildContactsText(), mainMenuMarkup());
}

async function sendMyBookings(chatId: number | string, telegramUserId: string) {
  const client = await dogsBookingService.getClientByTelegramId(telegramUserId);
  if (!client) {
    await sendMessage(
      chatId,
      'Я пока не нашла привязанных заявок. Создайте первую заявку на сайте, затем откройте личную ссылку из заявки.',
      mainMenuMarkup()
    );
    return;
  }

  await sendMessage(chatId, `Ваши заявки: ${bookingLink(client.accessToken)}`);
}

async function linkClient(chatId: number | string, telegramUserId: string, accessToken: string) {
  const client = await dogsBookingService.linkTelegramClient(accessToken, telegramUserId);
  await sendMessage(
    chatId,
    `Готово, Telegram привязан. Ваши заявки: ${bookingLink(client.accessToken)}`
  );
}

export async function handleDogsTelegramUpdate(update: TelegramUpdate) {
  const { message } = update;
  if (!message?.text) {
    return;
  }

  const chatId = message.chat.id;
  const telegramUserId = String(message.from?.id ?? chatId);
  const text = message.text.trim();

  if (text.startsWith('/start ')) {
    await linkClient(chatId, telegramUserId, text.replace('/start ', '').trim());
    return;
  }

  if (text === '/start') {
    await sendStart(chatId);
    return;
  }

  if (text === '/my' || text === 'Мои заявки') {
    await sendMyBookings(chatId, telegramUserId);
    return;
  }

  if (text === '/contacts' || text === 'Контакты') {
    await sendContacts(chatId);
    return;
  }

  await sendStart(chatId);
}

export async function notifyDogsOwnerNewRequest(request: DogsBookingRequest) {
  const ownerChatId = getOwnerChatId();
  if (!ownerChatId || !process.env.DOGS_TELEGRAM_BOT_TOKEN) {
    return;
  }

  const adminUrl = `${getSiteUrl()}/admin`;
  const text = [
    'Новая заявка на занятие',
    `Клиент: ${request.client.name}`,
    `Телефон: ${request.client.phone}`,
    `Собака: ${request.dog || 'не указано'}`,
    `Время: ${new Date(request.slot.startsAt).toLocaleString('ru-RU')}`,
    `Админка: ${adminUrl}`,
  ].join('\n');

  await sendMessage(ownerChatId, text);
}

// Notify the client in Telegram when the owner changes a request's status.
// No-op unless the bot is configured AND the client linked their Telegram.
export async function notifyDogsClientStatusChange(request: DogsBookingRequest) {
  if (!process.env.DOGS_TELEGRAM_BOT_TOKEN) {
    return;
  }

  const client = await dogsBookingService.getClientById(request.client.id);
  const telegramUserId = client?.telegramUserId;
  if (!telegramUserId) {
    return;
  }

  const statusLine = STATUS_MESSAGES[request.status] ?? STATUS_MESSAGES.pending;
  const text = [
    statusLine,
    '',
    `Время: ${new Date(request.slot.startsAt).toLocaleString('ru-RU')}`,
    `Все ваши заявки: ${bookingLink(request.client.accessToken)}`,
  ].join('\n');

  await sendMessage(telegramUserId, text);
}
