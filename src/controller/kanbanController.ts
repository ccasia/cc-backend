import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Columns } from '@types';

const prisma = new PrismaClient();

export const ADMIN_COLUMNS = ['To Do', 'Actions Needed', 'Done'];
const CREATOR_COLUMNS = ['To Do', 'In Progress', 'In Review', 'Done'];

export const getKanbanBoard = async (req: Request, res: Response) => {
  try {
    const board = await prisma.board.findUnique({
      where: {
        userId: req.session.userid,
      },
      include: {
        user: true,
        columns: {
          include: {
            task: {
              include: {
                submission: {
                  include: {
                    user: true,
                    feedback: true,
                    campaign: {
                      include: {
                        campaignTimeline: true,
                        campaignBrief: {
                          select: {
                            images: true,
                          },
                        },
                        company: {
                          select: {
                            name: true,
                          },
                        },
                        brand: {
                          select: {
                            name: true,
                          },
                        },
                      },
                    },
                    submissionType: true,
                  },
                },
              },
              orderBy: {
                position: 'asc',
              },
            },
          },
          orderBy: {
            position: 'asc',
          },
        },
      },
    });

    return res.status(200).json({ board: board });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createColumn = async (req: Request, res: Response) => {
  const { name, boardId, position } = req.body.columnData;

  try {
    const board = await prisma.board.findUnique({
      where: {
        id: boardId,
      },
    });

    if (!board) {
      return res.status(404).json({ message: 'No board found.' });
    }

    const column = await prisma.columns.create({
      data: {
        name: name,
        boardId: boardId,
        position: position,
      },
      include: {
        task: true,
      },
    });
    return res.status(200).json({ message: 'Success', newColumn: column });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const deleteColumn = async (req: Request, res: Response) => {
  const { columnId } = req.query;

  try {
    const columnToDelete = await prisma.columns.findUnique({ where: { id: columnId as string } });

    if (!columnToDelete) {
      return res.status(404).json({ message: 'Column not found' });
    }

    const deletedColumn = await prisma.columns.delete({
      where: {
        id: columnId as string,
      },
      include: {
        task: true,
      },
    });

    await prisma.columns.updateMany({
      where: {
        boardId: deletedColumn.boardId,
        position: {
          gt: deletedColumn.position,
        },
      },
      data: {
        position: {
          decrement: 1,
        },
      },
    });

    return res.status(200).json(deletedColumn);
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const editColumn = async (req: Request, res: Response) => {
  const { columnId, newColumnName } = req.body;
  try {
    const column = await prisma.columns.findUnique({
      where: {
        id: columnId,
      },
    });

    if (!column) {
      return res.status(404).json({ message: 'Column not found.' });
    }

    await prisma.columns.update({
      where: {
        id: column?.id,
      },
      data: {
        name: newColumnName,
      },
    });
    return res.status(200).json({ message: 'Update Success' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const moveColumn = async (req: Request, res: Response) => {
  const { newPosition, columnId } = req.body;
  try {
    const columnToMove = await prisma.columns.findUnique({ where: { id: columnId } });

    if (!columnToMove) {
      return res.status(404).json({ message: 'Column not found' });
    }

    const oldPosition = columnToMove.position;
    const boardId = columnToMove.boardId;

    if (oldPosition === newPosition) {
      return res.status(400).json({ message: 'Column is already at the desired position' });
    }

    if (newPosition < oldPosition) {
      await prisma.columns.updateMany({
        where: {
          boardId,
          position: {
            gte: newPosition,
            lt: oldPosition,
          },
        },
        data: {
          position: {
            increment: 1,
          },
        },
      });
    }

    if (newPosition > oldPosition) {
      await prisma.columns.updateMany({
        where: {
          boardId,
          position: {
            gt: oldPosition,
            lte: newPosition,
          },
        },
        data: {
          position: {
            decrement: 1,
          },
        },
      });
    }

    await prisma.columns.update({
      where: { id: columnId },
      data: { position: newPosition },
    });

    const updatedColumns = await prisma.columns.findMany({
      where: {
        boardId: boardId,
      },
      include: {
        task: true,
      },
      orderBy: {
        position: 'asc',
      },
    });

    return res.status(200).json(updatedColumns);
  } catch (error) {
    // //console.log(error);
    return res.status(400).json(error);
  }
};

export const clearColumn = async (req: Request, res: Response) => {
  const { columnId } = req.body;
  try {
    const tasksRemove = await prisma.task.deleteMany({
      where: {
        columnId: columnId,
      },
    });

    return res.status(200).json({ message: `Tasks deleted ` });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createTask = async (req: Request, res: Response) => {
  const { columnId, title } = req.body;
  try {
    const taskCount = await prisma.task.count({
      where: { columnId },
    });

    await prisma.task.create({
      data: {
        name: title,
        position: taskCount + 1,
        priority: 'Test',
        column: {
          connect: { id: columnId },
        },
      },
    });
    return res.status(200).json({ message: 'Task Created' });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const moveTask = async (req: Request, res: Response) => {
  const data = req.body as Columns;

  try {
    if (data.type === 'differentColumn') {
      const tasks = data?.allTasks || [];
      for (const task of tasks) {
        await prisma.task.update({
          where: {
            id: task.id,
          },
          data: {
            position: task.position,
            columnId: task.columnId,
          },
        });
      }

      return res.status(200).json({ message: 'Task Moved To Other Column' });
    }

    const column = await prisma.columns.findUnique({
      where: {
        id: data.columnId,
      },
      include: {
        task: true,
      },
    });

    if (!column) {
      return res.status(404).json({ message: 'Column not found' });
    }

    for (const task of data.tasks) {
      await prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          position: task.position,
        },
      });
    }

    return res.status(200).json({ message: 'Task Moved' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const createKanbanBoard = async (userId: string, type?: any) => {
  let columns;
  try {
    const board = await prisma.board.create({
      data: {
        name: 'My Tasks',
        user: { connect: { id: userId } },
      },
    });

    if (type === 'creator') {
      columns = CREATOR_COLUMNS.map(async (column, index) => {
        await prisma.columns.create({
          data: {
            name: column,
            board: { connect: { id: board.id } },
            position: index,
          },
        });
      });
    } else {
      columns = ADMIN_COLUMNS.map(async (column, index) => {
        await prisma.columns.create({
          data: {
            name: column,
            board: { connect: { id: board.id } },
            position: index,
          },
        });
      });
    }

    return { board, ...columns };
  } catch (error) {
    throw new Error(error);
  }
};

export const getColumnId = async ({
  userId,
  boardId,
  columnName,
}: {
  userId?: string;
  boardId?: string;
  columnName: 'To Do' | 'In Progress' | 'In Review' | 'Done' | 'Actions Needed';
}) => {
  const board = await prisma.board.findFirst({
    where: {
      OR: [
        {
          id: boardId,
        },
        {
          userId: userId,
        },
      ],
    },
    include: {
      columns: true,
    },
  });

  if (!board) {
    throw new Error('Board not found');
  }

  const id = board.columns.find((column) => column.name === columnName)?.id;

  return id;
};
