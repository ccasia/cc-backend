import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient>;
};

const createPrismaClient = () =>
  new PrismaClient().$extends({
    model: {
      $allModels: {
        async findById(this: { findUnique: Function }, id: string) {
          return this.findUnique({ where: { id } });
        },
      },
    },
  });

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

if (globalForPrisma.prisma) {
  console.log('GLOBAL ONE');
} else {
  console.log('INITIALIZE');
}
