import { Admin, PrismaClient, User } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const users = await prisma.user.findMany({
    include: {
      Board: {
        include: {
          columns: true,
        },
      },
    },
  });

  const admins = users.filter((user) => user.role.includes('admin'));

  for (const admin of admins) {
    if (admin.Board) {
      const secondColumn = await prisma.columns.findFirst({
        where: {
          AND: [
            {
              boardId: admin.Board.id,
            },
            {
              name: 'In Progress',
            },
          ],
        },
      });

      if (secondColumn) {
        await prisma.columns.update({
          where: {
            id: secondColumn.id,
          },
          data: {
            name: 'Actions Needed',
          },
        });
      }
    }
  }
})();
