// src/pages/api/auth/me.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { verify } from 'jsonwebtoken';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';
import cors from '../../../utils/cors';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  try {
    await dbConnect();
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ message: 'Authorization token missing' });
    }
    const token = authorization.split(' ')[1];
    const decoded: any = verify(token, JWT_SECRET);
    const userId = decoded.userId;
    // Исключаем поле passwordHash из возвращаемых данных
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
      return res.status(401).json({ message: 'Invalid authorization token' });
    }
    return res.status(200).json({ user });
  } catch (error: any) {
    console.error('[Me API]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
