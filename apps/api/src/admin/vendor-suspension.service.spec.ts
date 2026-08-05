import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorSuspensionService } from "./vendor-suspension.service";

describe("VendorSuspensionService", () => {
  let service: VendorSuspensionService;
  let prisma: {
    user: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    service = new VendorSuspensionService(prisma as unknown as PrismaService);
  });

  describe("suspend", () => {
    it("sets suspendedAt/suspensionReason and writes an audit log row", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "vendor1",
        suspendedAt: new Date(),
        suspensionReason: "fraud",
      });

      await service.suspend("admin1", "vendor1", "fraud");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "vendor1", suspendedAt: null },
        data: {
          suspendedAt: expect.any(Date),
          suspensionReason: "fraud",
        },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "vendor1",
          actorId: "admin1",
          action: "VENDOR_SUSPENDED",
          reason: "fraud",
        },
      });
    });

    it("throws ConflictException when the vendor is already suspended", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.suspend("admin1", "vendor1", "fraud"),
      ).rejects.toThrow(ConflictException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it("writes the caller-supplied action label (e.g. TRAVELER_SUSPENDED) instead of the VENDOR_* default", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "traveler1",
        suspendedAt: new Date(),
        suspensionReason: "abusive behavior",
      });

      await service.suspend(
        "admin1",
        "traveler1",
        "abusive behavior",
        "TRAVELER_SUSPENDED",
      );

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "traveler1",
          actorId: "admin1",
          action: "TRAVELER_SUSPENDED",
          reason: "abusive behavior",
        },
      });
    });
  });

  describe("unsuspend", () => {
    it("clears suspendedAt/suspensionReason and writes an audit log row", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "vendor1",
        suspendedAt: null,
        suspensionReason: null,
      });

      await service.unsuspend("admin1", "vendor1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "vendor1", suspendedAt: { not: null } },
        data: { suspendedAt: null, suspensionReason: null },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "vendor1",
          actorId: "admin1",
          action: "VENDOR_UNSUSPENDED",
          reason: undefined,
        },
      });
    });

    it("throws ConflictException when the vendor is not currently suspended", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unsuspend("admin1", "vendor1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("writes the caller-supplied action label (e.g. TRAVELER_UNSUSPENDED) instead of the VENDOR_* default", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "traveler1",
        suspendedAt: null,
        suspensionReason: null,
      });

      await service.unsuspend("admin1", "traveler1", "TRAVELER_UNSUSPENDED");

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "traveler1",
          actorId: "admin1",
          action: "TRAVELER_UNSUSPENDED",
          reason: undefined,
        },
      });
    });
  });
});
