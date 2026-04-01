import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const { boardId } = req.query as { boardId: string };

  if (req.method === 'DELETE') {
    await dbQuery('DELETE FROM kanban_boards WHERE id = $1', [boardId]);
    return res.status(200).json({ success: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  const member = await dbQuery(
    'SELECT 1 FROM kanban_board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (!member.rows.length) return res.status(403).json({ message: 'Forbidden' });

  const cols = await dbQuery<{ id: string; name: string; position: number }>(
    'SELECT id, name, position FROM kanban_columns WHERE board_id = $1 ORDER BY position ASC',
    [boardId]
  );

  const columns = await Promise.all(
    cols.rows.map(async (col) => {
      const tasks = await dbQuery<{
        id: string;
        title: string;
        description: string | null;
        assignees: unknown[];
        labels: unknown[];
        due_date: Date | null;
        position: number;
        created_by: string;
        created_at: Date;
      }>(
        'SELECT id, title, description, assignees, labels, due_date, position, created_by, created_at FROM kanban_tasks WHERE column_id = $1 ORDER BY position ASC',
        [col.id]
      );
      return {
        id: col.id,
        name: col.name,
        position: col.position,
        tasks: tasks.rows.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assignees: t.assignees,
          labels: t.labels,
          dueDate: t.due_date,
          position: t.position,
          createdBy: t.created_by,
          createdAt: t.created_at,
        })),
      };
    })
  );

  return res.status(200).json({ board: { id: boardId, columns } });
}

export default requireAuth(handler);
