import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PoliciesGuard } from "./policies.guard";
import { CaslAbilityFactory } from "./casl-ability.factory";

function makeContext(user: { id: string; roles: string[] }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("PoliciesGuard", () => {
  it("allows access when every policy handler returns true", () => {
    const reflector = { get: () => [() => true] } as unknown as Reflector;
    const guard = new PoliciesGuard(reflector, new CaslAbilityFactory());
    expect(
      guard.canActivate(makeContext({ id: "u1", roles: ["TRAVELER"] })),
    ).toBe(true);
  });

  it("throws ForbiddenException when a policy handler returns false", () => {
    const reflector = { get: () => [() => false] } as unknown as Reflector;
    const guard = new PoliciesGuard(reflector, new CaslAbilityFactory());
    expect(() =>
      guard.canActivate(makeContext({ id: "u1", roles: ["TRAVELER"] })),
    ).toThrow(ForbiddenException);
  });

  it("allows access when no @CheckPolicies() metadata is set (empty handler list)", () => {
    const reflector = { get: () => undefined } as unknown as Reflector;
    const guard = new PoliciesGuard(reflector, new CaslAbilityFactory());
    expect(
      guard.canActivate(makeContext({ id: "u1", roles: ["TRAVELER"] })),
    ).toBe(true);
  });

  it("passes the request to each policy handler so it can check ownership", () => {
    const reflector = {
      get: () => [
        (_ability: unknown, request: { user: { id: string } }) =>
          request.user.id === "u1",
      ],
    } as unknown as Reflector;
    const guard = new PoliciesGuard(reflector, new CaslAbilityFactory());
    expect(
      guard.canActivate(makeContext({ id: "u1", roles: ["TRAVELER"] })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(makeContext({ id: "u2", roles: ["TRAVELER"] })),
    ).toThrow(ForbiddenException);
  });
});
