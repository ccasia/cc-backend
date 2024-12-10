import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export enum Role {
  'admin',
  'creator',
}

enum ColumnCreator {
  'To Do',
  'In Progress',
  'In Review',
  'Done',
}

enum ColumnAdmin {
  'To Do',
  'Actions Needed',
  'Done',
}

interface NewTaskAdmin {
  submissionId: string;
  name: string;
  columnId: string;
  userId: string;
  position: number;
}

interface UpdateTask {
  toColumnId: string;
  userId: string;
  taskId: string;
  fromColumnId?: string;
}

interface Task {
  boardId: string;
  submissionId: string;
  columnName: string;
}

export const createNewTask = async ({ submissionId, name, columnId, userId, position }: NewTaskAdmin) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: true,
      },
    });

    if (!user) throw new Error('No user found.');

    const column = await prisma.columns.findUnique({
      where: {
        id: columnId,
      },
    });

    if (!column) throw new Error('No column found.');

    const newTask = await prisma.task.create({
      data: {
        column: { connect: { id: column.id } },
        submission: { connect: { id: submissionId } },
        name: name || 'None',
        position: position || 0,
      },
    });

    return newTask;
  } catch (error) {
    throw new Error(error);
  }
};

export const updateTask = async ({ taskId, toColumnId, userId }: UpdateTask) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        admin: true,
      },
    });

    if (!user) throw new Error('No user found.');

    const toColumn = await prisma.columns.findUnique({
      where: {
        id: toColumnId,
      },
    });

    if (!toColumn) throw new Error('No column found.');

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        column: { connect: { id: toColumn.id } },
      },
    });

    return task;
  } catch (error) {
    throw new Error(error);
  }
};

function getColumns(role: Role): typeof ColumnCreator | typeof ColumnAdmin {
  if (role === Role.creator) {
    return ColumnCreator;
  }
  return ColumnAdmin;
}

export const getTaskId = async ({ boardId, submissionId, columnName }: Task) => {
  try {
    const board = await prisma.board.findUnique({
      where: {
        id: boardId,
      },
      include: {
        columns: {
          where: {
            name: columnName,
          },
          include: {
            task: {
              where: {
                submissionId,
              },
            },
          },
        },
      },
    });

    if (!board) throw new Error('Board not found');

    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        task: true,
      },
    });

    const column = board.columns[0]; // Since we're filtering by `columnName`, it should be the first (and only) result.

    if (!column) throw new Error(`Column "${columnName}" not found`);

    const task = column.task[0]; // Assuming `submissionId` also ensures a single result.

    if (!task) return null;

    return task;
  } catch (error) {
    throw new Error(error);
  }
};
