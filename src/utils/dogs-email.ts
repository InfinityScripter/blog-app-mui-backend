import nodemailer from 'nodemailer';
import { DOGS_MAPS_LINK, DOGS_CONTACT_PHONE, DOGS_CONTACT_PHONE_HREF } from '@/src/constants/dogs';
import {
  formatDogsDate,
  formatDogsClock,
  dogsServiceTitle,
  formatDogsDayLabel,
  formatDogsDateTime,
} from '@/src/utils/dogs-format';

// ----------------------------------------------------------------------
// Client-facing email for the dogs-teacher booking flow. Reuses the Gmail
// SMTP pattern from src/utils/email.ts, but is built lazily and guarded so it
// is always a safe no-op when email isn't configured or the client gave no
// address. Callers fire these non-blocking (.catch) — a send failure must
// never break the API response.
//
// Every message is rendered through one branded, email-client-safe layout:
// table-based, inline styles only, 600px column, dark header band + green CTA
// mirroring the site palette (src/theme in dogs-teacher). A plain-text
// alternative is attached for deliverability.

interface DogsEmailClient {
  name: string;
  email: string | null;
}

interface DogsEmailRequest {
  id: string;
  status: string;
  dog: string;
  slot: { startsAt: string; endsAt?: string };
  client: { accessToken: string };
  serviceId?: string;
}

function hasEmailCredentials() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
}

// Escape user-supplied values before interpolating into the email HTML body.
// name/dog come from the public, unauthenticated booking form, so without this
// they are a stored-HTML-injection vector in the email rendered to the client.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSiteUrl() {
  return (process.env.DOGS_SITE_URL || 'https://dogs-teacher.vercel.app').replace(/\/$/, '');
}

function cabinetLink(accessToken: string) {
  return `${getSiteUrl()}/booking/client/${accessToken}`;
}

// ----------------------------------------------------------------------
// Brand palette — mirrors dogs-teacher src/theme/index.ts + site footer.

const BRAND = {
  green: '#3f6b35',
  greenDark: '#345929',
  greenTint: '#e8efdf',
  bg: '#f6f3ec',
  paper: '#fdfcf8',
  ink: '#22271f',
  muted: '#5d6355',
  divider: '#e3ddcd',
  headerBg: '#232920',
  headerInk: '#c9cec0',
};

const CONTACTS = {
  phone: DOGS_CONTACT_PHONE,
  phoneHref: DOGS_CONTACT_PHONE_HREF,
  address: 'Ноябрьск, ул. Молодёжная, 4 — центр «DOG-CITY»',
  mapsLink: DOGS_MAPS_LINK,
};

interface StatusMeta {
  chip: string;
  chipBg: string;
  chipInk: string;
  title: string;
  lead: (name: string) => string;
}

const STATUS_META: Record<string, StatusMeta> = {
  pending: {
    chip: 'Ожидает подтверждения',
    chipBg: '#f7edd6',
    chipInk: '#8a6d1d',
    title: 'Статус заявки обновлён',
    lead: (name) => `${name}, ваша заявка снова ожидает подтверждения. Мы скоро с вами свяжемся.`,
  },
  confirmed: {
    chip: 'Занятие подтверждено',
    chipBg: BRAND.greenTint,
    chipInk: BRAND.greenDark,
    title: 'Занятие подтверждено 🎉',
    lead: (name) => `${name}, всё в силе — ждём вас на занятии! Ниже детали встречи.`,
  },
  declined: {
    chip: 'Время не подошло',
    chipBg: '#f7e3df',
    chipInk: '#a24236',
    title: 'Не получилось подтвердить время',
    lead: (name) =>
      `${name}, к сожалению, это время занято. Напишите или позвоните нам — вместе подберём другое.`,
  },
  cancelled: {
    chip: 'Заявка отменена',
    chipBg: '#ece9e0',
    chipInk: BRAND.muted,
    title: 'Заявка отменена',
    lead: (name) =>
      `${name}, заявка отменена. Если это ошибка или планы изменились — запишитесь заново, это быстро.`,
  },
};

interface DetailRow {
  label: string;
  value: string;
}

interface DogsEmailCalendarLinks {
  google: string;
  ics: string;
}

interface DogsEmailTemplate {
  preheader: string;
  title: string;
  lead: string;
  chip?: { text: string; bg: string; ink: string };
  rows: DetailRow[];
  cta: { text: string; url: string };
  calendar?: DogsEmailCalendarLinks | null;
  outro?: string;
}

// Calendar links: a Google "add event" deep link plus an .ics file served by
// the frontend (/api/calendar/<token>/<id>) — the .ics opens straight in the
// iPhone/Apple Calendar (and Outlook). Times are passed in UTC (Z suffix) so
// the calendar renders them in the invitee's own timezone.
function buildCalendarLinks(request: DogsEmailRequest): DogsEmailCalendarLinks | null {
  const start = new Date(request.slot.startsAt);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = request.slot.endsAt
    ? new Date(request.slot.endsAt)
    : new Date(start.getTime() + 60 * 60 * 1000);
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'Занятие с кинологом — DOG-CITY',
    dates: `${stamp(start)}/${stamp(end)}`,
    details: `Кинолог Виктория Фролова. Ваши заявки: ${cabinetLink(request.client.accessToken)}`,
    location: CONTACTS.address,
  });
  return {
    google: `https://calendar.google.com/calendar/render?${params.toString()}`,
    ics: `${getSiteUrl()}/api/calendar/${request.client.accessToken}/${request.id}`,
  };
}

function buildDetailRows(request: DogsEmailRequest): DetailRow[] {
  const rows: DetailRow[] = [
    { label: 'Дата', value: formatDogsDate(request.slot.startsAt) },
    { label: 'Время', value: formatDogsClock(request.slot.startsAt) },
  ];
  const service = dogsServiceTitle(request.serviceId);
  if (service) {
    rows.push({ label: 'Услуга', value: service });
  }
  if (request.dog) {
    rows.push({ label: 'Собака', value: escapeHtml(request.dog) });
  }
  return rows;
}

function renderRows(rows: DetailRow[]) {
  return rows
    .map(
      (row, index) => `
        <tr>
          <td style="padding:10px 0;border-top:${index === 0 ? 'none' : `1px solid ${BRAND.divider}`};font:400 14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};width:96px;vertical-align:top;">${row.label}</td>
          <td style="padding:10px 0;border-top:${index === 0 ? 'none' : `1px solid ${BRAND.divider}`};font:600 14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};">${row.value}</td>
        </tr>`
    )
    .join('');
}

// One shared shell for every dogs email: hidden preheader, dark brand header,
// paper card with chip + details + bulletproof CTA button, contacts footer.
function renderDogsEmail(template: DogsEmailTemplate) {
  const chip = template.chip
    ? `<div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${template.chip.bg};color:${template.chip.ink};font:600 13px/1.2 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;margin:0 0 16px;">${template.chip.text}</div>`
    : '';

  const calendarLink = template.calendar
    ? `<p style="margin:14px 0 0;font:400 14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};">
         ➕ Добавить занятие в календарь:
         <a href="${template.calendar.google}" style="color:${BRAND.green};text-decoration:underline;">Google</a>
         &nbsp;·&nbsp;
         <a href="${template.calendar.ics}" style="color:${BRAND.green};text-decoration:underline;">Apple / iPhone (.ics)</a>
       </p>`
    : '';

  const outro = template.outro
    ? `<p style="margin:20px 0 0;font:400 14px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};">${template.outro}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${template.title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${template.preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:${BRAND.headerBg};border-radius:16px 16px 0 0;padding:20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font:700 18px/1.3 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#ffffff;">🐾 DOG-CITY</td>
                  <td align="right" style="font:400 13px/1.3 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.headerInk};">Виктория Фролова · кинолог</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.paper};border:1px solid ${BRAND.divider};border-top:none;border-radius:0 0 16px 16px;padding:32px 28px;">
              ${chip}
              <h1 style="margin:0 0 12px;font:700 22px/1.3 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};">${template.title}</h1>
              <p style="margin:0 0 20px;font:400 15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};">${template.lead}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};border:1px solid ${BRAND.divider};border-radius:12px;padding:6px 18px;margin:0 0 24px;">
                ${renderRows(template.rows)}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:999px;background:${BRAND.green};">
                    <a href="${template.cta.url}" style="display:inline-block;padding:13px 32px;font:600 15px/1.2 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px;">${template.cta.text}</a>
                  </td>
                </tr>
              </table>
              ${calendarLink}
              ${outro}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;">
              <p style="margin:0 0 6px;font:600 13px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};">Кинологический центр «DOG-CITY»</p>
              <p style="margin:0 0 2px;font:400 13px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};">${CONTACTS.address} · <a href="${CONTACTS.mapsLink}" style="color:${BRAND.green};">маршрут</a></p>
              <p style="margin:0 0 10px;font:400 13px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};">Телефон: <a href="tel:${CONTACTS.phoneHref}" style="color:${BRAND.green};text-decoration:none;">${CONTACTS.phone}</a></p>
              <p style="margin:0;font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};">Вы получили это письмо, потому что оставили заявку на занятие. Есть вопрос — просто ответьте на письмо.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Plain-text alternative part: same content without markup, improves spam
// scoring and covers clients with HTML rendering disabled.
function renderDogsEmailText(template: DogsEmailTemplate) {
  const rows = template.rows.map((row) => `${row.label}: ${row.value}`).join('\n');
  return [
    template.title,
    '',
    template.lead,
    '',
    rows,
    '',
    `${template.cta.text}: ${template.cta.url}`,
    template.calendar ? `Добавить в календарь (Google): ${template.calendar.google}` : '',
    template.calendar ? `Файл для Apple/iPhone (.ics): ${template.calendar.ics}` : '',
    template.outro ?? '',
    '',
    `DOG-CITY · ${CONTACTS.address} · ${CONTACTS.phone}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let cachedTransport: nodemailer.Transporter | null = null;

function getTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }
  return cachedTransport;
}

async function send(to: string, subject: string, template: DogsEmailTemplate) {
  await getTransport().sendMail({
    from: { name: 'DOG-CITY · Виктория Фролова', address: process.env.EMAIL_USER as string },
    to,
    subject,
    html: renderDogsEmail(template),
    text: renderDogsEmailText(template),
  });
}

function shouldSend(client: DogsEmailClient): client is DogsEmailClient & { email: string } {
  return hasEmailCredentials() && Boolean(client.email);
}

export async function sendDogsRequestReceived(client: DogsEmailClient, request: DogsEmailRequest) {
  if (!shouldSend(client)) {
    return;
  }

  const name = escapeHtml(client.name);
  const when = `${formatDogsDate(request.slot.startsAt)}, ${formatDogsClock(request.slot.startsAt)}`;
  await send(client.email, `🐾 Заявка получена — ${when}`, {
    preheader: `Мы получили вашу заявку на ${when}. Подтвердим и напомним о занятии.`,
    title: 'Заявка получена',
    lead: `Здравствуйте, ${name}! Мы получили вашу заявку и скоро свяжемся с вами, чтобы подтвердить занятие.`,
    chip: {
      text: STATUS_META.pending.chip,
      bg: STATUS_META.pending.chipBg,
      ink: STATUS_META.pending.chipInk,
    },
    rows: buildDetailRows(request),
    cta: { text: 'Мои заявки', url: cabinetLink(request.client.accessToken) },
    outro:
      'Статус заявки всегда виден в личном кабинете — там же можно отменить запись, если планы изменятся.',
  });
}

export async function sendDogsStatusChanged(client: DogsEmailClient, request: DogsEmailRequest) {
  if (!shouldSend(client)) {
    return;
  }

  const meta = STATUS_META[request.status] ?? STATUS_META.pending;
  const name = escapeHtml(client.name);
  const when = `${formatDogsDate(request.slot.startsAt)}, ${formatDogsClock(request.slot.startsAt)}`;
  const subject =
    request.status === 'confirmed'
      ? `✅ Занятие подтверждено — ${when}`
      : `${meta.chip} — занятие ${when}`;

  await send(client.email, subject, {
    preheader: `${meta.chip}: занятие ${when}.`,
    title: meta.title,
    lead: meta.lead(name),
    chip: { text: meta.chip, bg: meta.chipBg, ink: meta.chipInk },
    rows: buildDetailRows(request),
    cta: { text: 'Мои заявки', url: cabinetLink(request.client.accessToken) },
    calendar: request.status === 'confirmed' ? buildCalendarLinks(request) : null,
    outro:
      request.status === 'declined'
        ? `Позвоните нам — ${CONTACTS.phone} — или выберите другое время в пару кликов.`
        : undefined,
  });
}

// Reminder for a confirmed lesson within the next ~day. Fired by the reminder
// scheduler (src/services/dogs-reminders.ts), at most once per request.
export async function sendDogsReminder(client: DogsEmailClient, request: DogsEmailRequest) {
  if (!shouldSend(client)) {
    return;
  }

  const name = escapeHtml(client.name);
  const dayLabel = formatDogsDayLabel(request.slot.startsAt);
  const clock = formatDogsClock(request.slot.startsAt);
  const whenShort = dayLabel ? `${dayLabel} в ${clock}` : formatDogsDateTime(request.slot.startsAt);

  await send(client.email, `🔔 Напоминание: занятие ${whenShort}`, {
    preheader: `Ждём вас ${whenShort}. Адрес и детали внутри.`,
    title: 'Скоро занятие!',
    lead: `${name}, напоминаем: ваше занятие ${whenShort}. Ждём вас в центре «DOG-CITY».`,
    chip: {
      text: STATUS_META.confirmed.chip,
      bg: STATUS_META.confirmed.chipBg,
      ink: STATUS_META.confirmed.chipInk,
    },
    rows: buildDetailRows(request),
    cta: { text: 'Мои заявки', url: cabinetLink(request.client.accessToken) },
    calendar: buildCalendarLinks(request),
    outro: `Если не получается прийти — отмените запись в кабинете или позвоните: ${CONTACTS.phone}.`,
  });
}
