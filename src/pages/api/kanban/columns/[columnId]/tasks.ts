import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import uuidv4 from '@/src/utils/uuidv4';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const userId = req.user!._id;
  const { columnId } = req.query as { columnId: string };
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const { title, description, assignees = [], labels = [], dueDate } = req.body;
  if (!title) return res.status(400).json({ message: 'title is required' });

  const posResult = await dbQuery<{ max: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS max FROM kanban_tasks WHERE column_id = $1',
    [columnId]
  );
  const position = posResult.rows[0].max;
  const taskId = uuidv4();
  await dbQuery(
    'INSERT INTO kanban_tasks (id, column_id, title, description, assignees, labels, due_date, position, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      taskId,
      columnId,
      title,
      description ?? null,
      JSON.stringify(assignees),
      JSON.stringify(labels),
      dueDate ?? null,
      position,
      userId,
    ]
  );

  return res
    .status(201)
    .json({ task: { id: taskId, title, description, assignees, labels, dueDate, position } });
}

export default requireAuth(handler);
