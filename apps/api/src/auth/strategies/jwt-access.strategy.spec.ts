import { ConfigService } from "@nestjs/config";
import { JwtAccessStrategy } from "./jwt-access.strategy";

describe("JwtAccessStrategy", () => {
  it("validate() maps the JWT payload to a request-user shape", async () => {
    const config = { get: () => "a".repeat(32) } as unknown as ConfigService;
    const strategy = new JwtAccessStrategy(config);

    const result = await strategy.validate({ sub: "u1", roles: ["TRAVELER"] });

    expect(result).toEqual({ id: "u1", roles: ["TRAVELER"] });
  });
});
