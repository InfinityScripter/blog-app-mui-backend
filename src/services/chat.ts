import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the chat domain. No HTTP — throws AppError.

interface ChannelRow {
  id: string;
  type: string;
  name: string | null;
  created_by: string;
  created_at: Date;
}

/** Channels the user belongs to, each enriched with members + last message. */
async function listChannels(userId: string) {
  const result = await dbQuery<ChannelRow>(
    `SELECT c.id, c.type, c.name, c.created_by, c.created_at
     FROM chat_channels c
     JOIN chat_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId]
  );

  return Promise.all(
    result.rows.map(async (row) => {
      const members = await dbQuery<{ id: string; name: string; avatar_url: string | null }>(
        `SELECT u.id, u.name, u.avatar_url FROM users u
         JOIN chat_members cm ON cm.user_id = u.id
         WHERE cm.channel_id = $1`,
        [row.id]
      );
      const lastMsg = await dbQuery<{ body: string; created_at: Date }>(
        `SELECT body, created_at FROM chat_messages
         WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [row.id]
      );
      const last = lastMsg.rows[0] ?? null;
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        createdBy: row.created_by,
        createdAt: row.created_at,
        lastMessage: last?.body ?? null,
        lastMessageAt: last?.created_at ?? null,
        members: members.rows.map((m) => ({ id: m.id, name: m.name, avatarURL: m.avatar_url })),
      };
    })
  );
}

interface CreateChannelParams {
  userId: string;
  type: 'direct' | 'group';
  name?: string;
  memberIds: string[];
}

/**
 * Creates a channel. For a 1:1 direct channel, returns the existing one if a
 * direct channel between the two users already exists. Returns { id }.
 */
async function createChannel({ userId, type, name, memberIds }: CreateChannelParams) {
  if (!type || !memberIds?.length) {
    throw new AppError(HTTP.BAD_REQUEST, 'type and memberIds are required');
  }

  if (type === 'direct' && memberIds.length === 1) {
    const existing = await dbQuery<{ id: string }>(
      `SELECT c.id FROM chat_channels c
       JOIN chat_members cm1 ON cm1.channel_id = c.id AND cm1.user_id = $1
       JOIN chat_members cm2 ON cm2.channel_id = c.id AND cm2.user_id = $2
       WHERE c.type = 'direct' LIMIT 1`,
      [userId, memberIds[0]]
    );
    if (existing.rows[0]) {
      return { id: existing.rows[0].id, existing: true };
    }
  }

  const channelId = uuidv4();
  await dbQuery('INSERT INTO chat_channels (id, type, name, created_by) VALUES ($1, $2, $3, $4)', [
    channelId,
    type,
    name ?? null,
    userId,
  ]);

  const allMembers = Array.from(new Set([userId, ...memberIds]));
  await Promise.all(
    allMembers.map((memberId) =>
      dbQuery('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2)', [
        channelId,
        memberId,
      ])
    )
  );

  return { id: channelId, existing: false };
}

export const chatService = { listChannels, createChannel };
