import type { NextApiRequest, NextApiResponse } from 'next';

// @ts-ignore
import nodemailer from 'nodemailer';
import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { randomInt } from 'node:crypto';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { withRateLimit } from '@/src/middlewares/rate-limit';
import { normalizeEmail } from '@/src/utils/normalize-email';

const NEUTRAL_RESET_MESSAGE =
  'If an account exists for that email, a password reset code has been sent.';

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

    const user = await User.findOne({ email: normalizeEmail(email) });
    if (!user) {
      // Anti-enumeration: respond the same whether or not the account exists.
      return res.status(HTTP.OK).json({ message: NEUTRAL_RESET_MESSAGE });
    }

    // 6-значный код из CSPRNG — Math.random() предсказуем и при переборе
    // (код + email) даёт примитив захвата аккаунта.
    const resetCode = randomInt(100000, 1000000).toString();
    const resetExpires = new Date(Date.now() + 3600000); // 1 час

    // Сохраняем код и время истечения
    user.passwordResetCode = resetCode;
    user.passwordResetExpires = resetExpires;
    await user.save();

    // Формируем ссылку для сброса пароля
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:7272';
    const resetLink = `${frontendUrl}/auth/update-password?email=${encodeURIComponent(email)}&code=${resetCode}`;

    // Настраиваем nodemailer
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Code',
      text: `Your password reset code is: ${resetCode}

Click the following link to reset your password:
${resetLink}

This link and code will expire in 1 hour.

If you did not request this code, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset</h2>
          <p>Your password reset code is:</p>
          <div style="background-color: #f4f4f4; padding: 15px; margin: 20px 0; font-size: 24px; text-align: center; letter-spacing: 5px;">
            ${resetCode}
          </div>
          <p>Click the following button to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #007bff;">
            ${resetLink}
          </p>
          <p>This link and code will expire in 1 hour.</p>
          <p style="color: #666; font-size: 14px;">If you did not request this code, please ignore this email.</p>
        </div>
      `,
    };

    // Fire-and-forget: awaiting sendMail makes the account-exists path
    // measurably slower than the neutral not-found path (a timing oracle that
    // defeats the anti-enumeration message), and lets an attacker hold the
    // connection open to amplify an email bomb. Respond immediately; log a
    // send failure server-side.
    transporter.sendMail(mailOptions).catch((error: unknown) => {
      console.error('[Reset Password API] sendMail failed:', error);
    });

    res.status(HTTP.OK).json({ message: NEUTRAL_RESET_MESSAGE });
  } catch (error) {
    console.error('[Reset Password API Error]:', error);
    res.status(HTTP.INTERNAL).json({
      message: 'Failed to send reset code. Please try again later.',
    });
  }
}

// Rate-limited: the reset endpoint triggers a DB write + email for any address,
// so an unlimited caller can email-bomb a victim and probe the timing oracle.
export default withRateLimit({
  routeName: 'auth.reset-password',
  windowMs: 60_000,
  max: 5,
})(handler);
