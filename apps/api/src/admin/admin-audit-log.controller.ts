import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  AdminAuditLogService,
  AuditLogResult,
} from "./admin-audit-log.service";
import { AuditLogQueryDto } from "./dto/audit-log-query.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/audit-log")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminAuditLogController {
  constructor(private readonly auditLogService: AdminAuditLogService) {}

  @ApiOperation({
    summary:
      "List admin actions (ADMIN/SUPER_ADMIN only) — filter by vendor, by admin, or view the full platform feed",
  })
  @ApiResponse({ status: 200, description: "Paginated audit log entries." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogResult> {
    return this.auditLogService.list({
      vendorId: query.vendorId,
      adminId: query.adminId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
