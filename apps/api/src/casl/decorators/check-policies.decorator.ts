import { SetMetadata } from "@nestjs/common";
import type { AppAbility } from "../casl-ability.factory";
import type { RequestUser } from "../../auth/strategies/jwt-access.strategy";

export type PolicyHandler = (
  ability: AppAbility,
  request: { user: RequestUser },
) => boolean;
export const CHECK_POLICIES_KEY = "check_policy";
export const CheckPolicies = (
  ...handlers: PolicyHandler[]
): ReturnType<typeof SetMetadata> => SetMetadata(CHECK_POLICIES_KEY, handlers);
