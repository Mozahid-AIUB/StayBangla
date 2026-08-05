import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { RequestUser } from "../strategies/jwt-access.strategy";

/**
 * Rejects the request when the caller's account is currently suspended.
 *
 * Always re-reads `suspendedAt` from the database rather than trusting the
 * JWT access-token claim (JwtAccessStrategy.validate() never re-reads the
 * DB), so a suspension takes effect on the very next request instead of
 * waiting out the token's remaining lifetime (up to JWT_ACCESS_EXPIRES_IN,
 * default 15m). Apply alongside JwtAuthGuard on authenticated,
 * state-changing routes — it is not a substitute for JwtAuthGuard, since it
 * assumes request.user is already populated.
 *
 * This intentionally sits ALONGSIDE the suspension checks already present in
 * some services (e.g. HotelsService.create, RoomsService.create/update,
 * BookingsService.createBooking/createOfflineBooking/createBlock), not in
 * place of them: those checks are correct today and removing them would
 * only re-introduce the convention-dependent seam this guard exists to
 * close for every OTHER (and future) write path. A little duplicated logic
 * is the accepted cost of defence in depth here.
 */
@Injectable()
export class SuspensionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: RequestUser }>();

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { suspendedAt: true },
    });

    if (user?.suspendedAt) {
      throw new ForbiddenException(
        "Your account is suspended and cannot perform this action",
      );
    }

    return true;
  }
}
