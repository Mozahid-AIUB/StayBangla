import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class VendorVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listPending(): Promise<User[]> {
    return this.prisma.user.findMany({ where: { verifiedStatus: "PENDING" } });
  }

  async approve(adminId: string, vendorId: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "PENDING" },
      data: { verifiedStatus: "VERIFIED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently pending review");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_APPROVED",
        reason: undefined,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async reject(
    adminId: string,
    vendorId: string,
    reason: string,
  ): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "PENDING" },
      data: { verifiedStatus: "REJECTED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently pending review");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_REJECTED",
        reason,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async resubmit(vendorId: string): Promise<User> {
    const vendor = await this.prisma.user.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException("User not found");

    if (vendor.verifiedStatus !== "REJECTED") {
      return vendor; // idempotent no-op: already PENDING or VERIFIED
    }

    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "REJECTED" },
      data: { verifiedStatus: "PENDING" },
    });
    if (result.count === 1) {
      await this.prisma.adminAuditLog.create({
        data: {
          targetId: vendorId,
          actorId: vendorId, // self-service action; there is no admin actor for a resubmit
          action: "VENDOR_RESUBMITTED",
          reason: undefined,
        },
      });
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
