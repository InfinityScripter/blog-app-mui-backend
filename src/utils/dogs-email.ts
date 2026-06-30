import nodemailer from 'nodemailer';

// ----------------------------------------------------------------------
// Client-facing email for the dogs-teacher booking flow. Reuses the Gmail
// SMTP pattern from src/utils/email.ts, but is built lazily and guarded so it
// is always a safe no-op when email isn't configured or the client gave no
// address. Callers fire these non-blocking (.catch) — a send failure must
// never break the API response.

interface DogsEmailClient {
  name: string;
  email: string | null;
}

interface DogsEmailRequest {
  status: string;
  dog: string;
  slot: { startsAt: string };
  client: { accessToken: string };
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

function formatTime(startsAt: string) {
  return new Date(startsAt).toLocaleString('ru-RU');
}

const STATUS_TEXT: Record<string, string> = {
  confirmed: 'Ваша заявка подтверждена. Ждём вас на занятии!',
  declined: 'К сожалению, заявку пришлось отклонить. Напишите нам — подберём другое время.',
  cancelled: 'Ваша заявка отменена.',
  pending: 'Статус заявки обновлён: ожидает подтверждения.',
};

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

async function send(to: string, subject: string, html: string) {
  await getTransport().sendMail({
    from: { name: 'DOG-CITY · Запись на занятие', address: process.env.EMAIL_USER as string },
    to,
    subject,
    html,
  });
}

function shouldSend(client: DogsEmailClient): client is DogsEmailClient & { email: string } {
  return hasEmailCredentials() && Boolean(client.email);
}

export async function sendDogsRequestReceived(client: DogsEmailClient, request: DogsEmailRequest) {
  if (!shouldSend(client)) {
    return;
  }

  const html = `
    <h2>Заявка принята</h2>
    <p>Здравствуйте, ${escapeHtml(client.name)}! Мы получили вашу заявку на занятие${
      request.dog ? ` (собака: ${escapeHtml(request.dog)})` : ''
    }.</p>
    <p><strong>Время:</strong> ${formatTime(request.slot.startsAt)}</p>
    <p>Мы свяжемся с вами для подтверждения. Статус заявки всегда виден в личном кабинете:</p>
    <p><a href="${cabinetLink(request.client.accessToken)}">Мои заявки</a></p>
  `;

  await send(client.email, 'Заявка на занятие принята', html);
}

export async function sendDogsStatusChanged(client: DogsEmailClient, request: DogsEmailRequest) {
  if (!shouldSend(client)) {
    return;
  }

  const statusLine = STATUS_TEXT[request.status] ?? STATUS_TEXT.pending;
  const html = `
    <h2>Статус заявки изменился</h2>
    <p>Здравствуйте, ${escapeHtml(client.name)}! ${statusLine}</p>
    <p><strong>Время:</strong> ${formatTime(request.slot.startsAt)}</p>
    <p>Подробности — в личном кабинете:</p>
    <p><a href="${cabinetLink(request.client.accessToken)}">Мои заявки</a></p>
  `;

  await send(client.email, 'Обновление по заявке на занятие', html);
}
