import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Keys the throttle bucket by the request body's `identifier` field (the
 * phone/email an OTP request/verify targets) instead of the caller's IP.
 *
 * The default ThrottlerGuard tracks by IP only. For OTP request/verify that
 * is not enough on its own: IP rotation is cheap, but an attacker cannot
 * rotate the victim's phone number or email — it's fixed by definition of
 * the attack. Falls back to IP when the body has no identifier (defensive;
 * every route this guard is applied to validates identifier via DTO, so
 * this should not normally trigger) so the guard never throws attempting to
 * throttle a request it can't key.
 */
@Injectable()
export class IdentifierThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const identifier = (req?.body as { identifier?: string } | undefined)
      ?.identifier;
    if (typeof identifier === "string" && identifier.length > 0) {
      return `identifier:${identifier}`;
    }
    return super.getTracker(req);
  }
}
