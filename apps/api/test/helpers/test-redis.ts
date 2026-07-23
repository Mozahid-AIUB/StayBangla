import Redis from "ioredis";

const testRedis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");

export async function cleanOtpKeys(): Promise<void> {
  const keys = await testRedis.keys("otp:*");
  if (keys.length > 0) {
    await testRedis.del(...keys);
  }
}

export async function disconnectTestRedis(): Promise<void> {
  await testRedis.quit();
}
