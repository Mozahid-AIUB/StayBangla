import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_RATE_LIMIT_PER_IDENTIFIER_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  OTP_RATE_LIMIT_PER_IP_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  OTP_PEPPER: z.string().min(16),

  ARGON2_MEMORY_COST_KIB: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),

  BOOKING_HOLD_MINUTES: z.coerce.number().int().positive().default(15),

  MINIO_ENDPOINT: z.string().default("127.0.0.1"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  // z.coerce.boolean() coerces ANY non-empty string (including the literal
  // "false") to `true` via Boolean(str) — unsafe for env vars, which are
  // always strings. Parse the literal "true"/"false" text instead.
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((val) => val === "true"),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default("staybangla-photos"),
  PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_OTP_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),

  SSLCOMMERZ_STORE_ID: z.string().min(1),
  SSLCOMMERZ_STORE_PASSWORD: z.string().min(1),
  SSLCOMMERZ_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((val) => val === "true"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}
