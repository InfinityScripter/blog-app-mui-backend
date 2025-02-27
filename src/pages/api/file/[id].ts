import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ message: 'Invalid file id' });
    }

    const file = await File.findById(id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${file.originalname}"`);

    // Send the file data
    res.send(file.data);
  } catch (error: any) {
    console.error('[File API]:', error);
    return res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}
