// @ts-ignore
import type { SignInBody } from '@/src/schemas/auth';

import bcrypt from 'bcrypt';
import User from '@/src/models/User';
import { signToken } from '@/src/lib/jwt';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';
import { toPublicUser } from '@/src/utils/public-user';

// Business logic for authentication. No HTTP here — throws AppError on
// failure; the route maps it via sendError().

async function signIn({ email, password }: SignInBody) {
  const user = await User.findOne({ email: email.trim() });
  if (!user) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.WRONG_CREDENTIALS);
  }
  if (!user.passwordHash) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.NO_PASSWORD_SET);
  }
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError(HTTP.BAD_REQUEST, MSG.WRONG_CREDENTIALS);
  }
  if (!user.isEmailVerified) {
    throw new AppError(HTTP.FORBIDDEN, MSG.EMAIL_NOT_VERIFIED, { requiresVerification: true });
  }

  const accessToken = signToken({ userId: user._id, role: user.role ?? 'user' });
  return { accessToken, user: toPublicUser(user) };
}

export const authService = { signIn };
