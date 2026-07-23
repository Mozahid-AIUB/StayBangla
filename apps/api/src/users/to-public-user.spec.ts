import { toPublicUser } from "./to-public-user";

describe("toPublicUser", () => {
  it("strips passwordHash and keeps other fields", () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      phone: null,
      passwordHash: "$argon2id$secret",
      fullName: "Alice",
      vendorType: null,
      verifiedStatus: "VERIFIED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = toPublicUser(user as never);

    expect(result).not.toHaveProperty("passwordHash");
    expect(result.email).toBe("a@b.com");
    expect(result.fullName).toBe("Alice");
  });
});
