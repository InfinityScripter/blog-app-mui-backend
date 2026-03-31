import type { NextApiRequest, NextApiResponse } from 'next';

import cors from '@/src/utils/cors';
import { dbQuery } from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { taskId } = req.query as { taskId: string };

  if (req.method === 'DELETE') {
    await dbQuery('DELETE FROM kanban_tasks WHERE id = $1', [taskId]);
    return res.status(200).json({ success: true });
  }

  if (req.method === 'PATCH') {
    const { title, description, assignees, labels, dueDate, columnId, position } = req.body;
    const updates: string[] = [];
    const values: unknown[] = [];

    if (title !== undefined) {
      values.push(title);
      updates.push(`title = $${values.length}`);
    }
    if (description !== undefined) {
      values.push(description);
      updates.push(`description = $${values.length}`);
    }
    if (assignees !== undefined) {
      values.push(JSON.stringify(assignees));
      updates.push(`assignees = $${values.length}`);
    }
    if (labels !== undefined) {
      values.push(JSON.stringify(labels));
      updates.push(`labels = $${values.length}`);
    }
    if (dueDate !== undefined) {
      values.push(dueDate);
      updates.push(`due_date = $${values.length}`);
    }
    if (columnId !== undefined) {
      values.push(columnId);
      updates.push(`column_id = $${values.length}`);
    }
    if (position !== undefined) {
      values.push(position);
      updates.push(`position = $${values.length}`);
    }

    if (!updates.length) return res.status(400).json({ message: 'No fields to update' });

    updates.push(`updated_at = NOW()`);
    values.push(taskId);
    await dbQuery(
      `UPDATE kanban_tasks SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ message: 'Method not allowed' });
}

export default requireAuth(handler);
