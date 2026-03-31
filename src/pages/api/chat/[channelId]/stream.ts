import type { NextApiRequest, NextApiResponse } from 'next';

import jwt from 'jsonwebtoken';

import { dbQuery } from '@/src/lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const token = req.query.token as string;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  let userId: string;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  const { channelId } = req.query as { channelId: string };

  const membership = await dbQuery(
    'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  if (!membership.rows.length) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastCreatedAt = new Date().toISOString();

  const interval = setInterval(async () => {
    try {
      const result = await dbQuery<{
        id: string;
        body: string;
        created_at: Date;
        sender_id: string;
        sender_name: string;
        sender_avatar: string | null;
      }>(
        `
        SELECT m.id, m.body, m.created_at, m.sender_id,
               u.name AS sender_name, u.avatar_url AS sender_avatar
        FROM chat_messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.channel_id = $1 AND m.created_at > $2
        ORDER BY m.created_at ASC
      `,
        [channelId, lastCreatedAt]
      );

      if (result.rows.length > 0) {
        lastCreatedAt = result.rows[result.rows.length - 1].created_at.toISOString();
        const messages = result.rows.map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          sender: { id: row.sender_id, name: row.sender_name, avatarURL: row.sender_avatar },
        }));
        res.write(`data: ${JSON.stringify({ messages })}\n\n`);
      }
    } catch {
      // ignore poll errors
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
}
