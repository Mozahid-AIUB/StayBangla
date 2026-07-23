import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function cleanDatabase(): Promise<void> {
  await testPrisma.refreshToken.deleteMany();
  await testPrisma.userRole.deleteMany();
  await testPrisma.user.deleteMany();
}
