import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function cleanDatabase(): Promise<void> {
  // Booking references room/vehicle ids as plain columns (no Prisma @relation),
  // so it has no FK constraint, but it's still cleared first for hygiene.
  await testPrisma.booking.deleteMany();
  await testPrisma.room.deleteMany();
  await testPrisma.vehicle.deleteMany();
  await testPrisma.hotel.deleteMany();
  await testPrisma.refreshToken.deleteMany();
  await testPrisma.userRole.deleteMany();
  await testPrisma.user.deleteMany();
}
