import { Module } from "@nestjs/common";
import { BookingsModule } from "../bookings/bookings.module";
import { VendorDashboardController } from "./vendor-dashboard.controller";
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";

@Module({
  imports: [BookingsModule],
  controllers: [VendorDashboardController],
  providers: [VendorDashboardService, VendorLedgerService],
})
export class VendorDashboardModule {}
