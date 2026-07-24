import { PublicUser, VendorVerificationLogEntry } from "./user";

describe("PublicUser", () => {
  it("accepts a shape matching the real /users/me API response, with no passwordHash field", () => {
    const user: PublicUser = {
      id: "u1",
      phone: null,
      email: "vendor@example.com",
      fullName: "Vendor One",
      vendorType: "HOTEL",
      verifiedStatus: "VERIFIED",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(user.email).toBe("vendor@example.com");
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("allows vendorType and phone to be null (traveler/guide accounts)", () => {
    const user: PublicUser = {
      id: "u2",
      phone: "+8801700000000",
      email: null,
      fullName: null,
      vendorType: null,
      verifiedStatus: "PENDING",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(user.vendorType).toBeNull();
  });
});

describe("VendorVerificationLogEntry", () => {
  it("accepts a shape matching the real /admin/vendors/:id/history entries", () => {
    const entry: VendorVerificationLogEntry = {
      id: "log1",
      vendorId: "u1",
      adminId: "admin1",
      action: "REJECTED",
      reason: "Missing trade license",
      createdAt: "2026-07-25T00:00:00.000Z",
    };

    expect(entry.action).toBe("REJECTED");
  });

  it("allows reason to be null (VERIFIED/PENDING actions rarely include one)", () => {
    const entry: VendorVerificationLogEntry = {
      id: "log2",
      vendorId: "u1",
      adminId: "admin1",
      action: "VERIFIED",
      reason: null,
      createdAt: "2026-07-25T00:00:00.000Z",
    };

    expect(entry.reason).toBeNull();
  });
});
