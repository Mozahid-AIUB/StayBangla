import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface RequestUser {
  id: string;
  roles: string[];
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Non-null: env.validation.ts requires JWT_ACCESS_SECRET (min 32 chars, no
      // default), so the app never boots without it — this reflects that invariant.
      secretOrKey: config.get<string>("JWT_ACCESS_SECRET")!,
    });
  }

  async validate(payload: {
    sub: string;
    roles: string[];
  }): Promise<RequestUser> {
    return { id: payload.sub, roles: payload.roles };
  }
}
