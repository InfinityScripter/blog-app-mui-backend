import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { randomInt } from 'node:crypto';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { sendVerificationEmail } from '@/src/utils/email';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { normalizeEmail } from '@/src/utils/normalize-email';

// Neutral response used whether or not the account exists / is already verified,
// so this endpoint can't be used to enumerate registered emails.
const NEUTRAL_MESSAGE = 'If an unverified account exists for this email, a code has been sent.';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { email } = req.body;

    if (!email) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Email is required' });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });

    // Anti-enumeration: same neutral 200 for missing / already-verified accounts.
    if (!user || user.isEmailVerified) {
      return res.status(HTTP.OK).json({ message: NEUTRAL_MESSAGE });
    }

    // 6-значный код из CSPRNG (Math.random предсказуем), 24ч срок действия.
    user.emailVerificationCode = randomInt(100000, 1000000).toString();
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Send after persisting; fire-and-forget so a slow SMTP can't turn the
    // uniform response into a timing oracle for whether the account existed.
    sendVerificationEmail(normalizedEmail, user.emailVerificationCode).catch((err) => {
      console.error('[Resend Verification API] send failed', err);
    });

    return res.status(HTTP.OK).json({ message: NEUTRAL_MESSAGE });
  } catch (error) {
    // Never leak error.message to the client.
    console.error('[Resend Verification API]', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}

// Tight cap: a new code + an email per hit → brute-force / email-bomb vector.
export default withRateLimit({
  routeName: 'auth.resend-verification',
  windowMs: 60_000,
  max: 3,
})(handler);
