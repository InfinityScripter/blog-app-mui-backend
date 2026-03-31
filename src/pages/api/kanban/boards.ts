import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;

  if (req.method === 'GET') {
    const result = await dbQuery<{
      id: string;
      name: string;
      description: string | null;
      created_by: string;
      created_at: Date;
    }>(
      `SELECT b.id, b.name, b.description, b.created_by, b.created_at
       FROM kanban_boards b
       JOIN kanban_board_members bm ON bm.board_id = b.id AND bm.user_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    return res.status(200).json({
      boards: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
    });
  }

  if (req.method === 'POST') {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can create boards' });
    }
    const { name, description, memberIds = [] } = req.body as {
      name: string;
      description?: string;
      memberIds?: string[];
    };
    if (!name) return res.status(400).json({ message: 'name is required' });

    const boardId = uuidv4();
    await dbQuery(
      'INSERT INTO kanban_boards (id, name, description, created_by) VALUES ($1, $2, $3, $4)',
      [boardId, name, description ?? null, userId]
    );

    const allMembers = Array.from(new Set([userId, ...memberIds]));
    for (const memberId of allMembers) {
      await dbQuery('INSERT INTO kanban_board_members (board_id, user_id) VALUES ($1, $2)', [
        boardId,
        memberId,
      ]);
    }

    return res.status(201).json({ board: { id: boardId, name, description } });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
