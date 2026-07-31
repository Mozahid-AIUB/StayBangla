import { ConflictException, Injectable } from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class VendorSuspensionService {
  constructor(private readonly prisma: PrismaService) {}

  async suspend(
    adminId: string,
    vendorId: string,
    reason: string,
  ): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, suspendedAt: null },
      data: { suspendedAt: new Date(), suspensionReason: reason },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is already suspended");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_SUSPENDED",
        reason,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async unsuspend(adminId: string, vendorId: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspensionReason: null },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently suspended");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_UNSUSPENDED",
        reason: undefined,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
