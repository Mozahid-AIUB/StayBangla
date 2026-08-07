import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import {
  BookingMaintenanceService,
  SweepResult,
} from "./booking-maintenance.service";

/** The header an external scheduler sends its shared secret in. */
export const CRON_SECRET_HEADER = "x-cron-secret";

/**
 * The endpoint an external scheduler calls to run the booking sweeps.
 *
 * No auth guard, like the SSLCommerz IPN route beside it — a cron has no user
 * and no JWT to present. That makes the shared secret the only thing standing
 * between the open internet and a route that cancels bookings, so it is
 * checked before anything else runs.
 *
 * Version-neutral: this is not part of the versioned public API, and pinning
 * it to /v1 would mean a scheduler's URL breaking on a version bump it has no
 * stake in.
 *
 * Hidden from the OpenAPI document. Nobody integrates against it, and
 * publishing the path only helps someone looking for it.
 */
@ApiExcludeController()
@Controller({ path: "internal/bookings", version: VERSION_NEUTRAL })
export class BookingMaintenanceController {
  constructor(
    private readonly maintenance: BookingMaintenanceService,
    private readonly config: ConfigService,
  ) {}

  @Post("sweep")
  @HttpCode(200)
  async sweep(
    @Headers(CRON_SECRET_HEADER) provided?: string,
  ): Promise<SweepResult> {
    this.assertAuthorised(provided);
    return this.maintenance.runAll();
  }

  /**
   * Rejects unless the caller presents the configured secret.
   *
   * Two refusals, deliberately different. An unset secret is a deployment
   * mistake, and answering 503 says so — silently leaving the route open
   * because nobody configured it is how a cancel-everything endpoint ends up
   * on the public internet. A wrong secret is 403.
   *
   * timingSafeEqual rather than `===`. String comparison stops at the first
   * differing byte, so the time it takes leaks how much of the secret was
   * right, and an attacker can rebuild it one character at a time. Lengths are
   * compared first because timingSafeEqual throws on a mismatch — that check
   * leaks only the length, which is not the secret.
   */
  private assertAuthorised(provided?: string): void {
    const expected = this.config.get<string>("CRON_SECRET");
    if (!expected) {
      throw new ServiceUnavailableException(
        "Scheduled maintenance is not configured",
      );
    }
    if (!provided || provided.length !== expected.length) {
      throw new ForbiddenException();
    }
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      throw new ForbiddenException();
    }
  }
}
