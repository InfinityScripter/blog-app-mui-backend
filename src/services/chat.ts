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

/** Throws AppError 403 if the user is not a member of the channel. */
async function assertMember(channelId: string, userId: string) {
  const membership = await dbQuery(
    'SELECT 1 FROM chat_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, userId]
  );
  if (!membership.rows.length) {
    throw new AppError(HTTP.FORBIDDEN, 'Forbidden');
  }
}

interface ListMessagesParams {
  channelId: string;
  userId: string;
  before?: string;
  limit?: number;
}

/** Messages in a channel (member-only), oldest-first, paginated by `before`. */
async function listMessages({ channelId, userId, before, limit = 50 }: ListMessagesParams) {
  await assertMember(channelId, userId);

  const params: unknown[] = [channelId, limit];
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
    `SELECT m.id, m.body, m.attachments, m.created_at, m.sender_id,
            u.name AS sender_name, u.avatar_url AS sender_avatar
     FROM chat_messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.channel_id = $1 ${whereClause}
     ORDER BY m.created_at DESC
     LIMIT $2`,
    params
  );

  return result.rows.reverse().map((row) => ({
    id: row.id,
    body: row.body,
    attachments: row.attachments,
    createdAt: row.created_at,
    sender: { id: row.sender_id, name: row.sender_name, avatarURL: row.sender_avatar },
  }));
}

interface SendMessageParams {
  channelId: string;
  userId: string;
  body: string;
}

/** Posts a message to a channel (member-only). Returns the new message id. */
async function sendMessage({ channelId, userId, body }: SendMessageParams) {
  await assertMember(channelId, userId);
  if (!body?.trim()) {
    throw new AppError(HTTP.BAD_REQUEST, 'Message body is required');
  }
  const msgId = uuidv4();
  await dbQuery(
    'INSERT INTO chat_messages (id, channel_id, sender_id, body) VALUES ($1, $2, $3, $4)',
    [msgId, channelId, userId, body.trim()]
  );
  return { id: msgId };
}

export const chatService = { listChannels, createChannel, listMessages, sendMessage };
