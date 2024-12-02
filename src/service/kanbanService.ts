import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface NewTaskAdmin {
  submissionId: string;
  name: string;
  columnId: string;
  userId: string;
  position: number;
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
