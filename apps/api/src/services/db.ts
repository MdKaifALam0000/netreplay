import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.databaseUrl,
    },
  },
  log: config.env === 'development' ? ['error', 'warn'] : ['error'],
});

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
