import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CaslAbilityFactory } from "./casl-ability.factory";
import {
  CHECK_POLICIES_KEY,
  PolicyHandler,
} from "./decorators/check-policies.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caslAbilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers =
      this.reflector.get<PolicyHandler[] | undefined>(
        CHECK_POLICIES_KEY,
        context.getHandler(),
      ) ?? [];
    const request = context.switchToHttp().getRequest<{ user: RequestUser }>();
    const ability = this.caslAbilityFactory.createForUser(request.user);

    const allowed = handlers.every((handler) => handler(ability, request));
    if (!allowed) {
      throw new ForbiddenException(
        "You do not have permission to perform this action",
      );
    }
    return true;
  }
}
