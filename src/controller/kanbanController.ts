import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getKanbanBoard = async (req: Request, res: Response) => {
  try {
    const board = await prisma.board.findUnique({
      where: {
        userId: req.session.userid,
      },
      include: {
        columns: {
          include: {
            task: {
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

    console.log(board);

    // const json: any = {
    //   board: {
    //     id: board?.id,
    //     columns: {},
    //     tasks: {},
    //     ordered: [],
    //   },
    // };

    // board?.columns.forEach((column) => {
    //   json.board.columns[column?.id] = {
    //     id: column.id,
    //     name: column.name,
    //     taskIds: [],
    //   };

    //   json.board.ordered.push(column?.id);

    //   column.task.forEach((item) => {
    //     json.board.tasks[item?.id] = {
    //       id: item.id,
    //       name: item.title,
    //       description: item.description,
    //       createdAt: item.createdAt,
    //       dueDate: item.dueDate,
    //     };
    //     json.board.columns[column?.id].taskIds.push(item?.id);
    //   });
    // });

    return res.status(200).json({ board: board });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const createColumn = async (req: Request, res: Response) => {
  const { name, boardId, position } = req.body.columnData;

  try {
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
    console.log(error);
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
    console.log(error);
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
