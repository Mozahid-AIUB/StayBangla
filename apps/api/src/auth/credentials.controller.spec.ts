import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";

describe("CredentialsController", () => {
  let controller: CredentialsController;
  let credentialsService: { register: jest.Mock; login: jest.Mock };
  let tokenService: {
    rotateRefreshToken: jest.Mock;
    revokeFamilyByToken: jest.Mock;
  };
  let usersService: { findById: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(async () => {
    credentialsService = { register: jest.fn(), login: jest.fn() };
    tokenService = {
      rotateRefreshToken: jest.fn(),
      revokeFamilyByToken: jest.fn(),
    };
    usersService = { findById: jest.fn() };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [
        { provide: CredentialsService, useValue: credentialsService },
        { provide: TokenService, useValue: tokenService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { get: () => "development" } },
      ],
    }).compile();
    controller = moduleRef.get(CredentialsController);
  });

  it("register() returns 201 with the created user (no password in body)", async () => {
    credentialsService.register.mockResolvedValue({
      id: "u1",
      verifiedStatus: "PENDING",
      passwordHash: "secret",
    });
    const result = await controller.register({
      email: "v@e.com",
      password: "supersecret1",
      fullName: "V",
      role: "VENDOR",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("login() sets a refresh cookie and returns the access token", async () => {
    credentialsService.login.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });
    const result = await controller.login(
      { identifier: "v@e.com", password: "supersecret1" },
      res as never,
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "refreshToken",
      "rt",
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({ accessToken: "at" });
  });

  it("refresh() rejects when no refresh cookie is present", async () => {
    await expect(
      controller.refresh({ cookies: {} } as never, res as never),
    ).rejects.toThrow(/refresh token/i);
  });

  it("refresh() rotates the cookie when present", async () => {
    tokenService.rotateRefreshToken.mockResolvedValue({
      accessToken: "at2",
      refreshToken: "rt2",
    });
    usersService.findById.mockResolvedValue({ roles: [{ role: "VENDOR" }] });
    const result = await controller.refresh(
      { cookies: { refreshToken: "rt" } } as never,
      res as never,
    );
    expect(result).toEqual({ accessToken: "at2" });
    expect(res.cookie).toHaveBeenCalledWith(
      "refreshToken",
      "rt2",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("logout() revokes the token family and clears the cookie", async () => {
    await controller.logout(
      { cookies: { refreshToken: "rt" } } as never,
      res as never,
    );
    expect(tokenService.revokeFamilyByToken).toHaveBeenCalledWith("rt");
    expect(res.clearCookie).toHaveBeenCalledWith("refreshToken");
  });

  it("logout() is a no-op on the token service when no cookie is present", async () => {
    await controller.logout({ cookies: {} } as never, res as never);
    expect(tokenService.revokeFamilyByToken).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith("refreshToken");
  });
});
