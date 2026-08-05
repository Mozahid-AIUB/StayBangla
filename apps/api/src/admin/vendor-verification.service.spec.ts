import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorVerificationService } from "./vendor-verification.service";

describe("VendorVerificationService", () => {
  let prisma: {
    user: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
    };
    adminAuditLog: { create: jest.Mock; findMany: jest.Mock };
  };
  let service: VendorVerificationService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
      },
      adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
    };
    service = new VendorVerificationService(prisma as unknown as PrismaService);
  });

  describe("listPending", () => {
    it("returns users with verifiedStatus=PENDING", async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: "v1", verifiedStatus: "PENDING" },
      ]);
      const result = await service.listPending();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { verifiedStatus: "PENDING" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("approve", () => {
    it("flips PENDING to VERIFIED and logs the action", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });

      const result = await service.approve("admin1", "v1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "PENDING" },
        data: { verifiedStatus: "VERIFIED" },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "v1",
          actorId: "admin1",
          action: "VENDOR_APPROVED",
          reason: undefined,
        },
      });
      expect(result.verifiedStatus).toBe("VERIFIED");
    });

    it("throws ConflictException when the vendor is not currently PENDING", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve("admin1", "v1")).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("reject", () => {
    it("flips PENDING to REJECTED and logs the reason", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });

      const result = await service.reject(
        "admin1",
        "v1",
        "NID document unclear",
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "PENDING" },
        data: { verifiedStatus: "REJECTED" },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "v1",
          actorId: "admin1",
          action: "VENDOR_REJECTED",
          reason: "NID document unclear",
        },
      });
      expect(result.verifiedStatus).toBe("REJECTED");
    });

    it("throws ConflictException when the vendor is not currently PENDING", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject("admin1", "v1", "reason")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("resubmit", () => {
    it("flips REJECTED to PENDING", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });

      const result = await service.resubmit("v1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "REJECTED" },
        data: { verifiedStatus: "PENDING" },
      });
      expect(result.verifiedStatus).toBe("PENDING");
    });

    it("is an idempotent no-op when already PENDING", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      const result = await service.resubmit("v1");
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(result.verifiedStatus).toBe("PENDING");
    });

    it("is an idempotent no-op when already VERIFIED", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      const result = await service.resubmit("v1");
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(result.verifiedStatus).toBe("VERIFIED");
    });

    it("throws NotFoundException for a missing user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resubmit("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("writes an AdminAuditLog entry when a genuine REJECTED->PENDING resubmit occurs", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });

      await service.resubmit("v1");

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "v1",
          actorId: "v1",
          action: "VENDOR_RESUBMITTED",
          reason: undefined,
        },
      });
    });

    it("does not write a log entry when resubmit is an idempotent no-op (already PENDING/VERIFIED)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });

      await service.resubmit("v1");

      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it("does not write a log entry when the resubmit's guarded update loses a race (count 0)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });

      await service.resubmit("v1");

      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });
});
