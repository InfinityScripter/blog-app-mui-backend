import type { NextApiRequest, NextApiResponse } from 'next';

import bcrypt from 'bcrypt';
import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { SALT_ROUNDS } from '@/src/constants/auth';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { normalizeEmail } from '@/src/utils/normalize-email';

// Completes the reset-by-code flow: reset-password.ts emails the code, this
// route exchanges a valid code for a new password. Codes/emails are never
// logged — a reset code in the logs is a account-takeover primitive.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res.status(HTTP.BAD_REQUEST).json({
        message: 'Email, verification code, and new password are required',
      });
    }

    const user = await User.findOne({
      // Normalize like the other email entry points (reset-password.ts,
      // verify.ts). The lookup is already case-insensitive at the model layer
      // (LOWER(email)=LOWER($n)); this just keeps every route consistent.
      email: normalizeEmail(email),
      passwordResetCode: code,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid or expired reset code' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Обновляем пароль и очищаем код сброса
    user.passwordHash = passwordHash;
    // @ts-ignore
    user.passwordResetCode = null;
    // @ts-ignore
    user.passwordResetExpires = null;
    // Сброс пароля — единственный путь разблокировки: MSG.ACCOUNT_LOCKED велит
    // пользователю сбросить пароль, а lock-гейт в signIn отрабатывает раньше
    // успешного входа (который единственный обнуляет счётчик). Не снимая флаг
    // здесь, аккаунт остаётся заблокирован навсегда.
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    await user.save();

    // Emitted here (not in reset-password.ts, which only sends the code) because
    // this is where the password is actually changed. Actor is the user.
    emitAudit(req, {
      actorId: user._id,
      actorRole: user.role ?? 'user',
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: user._id,
    });

    return res.status(HTTP.OK).json({ message: 'Password has been updated successfully' });
  } catch (error) {
    console.error('[Update Password API Error]:', error);
    return res.status(HTTP.INTERNAL).json({
      message: 'Failed to update password. Please try again later.',
    });
  }
}

// Rate-limited: without a cap, the 6-digit code (900k space, 1h window) is
// brute-forceable against a known victim email → account takeover.
export default withRateLimit({
  routeName: 'auth.update-password',
  windowMs: 60_000,
  max: 10,
})(handler);
