import { UsersService } from "../users/users.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { CredentialsService } from "./credentials.service";

describe("CredentialsService", () => {
  let usersService: { findByIdentifier: jest.Mock; create: jest.Mock };
  let passwordService: { hash: jest.Mock; verify: jest.Mock };
  let tokenService: { issueTokenPair: jest.Mock };
  let service: CredentialsService;

  beforeEach(() => {
    usersService = { findByIdentifier: jest.fn(), create: jest.fn() };
    passwordService = { hash: jest.fn(), verify: jest.fn() };
    tokenService = { issueTokenPair: jest.fn() };
    service = new CredentialsService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      tokenService as unknown as TokenService,
    );
  });

  describe("register", () => {
    it("creates a PENDING vendor/guide user with a hashed password", async () => {
      usersService.findByIdentifier.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue("$argon2id$hashed");
      usersService.create.mockResolvedValue({
        id: "u1",
        verifiedStatus: "PENDING",
      });

      const result = await service.register({
        email: "vendor@example.com",
        password: "supersecret1",
        fullName: "Vendor One",
        role: "VENDOR",
      });

      expect(passwordService.hash).toHaveBeenCalledWith("supersecret1");
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "vendor@example.com",
          passwordHash: "$argon2id$hashed",
          role: "VENDOR",
        }),
      );
      expect(result.verifiedStatus).toBe("PENDING");
    });

    it("rejects registration with an email that already exists", async () => {
      usersService.findByIdentifier.mockResolvedValue({ id: "existing" });
      await expect(
        service.register({
          email: "vendor@example.com",
          password: "supersecret1",
          fullName: "X",
          role: "VENDOR",
        }),
      ).rejects.toThrow(/already/i);
    });
  });

  describe("login", () => {
    it("issues tokens for correct credentials", async () => {
      usersService.findByIdentifier.mockResolvedValue({
        id: "u1",
        passwordHash: "$argon2id$hashed",
        roles: [{ role: "VENDOR" }],
      });
      passwordService.verify.mockResolvedValue(true);
      tokenService.issueTokenPair.mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });

      const result = await service.login("vendor@example.com", "supersecret1");

      expect(result).toEqual({ accessToken: "at", refreshToken: "rt" });
    });

    it("throws a generic error for a wrong password (anti-enumeration)", async () => {
      usersService.findByIdentifier.mockResolvedValue({
        id: "u1",
        passwordHash: "$argon2id$hashed",
        roles: [],
      });
      passwordService.verify.mockResolvedValue(false);
      await expect(
        service.login("vendor@example.com", "wrong"),
      ).rejects.toThrow(/invalid credentials/i);
    });

    it("throws the same generic error for a non-existent identifier", async () => {
      usersService.findByIdentifier.mockResolvedValue(null);
      await expect(
        service.login("nobody@example.com", "whatever"),
      ).rejects.toThrow(/invalid credentials/i);
    });

    it("throws the same generic error for an OTP-only user with no passwordHash", async () => {
      usersService.findByIdentifier.mockResolvedValue({
        id: "u1",
        passwordHash: null,
        roles: [],
      });
      await expect(
        service.login("traveler@example.com", "whatever"),
      ).rejects.toThrow(/invalid credentials/i);
    });
  });
});
