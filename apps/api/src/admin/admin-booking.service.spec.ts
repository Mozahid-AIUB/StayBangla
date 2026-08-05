import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminBookingService } from "./admin-booking.service";

describe("AdminBookingService", () => {
  let service: AdminBookingService;
  let prisma: {
    $queryRaw: jest.Mock;
    booking: { updateMany: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      booking: { updateMany: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    service = new AdminBookingService(prisma as unknown as PrismaService);
  });

  describe("list", () => {
    it("runs an unfiltered platform-wide query when no filters are given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      const result = await service.list({});

      expect(result).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("includes the status filter fragment when status is given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      await service.list({ status: "CONFIRMED" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain("CONFIRMED");
    });

    it("includes the district filter fragment when district is given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      await service.list({ district: "DHAKA" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain("DHAKA");
    });

    it("applies page/pageSize as offset/limit, defaulting to page 1 / pageSize 50", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "120" }])
        .mockResolvedValueOnce([]);

      const result = await service.list({ page: 3, pageSize: 20 });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain(20);
      expect(sqlObject.values).toContain(40);
      expect(result).toEqual({ items: [], page: 3, pageSize: 20, total: 120 });
    });
  });

  describe("forceCancel", () => {
    it("cancels an active booking and writes a BOOKING_FORCE_CANCELLED audit row, never touching paymentStatus", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });

      await service.forceCancel("admin1", "booking1", "duplicate booking");

      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: "booking1",
          status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
        },
        data: { status: "CANCELLED" },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "booking1",
          actorId: "admin1",
          action: "BOOKING_FORCE_CANCELLED",
          reason: "duplicate booking",
        },
      });
    });

    it("throws ConflictException when the booking is not in a cancellable state (already terminal, or a double force-cancel)", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.forceCancel("admin1", "booking1", "duplicate booking"),
      ).rejects.toThrow(ConflictException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });
});
