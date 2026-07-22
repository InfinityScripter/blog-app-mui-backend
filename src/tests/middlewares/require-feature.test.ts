import '@jest/globals';
import { dbQuery } from '@/src/lib/db';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { settingsService } from '@/src/services/settings';
import { requireFeature } from '@/src/middlewares/require-feature';

// requireFeature(flagKey) gates a route on the runtime flag stored in
// app_settings: when the flag is off the wrapped handler never runs and the
// endpoint answers 404, as if it did not exist. When on, the handler runs
// untouched. The enabledInTest escape mirrors withRateLimit so the flag can be
// exercised deterministically under jest (routes omit it, so the suite drives
// the collection flow regardless of the flag's value).

describe('requireFeature middleware', () => {
  const okHandler = jest.fn((_req, res) => res.status(HTTP.OK).json({ ran: true }));

  beforeEach(async () => {
    jest.clearAllMocks();
    await dbQuery('DELETE FROM app_settings');
    settingsService.__resetCacheForTests();
  });

  it('runs the handler when the flag is enabled', async () => {
    await settingsService.setFlag('pdCollection', true);
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature('pdCollection', { enabledInTest: true })(okHandler)(req, res);

    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(HTTP.OK);
  });

  it('returns a 404 JSON envelope and skips the handler when the flag is disabled', async () => {
    await settingsService.setFlag('pdCollection', false);
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature('pdCollection', { enabledInTest: true })(okHandler)(req, res);

    expect(okHandler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(HTTP.NOT_FOUND);
    // Shape matches the other guards: { success:false, message }. No data leaks
    // about the gated capability.
    expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'Not found' });
  });

  it('fails closed with a 404 (never runs the handler) when the flag read throws', async () => {
    // DB outage: getFlag rejects. The gate must answer 404 exactly like a
    // disabled flag — the handler must NOT run (else it would collect PD with
    // the flag unknown) — and log so the outage is distinguishable from off.
    const getFlag = jest
      .spyOn(settingsService, 'getFlag')
      .mockRejectedValueOnce(new Error('db down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature('pdCollection', { enabledInTest: true })(okHandler)(req, res);

    expect(okHandler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(HTTP.NOT_FOUND);
    expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'Not found' });
    expect(consoleError).toHaveBeenCalled();

    getFlag.mockRestore();
    consoleError.mockRestore();
  });

  it('runs the handler under NODE_ENV=test even when disabled, unless enabledInTest', async () => {
    // Guard defaults to off-in-test so the existing suite (which drives the
    // collection flow) is not blocked by a disabled flag and stays DB-independent.
    await settingsService.setFlag('pdCollection', false);
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature('pdCollection')(okHandler)(req, res);

    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(HTTP.OK);
  });
});
