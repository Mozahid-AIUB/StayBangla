import {
  BookingStatus,
  UserRole,
  District,
  RoomType,
  BedType,
  FacilityCatalog,
} from "./enums";

describe("shared enums", () => {
  it("BookingStatus covers the full lifecycle", () => {
    expect(BookingStatus.HELD).toBe("HELD");
    expect(BookingStatus.CONFIRMED).toBe("CONFIRMED");
    expect(BookingStatus.COMPLETED).toBe("COMPLETED");
    expect(BookingStatus.AUTO_CANCELLED).toBe("AUTO_CANCELLED");
  });

  it("BookingStatus includes BLOCKED for vendor-created maintenance entries", () => {
    expect(BookingStatus.BLOCKED).toBe("BLOCKED");
  });

  it("UserRole includes all platform roles", () => {
    expect(Object.values(UserRole)).toEqual(
      expect.arrayContaining([
        "TRAVELER",
        "VENDOR",
        "GUIDE",
        "ADMIN",
        "SUPER_ADMIN",
      ]),
    );
  });
});

describe("District", () => {
  it("includes every tourist-relevant district used by the API", () => {
    expect(District.DHAKA).toBe("DHAKA");
    expect(District.COXS_BAZAR).toBe("COXS_BAZAR");
    expect(District.SAINT_MARTIN).toBe("SAINT_MARTIN");
    expect(District.SREEMANGAL).toBe("SREEMANGAL");
  });

  it("has exactly 16 values, matching the Prisma schema enum", () => {
    expect(Object.values(District)).toHaveLength(16);
  });
});

describe("RoomType", () => {
  it("covers every room type the API accepts", () => {
    expect(Object.values(RoomType)).toEqual([
      "SINGLE",
      "DOUBLE",
      "TWIN",
      "SUITE",
      "FAMILY",
      "DORMITORY",
    ]);
  });
});

describe("BedType", () => {
  it("covers every bed type the API accepts", () => {
    expect(Object.values(BedType)).toEqual([
      "SINGLE",
      "TWIN",
      "DOUBLE",
      "QUEEN",
      "KING",
      "BUNK",
    ]);
  });
});

describe("FacilityCatalog", () => {
  it("has exactly 16 values, matching the Prisma schema enum", () => {
    expect(Object.values(FacilityCatalog)).toHaveLength(16);
  });

  it("includes core facilities used in hotel amenities", () => {
    expect(FacilityCatalog.WIFI).toBe("WIFI");
    expect(FacilityCatalog.AIR_CONDITIONING).toBe("AIR_CONDITIONING");
    expect(FacilityCatalog.SWIMMING_POOL).toBe("SWIMMING_POOL");
  });
});
