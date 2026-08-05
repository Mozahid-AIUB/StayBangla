import { Test } from "@nestjs/testing";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { VendorVerificationService } from "../admin/vendor-verification.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { SuspensionGuard } from "../auth/guards/suspension.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CHECK_POLICIES_KEY } from "../casl/decorators/check-policies.decorator";
import { CaslAbilityFactory } from "../casl/casl-ability.factory";

describe("UsersController", () => {
  let controller: UsersController;
  let usersService: { findById: jest.Mock; updateProfile: jest.Mock };
  let vendorVerificationService: { resubmit: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn(), updateProfile: jest.fn() };
    vendorVerificationService = { resubmit: jest.fn() };
    // Guards (JwtAuthGuard/RolesGuard/PoliciesGuard) are unit-tested in isolation
    // elsewhere — override them here so this test only exercises controller logic.
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        {
          provide: VendorVerificationService,
          useValue: vendorVerificationService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PoliciesGuard)
      .useValue({ canActivate: () => true })
      // This unit spec exercises controller methods directly, not guard
      // enforcement — SuspensionGuard's own DB-read behavior has dedicated
      // e2e coverage (test/vendor-approval.e2e-spec.ts asserts a suspended
      // vendor gets 403 on resubmit using a pre-suspension token). It needs
      // PrismaService this controller-only module doesn't wire, so it must be
      // overridden like the three guards above, not left to real DI.
      .overrideGuard(SuspensionGuard)
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

  it("resubmit() delegates to VendorVerificationService with the caller's id", async () => {
    vendorVerificationService.resubmit.mockResolvedValue({
      id: "v1",
      verifiedStatus: "PENDING",
      passwordHash: "x",
    });
    const result = await controller.resubmit({ id: "v1", roles: ["VENDOR"] });
    expect(vendorVerificationService.resubmit).toHaveBeenCalledWith("v1");
    expect(result).not.toHaveProperty("passwordHash");
  });

  describe("updateMe() @CheckPolicies handler", () => {
    // The policy handler is an inline closure passed to the decorator, so it's
    // only invoked by a real PoliciesGuard evaluation — mocking the guard (as
    // above) never calls it. Pull it out via reflection and exercise it
    // directly against a real CaslAbilityFactory, matching this project's
    // convention of unit-testing policy handlers in isolation
    // (see casl/policies.guard.spec.ts).
    const [handler] = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      UsersController.prototype.updateMe,
    ) as [(ability: unknown, request: { user: { id: string } }) => boolean];
    const abilityFactory = new CaslAbilityFactory();

    it("allows a user to update their own profile", () => {
      const ability = abilityFactory.createForUser({
        id: "u1",
        roles: ["TRAVELER"],
      });
      expect(handler(ability, { user: { id: "u1" } })).toBe(true);
    });

    it("denies a user updating someone else's profile", () => {
      const ability = abilityFactory.createForUser({
        id: "u1",
        roles: ["TRAVELER"],
      });
      expect(handler(ability, { user: { id: "u2" } })).toBe(false);
    });
  });
});
