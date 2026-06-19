import '@jest/globals';
import User from '@/src/models/User';
import { AppError } from '@/src/types/api';
import { kanbanService } from '@/src/services/kanban';

describe('kanbanService', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await User.create({
      _id: 'admin-1',
      name: 'Admin',
      email: 'adm@e.com',
      passwordHash: 'x',
      role: 'admin',
    });
    await User.create({
      _id: 'user-1',
      name: 'User',
      email: 'usr@e.com',
      passwordHash: 'x',
      role: 'user',
    });
  });

  it('createBoard: admin creates a board and is added as a member', async () => {
    const board = await kanbanService.createBoard({
      userId: 'admin-1',
      role: 'admin',
      name: 'Sprint',
      description: 'desc',
    });
    expect(board.id).toBeTruthy();
    expect(board.name).toBe('Sprint');

    const boards = await kanbanService.listBoards('admin-1');
    expect(boards.some((b) => b.id === board.id)).toBe(true);
  });

  it('createBoard: non-admin → AppError 403', async () => {
    await expect(
      kanbanService.createBoard({ userId: 'user-1', role: 'user', name: 'X' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('createBoard: missing name → AppError 400', async () => {
    await expect(
      kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: '' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('listBoards: returns only boards the user is a member of', async () => {
    await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'AdminBoard' });
    const userBoards = await kanbanService.listBoards('user-1');
    expect(userBoards).toHaveLength(0);
  });

  it('getBoard: member gets the board with an added column', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    await kanbanService.addColumn(board.id, 'To Do');
    const full = await kanbanService.getBoard('admin-1', board.id);
    expect(full.id).toBe(board.id);
    expect(full.columns).toHaveLength(1);
    expect(full.columns[0].name).toBe('To Do');
    expect(full.columns[0].tasks).toEqual([]);
  });

  it('getBoard: non-member → AppError 403', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    await expect(kanbanService.getBoard('user-1', board.id)).rejects.toMatchObject({ status: 403 });
  });

  it('addColumn: missing name → AppError 400', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    await expect(kanbanService.addColumn(board.id, '')).rejects.toMatchObject({ status: 400 });
  });

  it('deleteBoard: removes the board', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    await kanbanService.deleteBoard(board.id);
    const boards = await kanbanService.listBoards('admin-1');
    expect(boards.some((b) => b.id === board.id)).toBe(false);
  });

  it('addTask: appends a task, then getBoard shows it; updateTask renames it', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    const col = await kanbanService.addColumn(board.id, 'Doing');
    const task = await kanbanService.addTask({
      columnId: col.id,
      userId: 'admin-1',
      title: 'Task A',
    });
    expect(task.id).toBeTruthy();

    await kanbanService.updateTask(task.id, { title: 'Task A renamed' });
    const full = await kanbanService.getBoard('admin-1', board.id);
    const found = full.columns[0].tasks.find((t: any) => t.id === task.id);
    expect(found?.title).toBe('Task A renamed');
  });

  it('addTask: missing title → AppError 400', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    const col = await kanbanService.addColumn(board.id, 'C');
    await expect(
      kanbanService.addTask({ columnId: col.id, userId: 'admin-1', title: '' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('updateTask: no fields → AppError 400', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    const col = await kanbanService.addColumn(board.id, 'C');
    const task = await kanbanService.addTask({ columnId: col.id, userId: 'admin-1', title: 'T' });
    await expect(kanbanService.updateTask(task.id, {})).rejects.toMatchObject({ status: 400 });
  });

  it('deleteTask + deleteColumn: remove cleanly', async () => {
    const board = await kanbanService.createBoard({ userId: 'admin-1', role: 'admin', name: 'B' });
    const col = await kanbanService.addColumn(board.id, 'C');
    const task = await kanbanService.addTask({ columnId: col.id, userId: 'admin-1', title: 'T' });
    await kanbanService.deleteTask(task.id);
    await kanbanService.deleteColumn(col.id);
    const full = await kanbanService.getBoard('admin-1', board.id);
    expect(full.columns).toHaveLength(0);
  });
});
