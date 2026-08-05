import { Injectable } from "@nestjs/common";
import { AdminAuditLog } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogFilter {
  vendorId?: string;
  adminId?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogResult {
  items: AdminAuditLog[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: AuditLogFilter): Promise<AuditLogResult> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const where: Record<string, string> = {};
    if (filter.vendorId) where.targetId = filter.vendorId;
    if (filter.adminId) where.actorId = filter.adminId;

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }
}
