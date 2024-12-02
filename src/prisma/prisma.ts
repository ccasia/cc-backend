import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient().$extends({
  model: {
    $allModels: {
      async findById(this: { findUnique: Function }, id: string) {
        return this.findUnique({ where: { id } });
      },
    },
  },
});
