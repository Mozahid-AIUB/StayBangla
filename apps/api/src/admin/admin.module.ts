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
import { AdminBookingService } from "./admin-booking.service";
import { AdminBookingController } from "./admin-booking.controller";
import { TravelerSuspensionController } from "./traveler-suspension.controller";
import { TravelerListController } from "./traveler-list.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AdminAnalyticsController } from "./admin-analytics.controller";

@Module({
  controllers: [
    VendorVerificationController,
    CommissionController,
    VendorSuspensionController,
    AdminAuditLogController,
    AdminOverviewController,
    VendorListController,
    AdminBookingController,
    TravelerSuspensionController,
    TravelerListController,
    AdminAnalyticsController,
  ],
  providers: [
    VendorVerificationService,
    VendorSuspensionService,
    AdminAuditLogService,
    AdminOverviewService,
    AdminBookingService,
    AdminAnalyticsService,
  ],
  exports: [VendorVerificationService],
})
export class AdminModule {}
