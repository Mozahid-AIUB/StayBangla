import { Booking, BookableType } from "./booking";
import { BookingStatus } from "./enums";

describe("Booking", () => {
  it("accepts a shape matching the real BookingRecord API response for a room booking", () => {
    const bookableType: BookableType = "ROOM";
    const booking: Booking = {
      id: "b1",
      userId: "traveler1",
      bookableType,
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "vendor1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: BookingStatus.HELD,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(booking.bookableType).toBe("ROOM");
    expect(booking.vehicleId).toBeNull();
  });

  it("accepts a shape for a vendor-created BLOCKED entry (userId null)", () => {
    const booking: Booking = {
      id: "b2",
      userId: null,
      bookableType: "VEHICLE",
      roomId: null,
      vehicleId: "veh1",
      resourceOwnerId: "vendor1",
      checkIn: "2026-09-05",
      checkOut: "2026-09-06",
      guestCount: null,
      totalAmountMinor: 0,
      currency: "BDT",
      status: BookingStatus.BLOCKED,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(booking.userId).toBeNull();
    expect(booking.status).toBe("BLOCKED");
  });
});
