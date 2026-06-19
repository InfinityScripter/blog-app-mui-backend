import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { HTTP } from '@/src/constants/http';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { chatService } from '@/src/services/chat';

// Thin route: requireAuth → chatService → respond. Keeps { channels }/{ channel }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  try {
    if (req.method === 'GET') {
      const channels = await chatService.listChannels(userId);
      return res.status(HTTP.OK).json({ channels });
    }

    if (req.method === 'POST') {
      const { type, name, memberIds } = req.body ?? {};
      const { id, existing } = await chatService.createChannel({ userId, type, name, memberIds });
      // existing direct channel → 200; freshly created → 201
      return res.status(existing ? HTTP.OK : HTTP.CREATED).json({ channel: { id } });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
