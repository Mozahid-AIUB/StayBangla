import {
  Body,
  Controller,
  Logger,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

interface SslcommerzIpnBody {
  tran_id: string;
  val_id: string;
  status: string;
}

@Controller({ path: "payments/sslcommerz", version: VERSION_NEUTRAL })
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("ipn")
  async handleIpn(
    @Body() body: SslcommerzIpnBody,
  ): Promise<{ status: string }> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { gatewayTranId: body.tran_id },
      });
      if (booking) {
        await this.bookingsService.confirmIfValid(booking.id, body.val_id);
      } else {
        this.logger.warn(
          `IPN received for unknown tran_id=${body.tran_id} — no matching booking`,
        );
      }
    } catch (error) {
      // Always ack SSLCommerz with 200 regardless of internal outcome — a
      // non-200 causes SSLCommerz to retry indefinitely, which is only
      // useful for a transient failure, not a permanently-invalid IPN. Log
      // and move on; confirmIfValid's own guards mean a rejected/invalid
      // IPN simply doesn't confirm anything, which is the correct outcome.
      this.logger.error(
        `Error processing SSLCommerz IPN for tran_id=${body.tran_id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return { status: "ok" };
  }
}
