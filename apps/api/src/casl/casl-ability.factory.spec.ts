import { CaslAbilityFactory, AppSubjects } from "./casl-ability.factory";

describe("CaslAbilityFactory", () => {
  const factory = new CaslAbilityFactory();

  it("lets a traveler read and update their own User profile", () => {
    const ability = factory.createForUser({ id: "u1", roles: ["TRAVELER"] });
    const ownProfile: AppSubjects = { __caslSubjectType__: "User", id: "u1" };
    expect(ability.can("read", ownProfile)).toBe(true);
    expect(ability.can("update", ownProfile)).toBe(true);
  });

  it("prevents a traveler from reading or updating another user's profile", () => {
    const ability = factory.createForUser({ id: "u1", roles: ["TRAVELER"] });
    const otherProfile: AppSubjects = { __caslSubjectType__: "User", id: "u2" };
    expect(ability.can("read", otherProfile)).toBe(false);
    expect(ability.can("update", otherProfile)).toBe(false);
  });

  it("lets an ADMIN read and update any User profile", () => {
    const ability = factory.createForUser({ id: "admin1", roles: ["ADMIN"] });
    const otherProfile: AppSubjects = { __caslSubjectType__: "User", id: "u2" };
    expect(ability.can("read", otherProfile)).toBe(true);
    expect(ability.can("update", otherProfile)).toBe(true);
  });

  it("lets a SUPER_ADMIN read and update any User profile", () => {
    const ability = factory.createForUser({
      id: "sa1",
      roles: ["SUPER_ADMIN"],
    });
    const otherProfile: AppSubjects = { __caslSubjectType__: "User", id: "u2" };
    expect(ability.can("read", otherProfile)).toBe(true);
    expect(ability.can("update", otherProfile)).toBe(true);
  });
});
