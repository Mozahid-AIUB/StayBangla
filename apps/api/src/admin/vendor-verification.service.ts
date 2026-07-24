import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { User, VendorVerificationLog } from "@prisma/client";
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
    await this.prisma.vendorVerificationLog.create({
      data: { vendorId, adminId, action: "VERIFIED", reason: undefined },
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
    await this.prisma.vendorVerificationLog.create({
      data: { vendorId, adminId, action: "REJECTED", reason },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async getHistory(vendorId: string): Promise<VendorVerificationLog[]> {
    return this.prisma.vendorVerificationLog.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
    });
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
      await this.prisma.vendorVerificationLog.create({
        data: {
          vendorId,
          adminId: vendorId, // self-service action; there is no admin actor for a resubmit
          action: "PENDING",
          reason: undefined,
        },
      });
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
