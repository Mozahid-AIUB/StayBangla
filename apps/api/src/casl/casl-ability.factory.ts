import { Injectable } from "@nestjs/common";
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
  ExtractSubjectType,
  InferSubjects,
} from "@casl/ability";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";

// CASL only recognizes __caslSubjectType__/kind/__typename as tag fields on a
// plain interface (see @casl/ability's TaggedInterface) — this is what lets
// InferSubjects resolve the "User" string subject type below.
interface UserSubject {
  __caslSubjectType__: "User";
  id: string;
}

export type AppSubjects = InferSubjects<UserSubject> | "all";
export type AppAbility = MongoAbility<[string, AppSubjects]>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: RequestUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN")) {
      can("read", "User");
      can("update", "User");
    } else {
      can("read", "User", { id: user.id });
      can("update", "User", { id: user.id });
    }

    return build({
      detectSubjectType: (subject) =>
        (subject as UserSubject)
          .__caslSubjectType__ as ExtractSubjectType<AppSubjects>,
    });
  }
}
