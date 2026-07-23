import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RequestUser } from "../strategies/jwt-access.strategy";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    return request.user;
  },
);
