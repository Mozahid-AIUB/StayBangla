import { Test } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PoliciesGuard } from "../casl/policies.guard";

describe("UsersController", () => {
  let controller: UsersController;
  let usersService: { findById: jest.Mock; updateProfile: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn(), updateProfile: jest.fn() };
    // Guards (JwtAuthGuard/RolesGuard/PoliciesGuard) are unit-tested in isolation
    // elsewhere — override them here so this test only exercises controller logic.
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PoliciesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(UsersController);
  });

  it("me() returns the current user without passwordHash", async () => {
    usersService.findById.mockResolvedValue({
      id: "u1",
      passwordHash: "secret",
      fullName: "A",
    });
    const result = await controller.me({ id: "u1", roles: ["TRAVELER"] });
    expect(result).not.toHaveProperty("passwordHash");
    expect(result.fullName).toBe("A");
  });

  it("updateMe() updates and returns the current user without passwordHash", async () => {
    usersService.updateProfile.mockResolvedValue({
      id: "u1",
      passwordHash: "secret",
      fullName: "B",
    });
    const result = await controller.updateMe(
      { id: "u1", roles: ["TRAVELER"] },
      { fullName: "B" },
    );
    expect(usersService.updateProfile).toHaveBeenCalledWith("u1", {
      fullName: "B",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });
});
