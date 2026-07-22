import type { NextApiRequest, NextApiResponse } from 'next';

import { z } from 'zod';
import dbConnect from '@/src/lib/db';
import { sendError } from '@/src/utils/response';
import { setAuthCookies } from '@/src/lib/cookies';
import { issueSession } from '@/src/services/session';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { validateBody } from '@/src/middlewares/validate';
import { withMethods } from '@/src/middlewares/with-methods';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { PERSONAL_DATA_CONSENT_VERSION } from '@/src/constants/privacy';
import {
  completeOAuthConsentChallenge,
  finalizeOAuthConsentChallenge,
} from '@/src/services/oauth-consent';

const oauthConsentSchema = z.object({
  token: z.string().min(32).max(2000),
  personalDataConsent: z.literal(true),
  personalDataConsentVersion: z.literal(PERSONAL_DATA_CONSENT_VERSION),
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { user, claimId } = await completeOAuthConsentChallenge(req.body.token);
    const session = await issueSession({
      userId: user._id,
      role: user.role ?? 'user',
      userAgent: req.headers['user-agent'] ?? null,
    });
    await finalizeOAuthConsentChallenge(req.body.token, claimId);
    setAuthCookies(req, res, session);
    emitAudit(req, {
      actorId: user._id,
      actorRole: user.role ?? 'user',
      action: 'auth.oauth.consent.completed',
      targetType: 'user',
      targetId: user._id,
      metadata: { personalDataConsentVersion: PERSONAL_DATA_CONSENT_VERSION },
    });
    return res.status(HTTP.OK).json({ success: true });
  } catch (error) {
    return sendError(res, error);
  }
}

export default withRateLimit({ routeName: 'auth.oauth-consent', windowMs: 60_000, max: 5 })(
  withMethods([HTTP_METHOD.POST])(validateBody(oauthConsentSchema)(handler))
);
