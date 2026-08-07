import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RedisService } from "./redis.service";

// The real client is replaced so this spec asserts what RedisService *asks*
// ioredis for, without opening a socket. What ioredis then does with a
// keyPrefix — including whether it rewrites the keys of the throttler's Lua
// script — is ioredis's behaviour, verified separately against a live server.
jest.mock("ioredis");

const RedisMock = Redis as unknown as jest.Mock;

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe("RedisService", () => {
  beforeEach(() => RedisMock.mockClear());

  const url = "rediss://default:secret@example.upstash.io:6379";

  it("namespaces every key when a prefix is configured", () => {
    new RedisService(configWith({ REDIS_URL: url, REDIS_KEY_PREFIX: "sb:" }));

    const [passedUrl, options] = RedisMock.mock.calls[0];
    expect(passedUrl).toBe(url);
    expect(options).toMatchObject({ keyPrefix: "sb:" });
  });

  // The default has to be "no prefix". The e2e helpers reach into Redis
  // directly and match on `otp:*` (test/helpers/test-redis.ts); a prefix
  // applied by default would stop those patterns matching, and the cleanup
  // would quietly do nothing while the suite still went green.
  it("adds no prefix by default", () => {
    new RedisService(configWith({ REDIS_URL: url }));

    const [, options] = RedisMock.mock.calls[0];
    expect(options?.keyPrefix ?? "").toBe("");
  });

  it("falls back to the local server when no URL is set", () => {
    new RedisService(configWith({}));

    expect(RedisMock.mock.calls[0][0]).toBe("redis://127.0.0.1:6380");
  });
});
