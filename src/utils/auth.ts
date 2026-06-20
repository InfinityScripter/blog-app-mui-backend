import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import uuidv4 from '@/src/utils/uuidv4';
import { verifyToken } from '@/src/lib/jwt';

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
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const token = authHeader.split(' ')[1];

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
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  };
