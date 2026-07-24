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
    vendorVerificationLog: { create: jest.Mock; findMany: jest.Mock };
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
      vendorVerificationLog: { create: jest.fn(), findMany: jest.fn() },
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
      expect(prisma.vendorVerificationLog.create).toHaveBeenCalledWith({
        data: {
          vendorId: "v1",
          adminId: "admin1",
          action: "VERIFIED",
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
      expect(prisma.vendorVerificationLog.create).not.toHaveBeenCalled();
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
      expect(prisma.vendorVerificationLog.create).toHaveBeenCalledWith({
        data: {
          vendorId: "v1",
          adminId: "admin1",
          action: "REJECTED",
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

  describe("getHistory", () => {
    it("returns the log rows for a vendor, newest first", async () => {
      prisma.vendorVerificationLog.findMany.mockResolvedValue([{ id: "log1" }]);
      const result = await service.getHistory("v1");
      expect(prisma.vendorVerificationLog.findMany).toHaveBeenCalledWith({
        where: { vendorId: "v1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
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
  });
});
