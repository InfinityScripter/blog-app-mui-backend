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

// eslint-disable-next-line import/first
import { sendDogsStatusChanged, sendDogsRequestReceived } from '@/src/utils/dogs-email';

type EmailClient = { name: string; email: string | null };
type EmailRequest = {
  id: string;
  status: string;
  dog: string;
  slot: { startsAt: string };
  client: { accessToken: string };
};

const client = (email: string | null): EmailClient => ({ name: 'Анна', email });
const request = (status = 'pending'): EmailRequest => ({
  id: 'req_123',
  status,
  dog: 'Бим',
  slot: { startsAt: '2027-04-10T09:00:00.000Z' },
  client: { accessToken: 'tok_123' },
});

describe('dogs-email', () => {
  const originalUser = process.env.EMAIL_USER;

  beforeEach(() => {
    sendMailMock.mockClear();
    process.env.EMAIL_USER = 'owner@example.com';
  });

  afterEach(() => {
    process.env.EMAIL_USER = originalUser;
  });

  it('sends a "request received" email when the client has an email', async () => {
    await sendDogsRequestReceived(client('anna@example.com'), request());
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe('anna@example.com');
  });

  it('sends a "status changed" email when the client has an email', async () => {
    await sendDogsStatusChanged(client('anna@example.com'), request('confirmed'));
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].to).toBe('anna@example.com');
  });

  it('confirmed email carries both Google and Apple (.ics) calendar links', async () => {
    await sendDogsStatusChanged(client('anna@example.com'), request('confirmed'));
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).toContain('calendar.google.com/calendar/render');
    expect(html).toContain('/api/calendar/tok_123/req_123');
  });

  it('pending email has no calendar links (nothing confirmed yet)', async () => {
    await sendDogsStatusChanged(client('anna@example.com'), request('pending'));
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('calendar.google.com');
    expect(html).not.toContain('/api/calendar/');
  });

  it('does not send when the client has no email', async () => {
    await sendDogsRequestReceived(client(null), request());
    await sendDogsStatusChanged(client(null), request('confirmed'));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('does not send when EMAIL_USER is unset', async () => {
    delete process.env.EMAIL_USER;
    await sendDogsRequestReceived(client('anna@example.com'), request());
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('escapes HTML in the client name to prevent injection', async () => {
    await sendDogsRequestReceived(
      { name: '<img src=x onerror=alert(1)>', email: 'anna@example.com' },
      request()
    );
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes HTML in the dog field to prevent injection', async () => {
    await sendDogsRequestReceived(client('anna@example.com'), {
      ...request(),
      dog: '<script>alert(1)</script>',
    });
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
