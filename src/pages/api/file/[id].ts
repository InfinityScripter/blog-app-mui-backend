import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid file id' });
    }

    const file = await File.findById(id);
    if (!file) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'File not found' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalname}"`);

    // Send the file data
    res.send(file.data);
  } catch (error: any) {
    console.error('[File API]:', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL, error: error.message });
  }
}
