import { NotFoundException } from "@nestjs/common";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { TravelerBookingsController } from "./traveler-bookings.controller";
import {
  TravelerBookingRow,
  TravelerBookingsService,
} from "./traveler-bookings.service";

const caller: RequestUser = { id: "traveler-1", roles: ["TRAVELER"] };

const row = {
  id: "b1",
  bookableType: "ROOM",
  checkIn: "2026-09-01",
  checkOut: "2026-09-03",
} as TravelerBookingRow;

describe("TravelerBookingsController", () => {
  let service: {
    listForTraveler: jest.Mock;
    findOwnedOrThrow: jest.Mock;
  };
  let controller: TravelerBookingsController;

  beforeEach(() => {
    service = {
      listForTraveler: jest.fn(),
      findOwnedOrThrow: jest.fn(),
    };
    controller = new TravelerBookingsController(
      service as unknown as TravelerBookingsService,
    );
  });

  // The id comes from the verified token, never from the request. A handler
  // that took it from a parameter would let anyone read anyone's bookings, and
  // would look almost identical.
  it("passes the caller's own id from the token, not from the request", async () => {
    service.listForTraveler.mockResolvedValue([row]);

    await controller.list(caller);

    expect(service.listForTraveler).toHaveBeenCalledWith("traveler-1");
  });

  it("returns the bookings unchanged", async () => {
    service.listForTraveler.mockResolvedValue([row]);

    await expect(controller.list(caller)).resolves.toEqual([row]);
  });

  it("passes both the caller and the requested id when fetching one", async () => {
    service.findOwnedOrThrow.mockResolvedValue(row);

    await controller.findOne(caller, "b1");

    expect(service.findOwnedOrThrow).toHaveBeenCalledWith("traveler-1", "b1");
  });

  it("lets a not-found from the service through", async () => {
    service.findOwnedOrThrow.mockRejectedValue(
      new NotFoundException("Booking not found"),
    );

    await expect(
      controller.findOne(caller, "someone-elses"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
