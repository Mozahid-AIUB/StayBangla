import { Module } from "@nestjs/common";
import { VendorVerificationService } from "./vendor-verification.service";
import { VendorVerificationController } from "./vendor-verification.controller";
import { CommissionController } from "./commission.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { VendorSuspensionController } from "./vendor-suspension.controller";
import { AdminAuditLogService } from "./admin-audit-log.service";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminOverviewService } from "./admin-overview.service";
import { AdminOverviewController } from "./admin-overview.controller";
import { VendorListController } from "./vendor-list.controller";

@Module({
  controllers: [
    VendorVerificationController,
    CommissionController,
    VendorSuspensionController,
    AdminAuditLogController,
    AdminOverviewController,
    VendorListController,
  ],
  providers: [
    VendorVerificationService,
    VendorSuspensionService,
    AdminAuditLogService,
    AdminOverviewService,
  ],
  exports: [VendorVerificationService],
})
export class AdminModule {}
