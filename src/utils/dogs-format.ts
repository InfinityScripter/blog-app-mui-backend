// Human-readable Russian date/time for client-facing dogs-teacher
// notifications. Every channel (email / Telegram / web push) must render
// lesson times in the business's timezone, NOT the server's: the VDS runs in
// UTC while the trainer and her clients live in Noyabrsk (UTC+5). Without an
// explicit timeZone, toLocaleString() silently shifts every notification by
// the server offset. Overridable via DOGS_TIMEZONE.

const FALLBACK_TIMEZONE = 'Asia/Yekaterinburg';

export function getDogsTimezone() {
  return process.env.DOGS_TIMEZONE || FALLBACK_TIMEZONE;
}

function getParts(value: string | Date, options: Intl.DateTimeFormatOptions) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: getDogsTimezone(),
    ...options,
  });
  const parts: Record<string, string> = {};
  formatter.formatToParts(new Date(value)).forEach((part) => {
    parts[part.type] = part.value;
  });
  return parts;
}

// "суббота, 6 июля"
export function formatDogsDate(value: string | Date) {
  const parts = getParts(value, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

// "10:00"
export function formatDogsClock(value: string | Date) {
  const parts = getParts(value, { hour: '2-digit', minute: '2-digit' });
  return `${parts.hour}:${parts.minute}`;
}

// "суббота, 6 июля в 10:00"
export function formatDogsDateTime(value: string | Date) {
  return `${formatDogsDate(value)} в ${formatDogsClock(value)}`;
}

function dayKey(value: string | Date) {
  const parts = getParts(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 'сегодня' | 'завтра' | null — relative day label in the business timezone,
// for reminder wording ("занятие завтра в 10:00").
export function formatDogsDayLabel(value: string | Date, now: Date = new Date()) {
  const target = dayKey(value);
  if (target === dayKey(now)) {
    return 'сегодня';
  }
  if (target === dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))) {
    return 'завтра';
  }
  return null;
}

// Booking form service ids → human titles (mirrors the frontend services list
// in dogs-teacher src/data/persona.ts). Falls back to the raw id so an unknown
// future service never renders an empty field.
const SERVICE_TITLES: Record<string, string> = {
  training: 'Дрессировка собак',
  correction: 'Коррекция поведения',
  zoopsychology: 'Зоопсихология',
  online: 'Онлайн-сопровождение',
};

export function dogsServiceTitle(serviceId: string | undefined) {
  if (!serviceId) {
    return null;
  }
  return SERVICE_TITLES[serviceId] ?? serviceId;
}
