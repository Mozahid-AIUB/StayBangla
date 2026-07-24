import { validateEnv } from "./env.validation";

const REQUIRED_BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6380",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  OTP_PEPPER: "c".repeat(16),
  MINIO_ACCESS_KEY: "test-access-key",
  MINIO_SECRET_KEY: "test-secret-key",
};

describe("validateEnv", () => {
  it("returns parsed config when all required vars are present", () => {
    const result = validateEnv({
      ...REQUIRED_BASE,
      NODE_ENV: "test",
      API_PORT: "3001",
    });

    expect(result.DATABASE_URL).toBe(REQUIRED_BASE.DATABASE_URL);
    expect(result.API_PORT).toBe(3001);
    expect(result.NODE_ENV).toBe("test");
  });

  it("applies defaults when optional vars are missing", () => {
    const result = validateEnv({ ...REQUIRED_BASE });

    expect(result.NODE_ENV).toBe("development");
    expect(result.API_PORT).toBe(3001);
    expect(result.CORS_ORIGINS).toBe("http://localhost:3000");
  });

  it("throws a descriptive error when DATABASE_URL is missing", () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it("throws when API_PORT is not a valid number", () => {
    expect(() =>
      validateEnv({
        ...REQUIRED_BASE,
        API_PORT: "not-a-number",
      }),
    ).toThrow(/API_PORT/);
  });

  it("throws when REDIS_URL is missing", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: REQUIRED_BASE.DATABASE_URL }),
    ).toThrow(/REDIS_URL/);
  });

  it("throws when JWT_ACCESS_SECRET is missing or too short", () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: REQUIRED_BASE.DATABASE_URL,
        REDIS_URL: REQUIRED_BASE.REDIS_URL,
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("applies OTP/JWT/Argon2 defaults when not provided", () => {
    const result = validateEnv({ ...REQUIRED_BASE });

    expect(result.OTP_TTL_SECONDS).toBe(300);
    expect(result.OTP_MAX_ATTEMPTS).toBe(5);
    expect(result.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(result.OTP_RATE_LIMIT_PER_IDENTIFIER_PER_HOUR).toBe(5);
    expect(result.OTP_RATE_LIMIT_PER_IP_PER_HOUR).toBe(10);
    expect(result.JWT_ACCESS_EXPIRES_IN).toBe("15m");
    expect(result.JWT_REFRESH_EXPIRES_IN).toBe("30d");
    expect(result.ARGON2_MEMORY_COST_KIB).toBe(19456);
    expect(result.ARGON2_TIME_COST).toBe(2);
  });

  it("applies the booking hold-timer default when not provided", () => {
    const result = validateEnv({ ...REQUIRED_BASE });
    expect(result.BOOKING_HOLD_MINUTES).toBe(15);
  });

  it("applies MinIO and presigned-URL defaults when not provided", () => {
    const result = validateEnv({
      ...REQUIRED_BASE,
      MINIO_ACCESS_KEY: "staybangla",
      MINIO_SECRET_KEY: "staybangla-secret",
    });
    expect(result.MINIO_ENDPOINT).toBe("127.0.0.1");
    expect(result.MINIO_PORT).toBe(9000);
    expect(result.MINIO_USE_SSL).toBe(false);
    expect(result.MINIO_BUCKET).toBe("staybangla-photos");
    expect(result.PRESIGNED_URL_EXPIRY_SECONDS).toBe(300);
  });

  it("throws when MINIO_ACCESS_KEY is missing", () => {
    const { MINIO_ACCESS_KEY: _omit, ...withoutKey } = {
      ...REQUIRED_BASE,
      MINIO_ACCESS_KEY: "x",
      MINIO_SECRET_KEY: "y",
    };
    expect(() => validateEnv(withoutKey)).toThrow(/MINIO_ACCESS_KEY/);
  });
});
