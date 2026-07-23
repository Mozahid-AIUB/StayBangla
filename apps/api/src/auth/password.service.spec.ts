import { ConfigService } from "@nestjs/config";
import { PasswordService } from "./password.service";

function makeService(): PasswordService {
  const config = {
    get: (key: string, def?: number) =>
      key === "ARGON2_MEMORY_COST_KIB"
        ? 19456
        : key === "ARGON2_TIME_COST"
          ? 2
          : def,
  } as unknown as ConfigService;
  return new PasswordService(config);
}

describe("PasswordService", () => {
  it("hashes a password using argon2id", async () => {
    const service = makeService();
    const hash = await service.hash("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("verifies a correct password against its hash", async () => {
    const service = makeService();
    const hash = await service.hash("correct horse battery staple");
    await expect(
      service.verify(hash, "correct horse battery staple"),
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const service = makeService();
    const hash = await service.hash("correct horse battery staple");
    await expect(service.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("returns false (not throw) for a malformed hash", async () => {
    const service = makeService();
    await expect(service.verify("not-a-real-hash", "anything")).resolves.toBe(
      false,
    );
  });
});
