import { validateEnv } from "./env.validation";

const REQUIRED_BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6380",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  OTP_PEPPER: "c".repeat(16),
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
});
