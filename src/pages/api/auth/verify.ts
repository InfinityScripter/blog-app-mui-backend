import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { normalizeEmail } from '@/src/utils/normalize-email';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();

    const { email, code } = req.body;

    if (!email || !code) {
      return res
        .status(HTTP.BAD_REQUEST)
        .json({ message: 'Email and verification code are required' });
    }

    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'User not found with this email' });
    }

    if (user.isEmailVerified) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Email is already verified' });
    }

    if (user.emailVerificationCode !== String(code).trim()) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid verification code' });
    }

    if (user.emailVerificationExpires && new Date() > user.emailVerificationExpires) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Verification code has expired' });
    }

    user.isEmailVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Actor is the verifying user (anonymous request has no req.user).
    emitAudit(req, {
      actorId: user._id,
      actorRole: user.role ?? 'user',
      action: 'auth.email_verified',
      targetType: 'user',
      targetId: user._id,
    });

    return res.status(HTTP.OK).json({ message: 'Email successfully verified', success: true });
  } catch (error: any) {
    console.error('[Verify Email API]', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}
