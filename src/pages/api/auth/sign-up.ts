import type { IUser } from '@/src/models/User';
import type { NextApiRequest, NextApiResponse } from 'next';

import bcrypt from 'bcrypt';
import dbConnect from '@/src/lib/db';
import User from '@/src/models/User';
import { MSG } from '@/src/constants/messages';
import { signUpSchema } from '@/src/schemas/auth';
import { SALT_ROUNDS } from '@/src/constants/auth';
import { emitAudit } from '@/src/utils/audit-context';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { sendVerificationEmail } from '@/src/utils/email';
import { withRateLimit } from '@/src/middlewares/rate-limit';

const hasEmailCredentials = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

// Генерация 6-значного кода
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }
  try {
    await dbConnect();
    if (!hasEmailCredentials) {
      return res.status(HTTP.SERVICE_UNAVAILABLE).json({ message: MSG.EMAIL_SERVICE_UNAVAILABLE });
    }

    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path.join('.');
      return res.status(HTTP.BAD_REQUEST).json({
        success: false,
        message: first ? `${path ? `${path}: ` : ''}${first.message}` : 'Missing required fields',
      });
    }
    // email is already trimmed + lowercased by signUpSchema.
    const { email, password, firstName, lastName } = parsed.data;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // Neutral message — do not confirm whether an account exists (anti-enumeration).
      return res.status(HTTP.CREATED).json({ message: MSG.SIGN_UP_SUCCESS });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newUser: Partial<IUser> = {
      name: `${firstName} ${lastName}`,
      email,
      passwordHash,
      isEmailVerified: false,
      emailVerificationCode: verificationCode ?? undefined,
      emailVerificationExpires: verificationExpires ?? undefined,
    };
    const createdUser = await User.create(newUser);

    await sendVerificationEmail(email, verificationCode);

    // Actor is the just-created user (anonymous request has no req.user).
    emitAudit(req, {
      actorId: createdUser._id,
      actorRole: createdUser.role ?? 'user',
      action: 'auth.signup',
      targetType: 'user',
      targetId: createdUser._id,
      metadata: { method: 'password' },
    });

    return res.status(HTTP.CREATED).json({
      message: MSG.SIGN_UP_SUCCESS,
      user: {
        id: createdUser._id,
        email: createdUser.email,
        name: createdUser.name,
        isEmailVerified: createdUser.isEmailVerified,
      },
    });
  } catch (error: any) {
    console.error('[Sign Up API]', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}

// ~3/min per IP — registration is rare; a tight cap blocks signup-spam.
export default withRateLimit({ routeName: 'auth.sign-up', windowMs: 60_000, max: 3 })(handler);
