import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import listHandler from '@/src/pages/api/post/list';
import latestHandler from '@/src/pages/api/post/latest';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import detailsHandler from '@/src/pages/api/post/details';

// The read routes' query boundary: malformed shapes are a 400, wrong verbs a
// 405, and unknown keys (utm tails) are stripped rather than rejected.
describe('post read routes: query validation', () => {
  function call(handler: unknown, method: string, query: Record<string, unknown>) {
    const { req, res } = createMocks({ method: method as never, query });
    // withMethods returns synchronously on a 405, so normalize to a promise.
    const result = (handler as (rq: unknown, rs: unknown) => unknown)(req, res);
    return Promise.resolve(result).then(() => res);
  }

  it('list: non-digit page is a 400', async () => {
    const res = await call(listHandler, HTTP_METHOD.GET, { page: 'abc' });
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('list: duplicated param (?tag=a&tag=b arrives as array) is a 400', async () => {
    const res = await call(listHandler, HTTP_METHOD.GET, { tag: ['a', 'b'] });
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('list: utm tracking tails are stripped, not rejected', async () => {
    const res = await call(listHandler, HTTP_METHOD.GET, {
      utm_source: 'newsletter',
      utm_campaign: 'aug',
    });
    expect(res._getStatusCode()).toBe(HTTP.OK);
  });

  it('list: POST is a 405', async () => {
    const res = await call(listHandler, HTTP_METHOD.POST, {});
    expect(res._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });

  it('latest: missing title is a 400', async () => {
    const res = await call(latestHandler, HTTP_METHOD.GET, {});
    expect(res._getStatusCode()).toBe(HTTP.BAD_REQUEST);
  });

  it('details: missing id is a 400, wrong verb a 405', async () => {
    const missing = await call(detailsHandler, HTTP_METHOD.GET, {});
    expect(missing._getStatusCode()).toBe(HTTP.BAD_REQUEST);
    const wrongVerb = await call(detailsHandler, HTTP_METHOD.POST, { id: 'x' });
    expect(wrongVerb._getStatusCode()).toBe(HTTP.METHOD_NOT_ALLOWED);
  });
});
