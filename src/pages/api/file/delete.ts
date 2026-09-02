import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { MSG } from '@/src/constants/messages';
import { sendError } from '@/src/utils/response';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.DELETE) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();

    const userId = req.user!._id;
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid file id' });
    }

    // Find the file
    const file = await File.findById(id);
    if (!file) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'File not found' });
    }

    // Check if the user has permission to delete this file
    if (file.userId !== userId) {
      return res.status(HTTP.FORBIDDEN).json({ message: 'Нет доступа к удалению данного файла' });
    }

    // Delete the file
    await File.findByIdAndDelete(id);

    return res.status(HTTP.OK).json({ message: 'File deleted successfully' });
  } catch (error) {
    // sendError logs and returns a neutral 500 — the raw error.message used to
    // be sent to the client, which leaks internals (paths, SQL) to any caller.
    return sendError(res, error);
  }
}

export default requireAuth(handler);
