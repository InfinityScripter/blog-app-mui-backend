import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { verify } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await dbConnect();

    // Verify authentication
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ message: 'Отсутствует токен авторизации' });
    }
    const token = authorization.split(' ')[1];
    let decoded: any;
    try {
      decoded = verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Неверный токен авторизации' });
    }

    const userId = decoded.userId;
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
