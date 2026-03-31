import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  if (req.method === 'GET') {
    // Get channels user is member of (no LATERAL — pg-mem compatibility)
    const result = await dbQuery<{
      id: string;
      type: string;
      name: string | null;
      created_by: string;
      created_at: Date;
    }>(
      `SELECT c.id, c.type, c.name, c.created_by, c.created_at
       FROM chat_channels c
       JOIN chat_members cm ON cm.channel_id = c.id AND cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );

    const channels = await Promise.all(
      result.rows.map(async (row) => {
        const membersResult = await dbQuery<{
          id: string;
          name: string;
          avatar_url: string | null;
        }>(
          `SELECT u.id, u.name, u.avatar_url FROM users u
           JOIN chat_members cm ON cm.user_id = u.id
           WHERE cm.channel_id = $1`,
          [row.id]
        );
        const lastMsgResult = await dbQuery<{ body: string; created_at: Date }>(
          `SELECT body, created_at FROM chat_messages
           WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [row.id]
        );
        const lastMsg = lastMsgResult.rows[0] ?? null;
        return {
          id: row.id,
          type: row.type,
          name: row.name,
          createdBy: row.created_by,
          createdAt: row.created_at,
          lastMessage: lastMsg?.body ?? null,
          lastMessageAt: lastMsg?.created_at ?? null,
          members: membersResult.rows.map((m) => ({
            id: m.id,
            name: m.name,
            avatarURL: m.avatar_url,
          })),
        };
      })
    );

    return res.status(200).json({ channels });
  }

  if (req.method === 'POST') {
    const { type, name, memberIds } = req.body as {
      type: 'direct' | 'group';
      name?: string;
      memberIds: string[];
    };

    if (!type || !memberIds?.length) {
      return res.status(400).json({ message: 'type and memberIds are required' });
    }

    if (type === 'direct' && memberIds.length === 1) {
      const existing = await dbQuery<{ id: string }>(
        `
        SELECT c.id FROM chat_channels c
        JOIN chat_members cm1 ON cm1.channel_id = c.id AND cm1.user_id = $1
        JOIN chat_members cm2 ON cm2.channel_id = c.id AND cm2.user_id = $2
        WHERE c.type = 'direct'
        LIMIT 1
      `,
        [userId, memberIds[0]]
      );
      if (existing.rows[0]) {
        return res.status(200).json({ channel: { id: existing.rows[0].id } });
      }
    }

    const channelId = uuidv4();
    await dbQuery(
      'INSERT INTO chat_channels (id, type, name, created_by) VALUES ($1, $2, $3, $4)',
      [channelId, type, name ?? null, userId]
    );

    const allMembers = Array.from(new Set([userId, ...memberIds]));
    for (const memberId of allMembers) {
      await dbQuery('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2)', [
        channelId,
        memberId,
      ]);
    }

    return res.status(201).json({ channel: { id: channelId } });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
