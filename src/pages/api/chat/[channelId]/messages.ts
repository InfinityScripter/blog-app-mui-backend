import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const { channelId } = req.query as { channelId: string };

  const membership = await dbQuery(
    'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  if (!membership.rows.length) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  if (req.method === 'GET') {
    const { before, limit = '50' } = req.query as { before?: string; limit?: string };
    const params: unknown[] = [channelId, parseInt(limit, 10)];
    let whereClause = '';
    if (before) {
      params.push(before);
      whereClause = `AND m.created_at < $${params.length}`;
    }

    const result = await dbQuery<{
      id: string;
      body: string;
      attachments: unknown[];
      created_at: Date;
      sender_id: string;
      sender_name: string;
      sender_avatar: string | null;
    }>(
      `
      SELECT m.id, m.body, m.attachments, m.created_at, m.sender_id,
             u.name AS sender_name, u.avatar_url AS sender_avatar
      FROM chat_messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = $1 ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $2
    `,
      params
    );

    const messages = result.rows.reverse().map((row) => ({
      id: row.id,
      body: row.body,
      attachments: row.attachments,
      createdAt: row.created_at,
      sender: {
        id: row.sender_id,
        name: row.sender_name,
        avatarURL: row.sender_avatar,
      },
    }));
    return res.status(200).json({ messages });
  }

  if (req.method === 'POST') {
    const { body } = req.body as { body: string };
    if (!body?.trim()) {
      return res.status(400).json({ message: 'Message body is required' });
    }
    const msgId = uuidv4();
    await dbQuery(
      'INSERT INTO chat_messages (id, channel_id, sender_id, body) VALUES ($1, $2, $3, $4)',
      [msgId, channelId, userId, body.trim()]
    );
    return res.status(201).json({ message: { id: msgId } });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
