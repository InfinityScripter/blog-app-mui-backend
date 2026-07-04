import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import crypto from 'crypto';
import User from '@/src/models/User';
import uuidv4 from '@/src/utils/uuidv4';
import { verifyToken } from '@/src/lib/jwt';
import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

/**
 * Constant-time equality for the bot service token. Length is compared first so
 * timingSafeEqual never throws on a length mismatch; the dummy compare keeps the
 * timing profile roughly uniform regardless of where the mismatch is.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Compare against self to spend comparable time, then fail.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Service-token auth path for the news bot (ai-bot-tg). When the bearer token
 * equals BOT_API_TOKEN, the request is authenticated as the owner's admin user
 * (resolved by OWNER_EMAIL) so the bot can publish posts authored by the owner.
 * Returns the resolved req.user, or null if this isn't a service-token request.
 * Throws a Response-terminating result by writing to `res` on misconfiguration
 * or a failed owner lookup.
 */
async function resolveBotUser(
  token: string,
  res: NextApiResponse
): Promise<{ _id: string; role: string } | null | 'handled'> {
  const botToken = process.env.BOT_API_TOKEN;
  if (!botToken || !tokensMatch(token, botToken)) {
    return null; // not a service-token request — fall through to JWT
  }

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    res.status(HTTP.INTERNAL).json({ success: false, message: 'OWNER_EMAIL is not configured' });
    return 'handled';
  }

  // Case-insensitive lookup — User.findOne matches on LOWER(email).
  const owner = await User.findOne({ email: ownerEmail });
  if (!owner || owner.role !== 'admin') {
    res
      .status(HTTP.UNAUTHORIZED)
      .json({ success: false, message: 'Bot owner not found or not an admin' });
    return 'handled';
  }

  return { _id: String(owner._id), role: 'admin' };
}

// Расширение типа для использования req.user
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      JWT_SECRET?: string;
    }
  }
}

// Добавляем user в NextApiRequest через declaration merging
declare module 'next' {
  interface NextApiRequest {
    user?: {
      _id: string;
      role: string;
      [key: string]: any;
    };
    /** Per-request correlation id, stashed by requireAuth for audit logging. */
    requestId?: string;
  }
}

/**
 * Middleware для проверки JWT-токена и аутентификации пользователя
 */
export const requireAuth =
  (handler: NextApiHandler) => async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Получаем токен из заголовка Authorization
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(HTTP.UNAUTHORIZED).json({ success: false, message: MSG.UNAUTHORIZED });
      }

      const token = authHeader.split(' ')[1];

      // Service-token path (news bot): authenticate as the owner's admin user.
      const botUser = await resolveBotUser(token, res);
      if (botUser === 'handled') {
        return undefined; // resolveBotUser already wrote the error response
      }
      if (botUser) {
        req.user = botUser;
        if (!req.requestId) {
          req.requestId = uuidv4();
        }
        return handler(req, res);
      }

      // Проверяем токен
      const decoded = verifyToken(token) as { userId: string; role: string };

      // Добавляем информацию о пользователе в объект запроса
      req.user = { _id: decoded.userId, role: decoded.role ?? 'user' };

      // Mint a per-request correlation id for audit logging (if not already set).
      if (!req.requestId) {
        req.requestId = uuidv4();
      }

      // Передаем управление следующему обработчику
      return handler(req, res);
    } catch (error) {
      return res
        .status(HTTP.UNAUTHORIZED)
        .json({ success: false, message: 'Invalid or expired token' });
    }
  };
