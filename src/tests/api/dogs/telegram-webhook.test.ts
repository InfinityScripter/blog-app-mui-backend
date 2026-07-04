import '@jest/globals';
import { AppError } from '@/src/types/api';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

jest.mock('@/src/services/dogs-telegram', () => ({
  handleDogsTelegramUpdate: jest.fn(),
}));

// eslint-disable-next-line import/first, import/order
import webhookHandler from '@/src/pages/api/dogs/telegram/webhook';
// eslint-disable-next-line import/first, import/order
import { handleDogsTelegramUpdate } from '@/src/services/dogs-telegram';

const handleUpdateMock = handleDogsTelegramUpdate as jest.Mock;

function postUpdate() {
  return createMocks({
    method: HTTP_METHOD.POST,
    body: { message: { text: '/start abc', chat: { id: 1 } } },
  });
}

describe('Dogs telegram webhook API', () => {
  beforeEach(() => {
    handleUpdateMock.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('responds 200 when the update is processed', async () => {
    handleUpdateMock.mockResolvedValue(undefined);

    const { req, res } = postUpdate();
    await webhookHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(handleUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('responds 200 on a handled business error so Telegram stops retrying', async () => {
    handleUpdateMock.mockRejectedValue(new AppError(HTTP.NOT_FOUND, 'Client not found'));

    const { req, res } = postUpdate();
    await webhookHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
  });

  it('responds 500 on an unexpected failure so Telegram retries it', async () => {
    handleUpdateMock.mockRejectedValue(new Error('duplicate key value violates unique constraint'));

    const { req, res } = postUpdate();
    await webhookHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.INTERNAL);
  });

  it('keeps a 5xx AppError as-is (transient failure, Telegram should retry)', async () => {
    handleUpdateMock.mockRejectedValue(
      new AppError(HTTP.SERVICE_UNAVAILABLE, 'Telegram API request failed')
    );

    const { req, res } = postUpdate();
    await webhookHandler(req, res);

    expect(res._getStatusCode()).toBe(HTTP.SERVICE_UNAVAILABLE);
  });
});
