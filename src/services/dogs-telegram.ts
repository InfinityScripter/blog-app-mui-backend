import type { DogsBookingRequest } from '@/src/services/dogs-booking';

import { AppError } from '@/src/types/api';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { dogsBookingService } from '@/src/services/dogs-booking';
import {
  formatDogsClock,
  dogsServiceTitle,
  formatDogsDateTime,
  formatDogsDayLabel,
} from '@/src/utils/dogs-format';

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

function getOwnerChatIds() {
  return (process.env.DOGS_OWNER_TELEGRAM_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
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
    method: HTTP_METHOD.POST,
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

function bookingLink(accessToken: string) {
  return `${getSiteUrl()}/booking/client/${accessToken}`;
}

// Personalised main menu: a linked client's "Мои заявки" button deep-links
// straight into their cabinet; anyone else lands on the booking page. The
// "Контакты" button targets the landing location section (map + address).
function mainMenuMarkup(accessToken?: string | null): TelegramReplyMarkup {
  const siteUrl = getSiteUrl();
  return {
    inline_keyboard: [
      [{ text: 'Записаться', url: `${siteUrl}/booking?source=telegram` }],
      [{ text: 'Мои заявки', url: accessToken ? bookingLink(accessToken) : `${siteUrl}/booking` }],
      [{ text: 'Контакты', url: `${siteUrl}/#location` }],
    ],
  };
}

async function menuForTelegramUser(telegramUserId: string) {
  const client = await dogsBookingService.getClientByTelegramId(telegramUserId).catch(() => null);
  return mainMenuMarkup(client?.accessToken);
}

async function sendStart(chatId: number | string, telegramUserId: string) {
  await sendMessage(
    chatId,
    'Здравствуйте! Здесь можно записаться на занятие к кинологу и посмотреть свои заявки.',
    await menuForTelegramUser(telegramUserId)
  );
}

async function sendContacts(chatId: number | string, telegramUserId: string) {
  await sendMessage(chatId, buildContactsText(), await menuForTelegramUser(telegramUserId));
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
    'Готово, Telegram привязан! Здесь будут приходить подтверждения и напоминания о занятиях.',
    mainMenuMarkup(client.accessToken)
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
    await sendStart(chatId, telegramUserId);
    return;
  }

  if (text === '/my' || text === 'Мои заявки') {
    await sendMyBookings(chatId, telegramUserId);
    return;
  }

  if (text === '/contacts' || text === 'Контакты') {
    await sendContacts(chatId, telegramUserId);
    return;
  }

  await sendStart(chatId, telegramUserId);
}

export async function notifyDogsOwnerNewRequest(request: DogsBookingRequest) {
  const ownerChatIds = getOwnerChatIds();
  if (!ownerChatIds.length || !process.env.DOGS_TELEGRAM_BOT_TOKEN) {
    return;
  }

  const adminUrl = `${getSiteUrl()}/admin`;
  const text = [
    '🐾 Новая заявка на занятие',
    '',
    `Когда: ${formatDogsDateTime(request.slot.startsAt)}`,
    `Услуга: ${dogsServiceTitle(request.serviceId) ?? 'не указана'}`,
    `Клиент: ${request.client.name}`,
    `Телефон: ${request.client.phone}`,
    `Собака: ${request.dog || 'не указано'}`,
    ...(request.comment ? [`Комментарий: ${request.comment}`] : []),
    '',
    `Подтвердить в админке: ${adminUrl}`,
  ].join('\n');

  await Promise.all(ownerChatIds.map((chatId) => sendMessage(chatId, text)));
}

// Notify the owner when a client cancels their own request from the site or
// cabinet. No-op unless the bot + owner chat id are configured.
export async function notifyDogsOwnerClientCancelled(request: DogsBookingRequest) {
  const ownerChatIds = getOwnerChatIds();
  if (!ownerChatIds.length || !process.env.DOGS_TELEGRAM_BOT_TOKEN) {
    return;
  }

  const adminUrl = `${getSiteUrl()}/admin`;
  const text = [
    '↩️ Клиент отменил заявку',
    '',
    `Когда было: ${formatDogsDateTime(request.slot.startsAt)}`,
    `Клиент: ${request.client.name}`,
    `Телефон: ${request.client.phone}`,
    '',
    `Слот снова свободен. Админка: ${adminUrl}`,
  ].join('\n');

  await Promise.all(ownerChatIds.map((chatId) => sendMessage(chatId, text)));
}

// Resolves the linked Telegram chat for a request's client, or null when the
// bot is unconfigured / the client never linked Telegram.
async function getLinkedTelegramUserId(request: DogsBookingRequest) {
  if (!process.env.DOGS_TELEGRAM_BOT_TOKEN) {
    return null;
  }
  const client = await dogsBookingService.getClientById(request.client.id);
  return client?.telegramUserId ?? null;
}

// Notify the client in Telegram when the owner changes a request's status.
// No-op unless the bot is configured AND the client linked their Telegram.
export async function notifyDogsClientStatusChange(request: DogsBookingRequest) {
  const telegramUserId = await getLinkedTelegramUserId(request);
  if (!telegramUserId) {
    return;
  }

  const statusLine = STATUS_MESSAGES[request.status] ?? STATUS_MESSAGES.pending;
  const text = [
    statusLine,
    '',
    `Когда: ${formatDogsDateTime(request.slot.startsAt)}`,
    ...(request.dog ? [`Собака: ${request.dog}`] : []),
    `Все ваши заявки: ${bookingLink(request.client.accessToken)}`,
  ].join('\n');

  await sendMessage(telegramUserId, text);
}

// Instant Telegram acknowledgement for a returning client who already linked
// the bot: their new request landed and awaits confirmation. First-time
// clients aren't linked yet, so this is a silent no-op for them.
export async function notifyDogsClientRequestReceived(request: DogsBookingRequest) {
  const telegramUserId = await getLinkedTelegramUserId(request);
  if (!telegramUserId) {
    return;
  }

  const text = [
    '🐾 Заявка получена — ждёт подтверждения.',
    '',
    `Когда: ${formatDogsDateTime(request.slot.startsAt)}`,
    ...(request.dog ? [`Собака: ${request.dog}`] : []),
    'Подтверждение придёт сюда же.',
  ].join('\n');

  await sendMessage(telegramUserId, text);
}

// Reminder for a confirmed lesson within the next ~day. Fired by the reminder
// scheduler (src/services/dogs-reminders.ts), at most once per request.
export async function notifyDogsClientReminder(request: DogsBookingRequest) {
  const telegramUserId = await getLinkedTelegramUserId(request);
  if (!telegramUserId) {
    return;
  }

  const dayLabel = formatDogsDayLabel(request.slot.startsAt);
  const clock = formatDogsClock(request.slot.startsAt);
  const whenShort = dayLabel ? `${dayLabel} в ${clock}` : formatDogsDateTime(request.slot.startsAt);
  const text = [
    `🔔 Напоминание: занятие ${whenShort}. Ждём вас!`,
    '',
    buildContactsText(),
    '',
    `Ваши заявки: ${bookingLink(request.client.accessToken)}`,
  ].join('\n');

  await sendMessage(telegramUserId, text);
}
