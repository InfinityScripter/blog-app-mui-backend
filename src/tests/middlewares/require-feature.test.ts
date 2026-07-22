import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireFeature } from '@/src/middlewares/require-feature';

// requireFeature(enabled) gates a route: when the feature flag is off the
// wrapped handler never runs and the endpoint answers 404, as if it did not
// exist. When on, the handler runs untouched. The enabledInTest escape mirrors
// withRateLimit so the flag can be exercised deterministically under jest.

describe('requireFeature middleware', () => {
  const okHandler = jest.fn((_req, res) => res.status(HTTP.OK).json({ ran: true }));

  beforeEach(() => jest.clearAllMocks());

  it('runs the handler when the feature is enabled', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature(true, { enabledInTest: true })(okHandler)(req, res);

    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(HTTP.OK);
  });

  it('returns a 404 JSON envelope and skips the handler when disabled', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature(false, { enabledInTest: true })(okHandler)(req, res);

    expect(okHandler).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(HTTP.NOT_FOUND);
    // Shape matches the other guards: { success:false, message }. No data leaks
    // about the gated capability.
    expect(JSON.parse(res._getData())).toEqual({ success: false, message: 'Not found' });
  });

  it('runs the handler under NODE_ENV=test even when disabled, unless enabledInTest', async () => {
    // Guard defaults to off-in-test so the existing suite (which drives the
    // collection flow) is not blocked by a disabled flag.
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });

    await requireFeature(false)(okHandler)(req, res);

    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(HTTP.OK);
  });
});
