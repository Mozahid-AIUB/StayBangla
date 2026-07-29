import { Module } from "@nestjs/common";
import { VendorVerificationService } from "./vendor-verification.service";
import { VendorVerificationController } from "./vendor-verification.controller";
import { CommissionController } from "./commission.controller";

@Module({
  controllers: [VendorVerificationController, CommissionController],
  providers: [VendorVerificationService],
  exports: [VendorVerificationService],
})
export class AdminModule {}
