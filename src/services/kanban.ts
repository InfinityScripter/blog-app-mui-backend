import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';
import { AppError } from '@/src/types/api';
import { HTTP } from '@/src/constants/http';

// Business logic for the kanban board domain. No HTTP — throws AppError.

interface BoardRow {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Date;
}

export interface Board {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
}

function mapBoard(r: BoardRow): Board {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Boards the given user is a member of, newest first. */
async function listBoards(userId: string): Promise<Board[]> {
  const result = await dbQuery<BoardRow>(
    `SELECT b.id, b.name, b.description, b.created_by, b.created_at
     FROM kanban_boards b
     JOIN kanban_board_members bm ON bm.board_id = b.id AND bm.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapBoard);
}

interface CreateBoardParams {
  userId: string;
  role?: string;
  name: string;
  description?: string;
  memberIds?: string[];
}

/** Admin-only board creation; creator + memberIds become board members. */
async function createBoard({ userId, role, name, description, memberIds = [] }: CreateBoardParams) {
  if (role !== 'admin') {
    throw new AppError(HTTP.FORBIDDEN, 'Only admins can create boards');
  }
  if (!name) {
    throw new AppError(HTTP.BAD_REQUEST, 'name is required');
  }

  const boardId = uuidv4();
  await dbQuery(
    'INSERT INTO kanban_boards (id, name, description, created_by) VALUES ($1, $2, $3, $4)',
    [boardId, name, description ?? null, userId]
  );

  const allMembers = Array.from(new Set([userId, ...memberIds]));
  await Promise.all(
    allMembers.map((memberId) =>
      dbQuery('INSERT INTO kanban_board_members (board_id, user_id) VALUES ($1, $2)', [
        boardId,
        memberId,
      ])
    )
  );

  return { id: boardId, name, description };
}

/** Full board (columns + their tasks) — caller must be a board member. */
async function getBoard(userId: string, boardId: string) {
  const member = await dbQuery(
    'SELECT 1 FROM kanban_board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  if (!member.rows.length) {
    throw new AppError(HTTP.FORBIDDEN, 'Forbidden');
  }

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
        `SELECT id, title, description, assignees, labels, due_date, position, created_by, created_at
         FROM kanban_tasks WHERE column_id = $1 ORDER BY position ASC`,
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

  return { id: boardId, columns };
}

/** Deletes a board (cascades to columns/tasks via FK). */
async function deleteBoard(boardId: string) {
  await dbQuery('DELETE FROM kanban_boards WHERE id = $1', [boardId]);
}

/** Appends a column to a board at the next position. */
async function addColumn(boardId: string, name: string) {
  if (!name) {
    throw new AppError(HTTP.BAD_REQUEST, 'name is required');
  }
  const posResult = await dbQuery<{ max: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS max FROM kanban_columns WHERE board_id = $1',
    [boardId]
  );
  const position = posResult.rows[0].max;
  const colId = uuidv4();
  await dbQuery(
    'INSERT INTO kanban_columns (id, board_id, name, position) VALUES ($1, $2, $3, $4)',
    [colId, boardId, name, position]
  );
  return { id: colId, name, position, tasks: [] as unknown[] };
}

/** Deletes a column (cascades to its tasks via FK). */
async function deleteColumn(columnId: string) {
  await dbQuery('DELETE FROM kanban_columns WHERE id = $1', [columnId]);
}

interface AddTaskParams {
  columnId: string;
  userId: string;
  title: string;
  description?: string;
  assignees?: unknown[];
  labels?: unknown[];
  dueDate?: string;
}

/** Appends a task to a column at the next position. */
async function addTask({
  columnId,
  userId,
  title,
  description,
  assignees = [],
  labels = [],
  dueDate,
}: AddTaskParams) {
  if (!title) {
    throw new AppError(HTTP.BAD_REQUEST, 'title is required');
  }
  const posResult = await dbQuery<{ max: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS max FROM kanban_tasks WHERE column_id = $1',
    [columnId]
  );
  const position = posResult.rows[0].max;
  const taskId = uuidv4();
  await dbQuery(
    `INSERT INTO kanban_tasks
       (id, column_id, title, description, assignees, labels, due_date, position, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
  return { id: taskId, title, description, assignees, labels, dueDate, position };
}

/** Deletes a task. */
async function deleteTask(taskId: string) {
  await dbQuery('DELETE FROM kanban_tasks WHERE id = $1', [taskId]);
}

const TASK_COLUMN_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  assignees: 'assignees',
  labels: 'labels',
  dueDate: 'due_date',
  columnId: 'column_id',
  position: 'position',
};

/** Partial task update; only provided fields are written. Throws 400 if none. */
async function updateTask(taskId: string, patch: Record<string, unknown>) {
  const updates: string[] = [];
  const values: unknown[] = [];
  Object.entries(TASK_COLUMN_MAP).forEach(([key, column]) => {
    if (patch[key] !== undefined) {
      const value =
        key === 'assignees' || key === 'labels' ? JSON.stringify(patch[key]) : patch[key];
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    }
  });
  if (!updates.length) {
    throw new AppError(HTTP.BAD_REQUEST, 'No fields to update');
  }
  updates.push('updated_at = NOW()');
  values.push(taskId);
  await dbQuery(
    `UPDATE kanban_tasks SET ${updates.join(', ')} WHERE id = $${values.length}`,
    values
  );
}

export const kanbanService = {
  listBoards,
  createBoard,
  getBoard,
  deleteBoard,
  addColumn,
  deleteColumn,
  addTask,
  deleteTask,
  updateTask,
};
