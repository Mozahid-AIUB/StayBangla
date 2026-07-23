import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";

@Injectable()
export class PasswordService {
  private readonly memoryCost: number;
  private readonly timeCost: number;

  constructor(configService: ConfigService) {
    this.memoryCost = configService.get<number>(
      "ARGON2_MEMORY_COST_KIB",
      19456,
    );
    this.timeCost = configService.get<number>("ARGON2_TIME_COST", 2);
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.memoryCost,
      timeCost: this.timeCost,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
