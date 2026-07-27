import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import passport from '@/src/lib/passport';
import { sendError } from '@/src/utils/response';
import { HTTP_METHOD } from '@/src/constants/http';
import { issueOAuthState } from '@/src/lib/oauth-state';
import { withMethods } from '@/src/middlewares/with-methods';
import { requireFeature } from '@/src/middlewares/require-feature';

// Starts the Google flow: pin a fresh state in an HttpOnly cookie scoped to the
// callback path, then let passport redirect to Google's consent screen carrying
// that same state. The callback accepts only a state matching the cookie, which is
// what stops a forged callback from signing anyone in.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();

    const state = issueOAuthState(req, res, 'google');

    // passport ends the response itself (302 to Google), so there is nothing to
    // await here: given a string state it builds the authorize URL synchronously.
    // `next` is reached only if the strategy errors before redirecting — answer
    // 500 there rather than leave the request hanging.
    passport.authenticate('google', { scope: ['profile', 'email'], state })(
      req,
      res,
      (error: unknown) => sendError(res, error ?? new Error('google strategy did not redirect'))
    );
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireFeature('pdCollection')(withMethods([HTTP_METHOD.GET])(handler));
