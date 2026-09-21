import { PrismaClient } from '@prisma/client';

// Cache on globalThis so hot reloads (nodemon/tsx) and duplicate module loads reuse one client / connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
