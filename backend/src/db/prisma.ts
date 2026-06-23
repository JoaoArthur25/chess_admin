import { PrismaClient } from '@prisma/client';

// Single shared client. Pinned to Prisma 5 (see CLAUDE.md guardrail).
export const prisma = new PrismaClient();
