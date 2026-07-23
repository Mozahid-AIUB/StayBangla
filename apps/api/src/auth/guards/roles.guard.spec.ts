import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

function makeContext(userRoles: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles: userRoles } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  it("allows access when no @Roles() metadata is set", () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(["TRAVELER"]))).toBe(true);
  });

  it("allows access when the user has a matching role", () => {
    const reflector = {
      getAllAndOverride: () => ["ADMIN"],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(["ADMIN"]))).toBe(true);
  });

  it("allows access when the user has one of multiple required roles", () => {
    const reflector = {
      getAllAndOverride: () => ["ADMIN", "SUPER_ADMIN"],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(["SUPER_ADMIN"]))).toBe(true);
  });

  it("throws ForbiddenException when the user has none of the required roles", () => {
    const reflector = {
      getAllAndOverride: () => ["ADMIN"],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeContext(["TRAVELER"]))).toThrow(
      ForbiddenException,
    );
  });

  it("allows access when the required-roles list is an empty array (treated as no restriction)", () => {
    const reflector = { getAllAndOverride: () => [] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(["TRAVELER"]))).toBe(true);
  });
});
