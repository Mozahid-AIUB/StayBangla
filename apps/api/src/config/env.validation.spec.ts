import { validateEnv } from "./env.validation";

describe("validateEnv", () => {
  it("returns parsed config when all required vars are present", () => {
    const result = validateEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      NODE_ENV: "test",
      API_PORT: "3001",
    });

    expect(result.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(result.API_PORT).toBe(3001);
    expect(result.NODE_ENV).toBe("test");
  });

  it("applies defaults when optional vars are missing", () => {
    const result = validateEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/db" });

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
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        API_PORT: "not-a-number",
      }),
    ).toThrow(/API_PORT/);
  });
});
