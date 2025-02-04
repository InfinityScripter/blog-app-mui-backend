import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

import { _board } from 'src/_mock/_kanban';

// ----------------------------------------------------------------------

// BOARD
function getBoard(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    board: _board,
  });
}

// COLUMN
// ----------------------------------------------------------------------

function createColumn(req: NextApiRequest, res: NextApiResponse) {
  const { columnData } = req.body;

  // add column in board.columns
  _board.columns = [..._board.columns, columnData];

  // add column in board.tasks
  _board.tasks = { ..._board.tasks, [columnData.id]: [] };

  res.status(200).json({
    column: columnData,
  });
}

function updateColumn(req: NextApiRequest, res: NextApiResponse) {
  const { columnId, columnName } = req.body;

  // find and update column in board.columns
  _board.columns = _board.columns.map((column) =>
    column.id === columnId
      ? {
          // Update data when found
          ...column,
          name: columnName,
        }
      : column
  );

  // return column updated
  const updatedColumn = _board.columns.find((column) => column.id === columnId);

  res.status(200).json({
    column: updatedColumn,
  });
}

function moveColumn(req: NextApiRequest, res: NextApiResponse) {
  const { updateColumns } = req.body;

  _board.columns = updateColumns;

  res.status(200).json({
    columns: _board.columns,
  });
}

function clearColumn(req: NextApiRequest, res: NextApiResponse) {
  const { columnId } = req.body;

  // remove all tasks in column
  _board.tasks = {
    ..._board.tasks,
    [columnId]: [],
  };

  res.status(200).json({
    columnId,
  });
}

function deleteColumn(req: NextApiRequest, res: NextApiResponse) {
  const { columnId } = req.body;

  // delete column in board.columns
  _board.columns = _board.columns.filter((column) => column.id !== columnId);

  // delete tasks by column deleted
  _board.tasks = Object.keys(_board.tasks)
    .filter((key) => key !== columnId)
    .reduce((obj: typeof _board.tasks, key) => {
      obj[key] = _board.tasks[key];
      return obj;
    }, {});

  res.status(200).json({
    columnId,
  });
}

// TASK
// ----------------------------------------------------------------------

function addTask(req: NextApiRequest, res: NextApiResponse) {
  const { columnId, taskData } = req.body;

  // add task in board.tasks by columnId
  _board.tasks = {
    ..._board.tasks,
    [columnId]: [taskData, ..._board.tasks[columnId]],
  };

  res.status(200).json({
    columnId,
    taskData,
  });
}

function updateTask(req: NextApiRequest, res: NextApiResponse) {
  const { columnId, taskData } = req.body;

  // tasks in column
  const tasksInColumn = _board.tasks[columnId];

  // find and update task in tasks
  const updateTasks = tasksInColumn.map((task) =>
    task.id === taskData.id
      ? {
          // Update data when found
          ...task,
          ...taskData,
        }
      : task
  );

  // update _board.tasks
  _board.tasks = {
    ..._board.tasks,
    [columnId]: updateTasks,
  };

  // return column updated
  const updatedTask = updateTasks.find((task) => task.id === taskData.id);

  res.status(200).json({
    task: updatedTask,
  });
}

function moveTask(req: NextApiRequest, res: NextApiResponse) {
  const { updateTasks } = req.body;

  _board.tasks = updateTasks;

  res.status(200).json({
    columns: _board.tasks,
  });
}

function deleteTask(req: NextApiRequest, res: NextApiResponse) {
  const { columnId, taskId } = req.body;

  // delete task in current column
  _board.tasks = {
    ..._board.tasks,
    [columnId]: _board.tasks[columnId].filter((task) => task.id !== taskId),
  };

  res.status(200).json({
    columnId,
    taskId,
  });
}

// ----------------------------------------------------------------------

export default async function allHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    const { endpoint } = req.query;

    switch (req.method) {
      case 'GET':
        getBoard(req, res);
        break;
      case 'POST':
        if (endpoint === 'create-column') createColumn(req, res);
        if (endpoint === 'update-column') updateColumn(req, res);
        if (endpoint === 'move-column') moveColumn(req, res);
        if (endpoint === 'clear-column') clearColumn(req, res);
        if (endpoint === 'delete-column') deleteColumn(req, res);
        if (endpoint === 'create-task') addTask(req, res);
        if (endpoint === 'update-task') updateTask(req, res);
        if (endpoint === 'move-task') moveTask(req, res);
        if (endpoint === 'delete-task') deleteTask(req, res);
        break;
      default:
        res.status(405).json({
          message: 'Method not allowed',
        });
    }
  } catch (error) {
    console.error('[Kanban API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
