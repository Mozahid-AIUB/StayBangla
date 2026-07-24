import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function cleanDatabase(): Promise<void> {
  // Photos FK-constrain to their parent hotel/room; verification logs FK-constrain
  // to two User rows (vendor + admin) — all must be cleared before their referenced
  // parent rows below.
  await testPrisma.hotelPhoto.deleteMany();
  await testPrisma.roomPhoto.deleteMany();
  await testPrisma.vendorVerificationLog.deleteMany();
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
