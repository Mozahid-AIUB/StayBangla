import { BookingStatus, UserRole } from "./enums";

describe("shared enums", () => {
  it("BookingStatus covers the full lifecycle", () => {
    expect(BookingStatus.HELD).toBe("HELD");
    expect(BookingStatus.CONFIRMED).toBe("CONFIRMED");
    expect(BookingStatus.COMPLETED).toBe("COMPLETED");
    expect(BookingStatus.AUTO_CANCELLED).toBe("AUTO_CANCELLED");
  });

  it("UserRole includes all platform roles", () => {
    expect(Object.values(UserRole)).toEqual(
      expect.arrayContaining(["TRAVELER", "VENDOR", "GUIDE", "ADMIN", "SUPER_ADMIN"])
    );
  });
});
