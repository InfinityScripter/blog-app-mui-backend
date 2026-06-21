import '@jest/globals';
import { createServer } from 'node:net';
import { isAppError } from '@/src/types/api';
import { botControlService } from '@/src/services/bot-control';

/**
 * Returns a URL on a port that was bound then immediately closed, so a fetch to
 * it gets a genuine ECONNREFUSED (undici exposes it as error.cause.code). Ports
 * 1/9 are rejected by undici as "bad port" before any connect, so they do NOT
 * exercise the refusal path — a real closed ephemeral port is required.
 */
async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

/** Runs a thunk and returns the thrown error (fails if it does not throw). */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it resolved');
}

describe('botControlService', () => {
  const OLD = process.env;
  beforeEach(async () => {
    process.env = {
      ...OLD,
      BOT_CONTROL_URL: await closedPortUrl(),
      BOT_CONTROL_TOKEN: 'x'.repeat(16),
    };
  });
  afterEach(() => {
    process.env = OLD;
  });

  it('getStatus returns isAlive:false when the bot is unreachable', async () => {
    const status = await botControlService.getStatus();
    expect(status.isAlive).toBe(false);
  });

  it('listProviders throws AppError(503) when the bot is unreachable', async () => {
    const error = await captureThrow(() => botControlService.listProviders());
    expect(isAppError(error)).toBe(true);
    expect(isAppError(error) && error.status).toBe(503);
  });

  it('setModel throws AppError(503) when the bot is unreachable', async () => {
    const error = await captureThrow(() => botControlService.setModel('glm', 'glm-4.7-flash'));
    expect(isAppError(error) && error.status).toBe(503);
  });

  it('throws AppError(503) when env is unconfigured (no URL)', async () => {
    delete process.env.BOT_CONTROL_URL;
    const error = await captureThrow(() => botControlService.listProviders());
    expect(isAppError(error) && error.status).toBe(503);
  });
});
