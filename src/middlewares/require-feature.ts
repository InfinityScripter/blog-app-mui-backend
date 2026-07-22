import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

// Gates a route behind a boolean feature flag: when `enabled` is false the
// wrapped handler never runs and the endpoint answers 404 — as if the route did
// not exist (chosen over 403 so a disabled capability leaks nothing). Composes
// like the other route middlewares: requireFeature(flag)(handler).
//
// Used to switch off personal-data collection (registration, OAuth sign-up,
// newsletter subscribe) without deleting the code: flip PD_COLLECTION_ENABLED.

interface RequireFeatureOptions {
  /**
   * Force the gate to honour `enabled` even under NODE_ENV==='test'. Off by
   * default so the existing suite (which drives the collection flow) is not
   * blocked when the flag defaults off; the gate's own test flips it on.
   */
  enabledInTest?: boolean;
}

export function requireFeature(enabled: boolean, opts: RequireFeatureOptions = {}) {
  const { enabledInTest = false } = opts;

  return (handler: NextApiHandler) => (req: NextApiRequest, res: NextApiResponse) => {
    if (process.env.NODE_ENV === 'test' && !enabledInTest) {
      return handler(req, res);
    }

    if (!enabled) {
      return res.status(HTTP.NOT_FOUND).json({ success: false, message: MSG.NOT_FOUND });
    }

    return handler(req, res);
  };
}
