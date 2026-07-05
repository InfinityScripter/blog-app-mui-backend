// @ts-ignore
import type { SignInBody } from '@/src/schemas/auth';

import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { issueSession } from '@/src/services/session';
import { toPublicUser } from '@/src/utils/public-user';
import { MAX_FAILED_ATTEMPTS } from '@/src/constants/auth';

// Business logic for authentication. No HTTP here — throws AppError on
// failure; the route maps it via sendError().

async function signIn({ email, password }: SignInBody, userAgent?: string | null) {
  // email is already trimmed + lowercased by signInSchema; findOne also
  // compares case-insensitively.
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.WRONG_CREDENTIALS);
  }
  if (user.isLocked) {
    throw new AppError(HTTP.FORBIDDEN, MSG.ACCOUNT_LOCKED);
  }
  if (!user.passwordHash) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.WRONG_CREDENTIALS);
  }
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.isLocked = true;
    }
    await user.save();
    throw new AppError(HTTP.BAD_REQUEST, MSG.WRONG_CREDENTIALS);
  }
  if (!user.isEmailVerified) {
    throw new AppError(HTTP.FORBIDDEN, MSG.EMAIL_NOT_VERIFIED, { requiresVerification: true });
  }

  // Successful sign-in resets the failed-attempt counter.
  if ((user.failedLoginAttempts ?? 0) > 0) {
    user.failedLoginAttempts = 0;
    await user.save();
  }

  const session = await issueSession({
    userId: user._id,
    role: user.role ?? 'user',
    userAgent,
  });
  return { ...session, user: toPublicUser(user) };
}

export const authService = { signIn };
