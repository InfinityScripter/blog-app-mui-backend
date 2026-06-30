import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { requireAuth } from '@/src/utils/auth';
import { HTTP_METHOD } from '@/src/constants/http';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.DELETE) {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();

    const userId = req.user!._id;
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid file id' });
    }

    // Find the file
    const file = await File.findById(id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if the user has permission to delete this file
    if (file.userId !== userId) {
      return res.status(403).json({ message: 'Нет доступа к удалению данного файла' });
    }

    // Delete the file
    await File.findByIdAndDelete(id);

    return res.status(200).json({ message: 'File deleted successfully' });
  } catch (error: any) {
    console.error('[File Delete API]:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

export default requireAuth(handler);
