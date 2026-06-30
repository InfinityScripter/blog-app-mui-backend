import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { requireAuth } from '@/src/utils/auth';
import { sendError } from '@/src/utils/response';
import { chatService } from '@/src/services/chat';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Thin route: requireAuth → chatService → respond. Keeps { messages }/{ message }.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const { channelId } = req.query as { channelId: string };

  try {
    if (req.method === HTTP_METHOD.GET) {
      const { before, limit } = req.query as { before?: string; limit?: string };
      const messages = await chatService.listMessages({
        channelId,
        userId,
        before,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return res.status(HTTP.OK).json({ messages });
    }

    if (req.method === HTTP_METHOD.POST) {
      const message = await chatService.sendMessage({
        channelId,
        userId,
        body: req.body?.body,
      });
      return res.status(HTTP.CREATED).json({ message });
    }

    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: 'Method not allowed' });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(handler);
