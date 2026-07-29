import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

export const testPrisma = new PrismaClient();

async function clearThrottlerKeys(): Promise<void> {
  // A short-lived client, opened and closed within this one call, rather than
  // a module-scoped singleton — ioredis's TCP socket (unlike Prisma's pool)
  // keeps the Node process alive until explicitly disconnected, which was
  // hanging Jest across every e2e-spec.ts file that imports cleanDatabase.
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
  try {
    // @nest-lab/throttler-storage-redis stores its counters as
    // "{key:throttlerName}:hits" / "...:blocked" (see
    // ThrottlerStorageRedisService.increment in node_modules) — both suffixes
    // are matched here, so one e2e suite's requests never count against
    // another suite's or test's limit when the full e2e suite runs in one
    // process against a shared Redis instance. OTP's own domain-specific keys
    // (otp:*) are intentionally left alone — clearing those is each
    // OTP-related test's own concern, not this shared helper's.
    const throttlerKeys = await redis.keys("*}:hits");
    const blockedKeys = await redis.keys("*}:blocked");
    const allThrottlerKeys = [...throttlerKeys, ...blockedKeys];
    if (allThrottlerKeys.length > 0) {
      await redis.del(...allThrottlerKeys);
    }
  } finally {
    redis.disconnect();
  }
}

export async function cleanDatabase(): Promise<void> {
  // Photos FK-constrain to their parent hotel/room; verification logs FK-constrain
  // to two User rows (vendor + admin) — all must be cleared before their referenced
  // parent rows below.
  await testPrisma.hotelPhoto.deleteMany();
  await testPrisma.roomPhoto.deleteMany();
  await testPrisma.vendorVerificationLog.deleteMany();
  // LedgerEntry has a real Prisma @relation FK to Booking, so it must be
  // cleared before Booking rows are deleted.
  await testPrisma.ledgerEntry.deleteMany();
  // Booking references room/vehicle ids as plain columns (no Prisma @relation),
  // so it has no FK constraint, but it's still cleared first for hygiene.
  await testPrisma.booking.deleteMany();
  await testPrisma.room.deleteMany();
  await testPrisma.vehicle.deleteMany();
  await testPrisma.hotel.deleteMany();
  await testPrisma.refreshToken.deleteMany();
  await testPrisma.userRole.deleteMany();
  await testPrisma.user.deleteMany();

  await clearThrottlerKeys();
}
