import { Vehicle } from "./vehicle";
import { District } from "./enums";

describe("Vehicle", () => {
  it("accepts a shape matching the real GET /vehicles/:id response", () => {
    const vehicle: Vehicle = {
      id: "veh1",
      ownerId: "v1",
      category: "CNG",
      city: District.DHAKA,
      model: "Bajaj RE",
      capacity: 3,
      pricePerDayMinor: 200000,
      currency: "BDT",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(vehicle.category).toBe("CNG");
  });

  it("allows model to be null", () => {
    const vehicle: Vehicle = {
      id: "veh2",
      ownerId: "v1",
      category: "BOAT",
      city: District.SAINT_MARTIN,
      model: null,
      capacity: 10,
      pricePerDayMinor: 500000,
      currency: "BDT",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(vehicle.model).toBeNull();
  });
});
