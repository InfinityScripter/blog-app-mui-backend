import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { type FlagKey, settingsService } from '@/src/services/settings';

// Gates a route behind a runtime feature flag read from app_settings (via
// settingsService, which caches). When the flag is off the wrapped handler never
// runs and the endpoint answers 404 — as if the route did not exist (chosen over
// 403 so a disabled capability leaks nothing). Composes like the other route
// middlewares: requireFeature(flagKey)(handler), applied as the outermost wrapper.
//
// Used to switch off personal-data collection (registration, OAuth sign-up,
// newsletter subscribe) without deleting the code: an admin flips the flag in the
// dashboard and it takes effect without a redeploy.

interface RequireFeatureOptions {
  /**
   * Force the gate to honour the flag even under NODE_ENV==='test'. Off by
   * default so the existing suite (which drives the collection flow) is not
   * blocked and does not depend on the DB flag; the gate's own test flips it on.
   */
  enabledInTest?: boolean;
}

export function requireFeature(flagKey: FlagKey, opts: RequireFeatureOptions = {}) {
  const { enabledInTest = false } = opts;

  return (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    if (process.env.NODE_ENV === 'test' && !enabledInTest) {
      return handler(req, res);
    }

    // Fail CLOSED and loud: a DB read error here must not fall through to the
    // handler (that would collect personal data with the flag unknown), and it
    // must be distinguishable in the logs from a deliberate flag-off — both
    // otherwise answer 404.
    let enabled: boolean;
    try {
      enabled = await settingsService.getFlag(flagKey);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[requireFeature] flag read failed for "${flagKey}", failing closed`, error);
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: MSG.NOT_FOUND });
    }
    if (!enabled) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: MSG.NOT_FOUND });
    }

    return handler(req, res);
  };
}
