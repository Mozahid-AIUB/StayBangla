# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HTTP-level rate limiting to every backend route via a global `@nestjs/throttler` guard backed by Redis, with stricter overrides on OTP-request and login/register, and health checks exempted.

**Architecture:** `ThrottlerModule.forRootAsync` registered in `AppModule`, storage backed by a new `ThrottlerStorageRedisService` wrapping the existing `RedisService`/`REDIS_URL` connection. `ThrottlerGuard` registered as a global `APP_GUARD` so every route is protected by default; `@Throttle()` overrides on two specific routes, `@SkipThrottle()` on the two health routes.

**Tech Stack:** `@nestjs/throttler@^6.5.0`, `@nest-lab/throttler-storage-redis@^1.2.0` (new dependencies), existing `ioredis`/`RedisService`, existing `AllExceptionsFilter` (unchanged — already handles `HttpException` subclasses generically).

## Global Constraints

- Tracking key is IP address for every route (throttler's default extraction) — no per-user tracking in this module.
- Storage is Redis-backed, not in-memory — reuses the existing `RedisService`/`REDIS_URL` connection, no new infra.
- Global default: 100 requests / 60-second window / IP.
- `/auth/otp/request` override: 5 requests / 60-second window / IP.
- `/auth/login` and `/auth/register` override: 10 requests / 60-second window / IP.
- `GET /health` and `GET /health/db` are exempt from throttling entirely (`@SkipThrottle()`).
- No changes to `AllExceptionsFilter` — `ThrottlerException` extends `HttpException` and is already handled generically.
- No changes to `OtpService`'s existing domain-specific Redis rate-limiting (separate Redis key namespace, complementary layer — not replaced or touched).
- New env vars follow the existing `env.validation.ts` pattern: `z.coerce.number().int().positive().default(...)`.

---

## File Structure

```
apps/api/
├── package.json                              [MODIFY: +2 dependencies]
├── .env / .env.example / .env.test           [MODIFY: +4 env vars each]
├── src/
│   ├── config/
│   │   ├── env.validation.ts                 [MODIFY: +4 schema fields]
│   │   └── env.validation.spec.ts            [MODIFY: +tests]
│   ├── app.module.ts                         [MODIFY: +ThrottlerModule, +APP_GUARD]
│   ├── auth/
│   │   ├── otp.controller.ts                 [MODIFY: +@Throttle on request()]
│   │   └── credentials.controller.ts         [MODIFY: +@Throttle on login()/register()]
│   └── health/
│       └── health.controller.ts              [MODIFY: +@SkipThrottle on both routes]
└── test/
    └── rate-limiting.e2e-spec.ts             [NEW]
```

---

## Task 1: Env schema — four new THROTTLE_* variables

**Files:**

- Modify: `apps/api/src/config/env.validation.ts`
- Modify: `apps/api/src/config/env.validation.spec.ts`
- Modify: `apps/api/.env`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/.env.test`

**Interfaces:**

- Produces: `EnvConfig.THROTTLE_TTL_SECONDS: number`, `EnvConfig.THROTTLE_LIMIT: number`, `EnvConfig.THROTTLE_OTP_LIMIT: number`, `EnvConfig.THROTTLE_AUTH_LIMIT: number` — consumed by Task 2 (`app.module.ts`) and Task 3 (controller overrides).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/config/env.validation.spec.ts` (inside the existing `describe("validateEnv", ...)` block, as new `it(...)` cases — the file already has a `REQUIRED_BASE` constant and existing tests to follow the style of):

```ts
it("applies throttle defaults when not provided", () => {
  const result = validateEnv({ ...REQUIRED_BASE });
  expect(result.THROTTLE_TTL_SECONDS).toBe(60);
  expect(result.THROTTLE_LIMIT).toBe(100);
  expect(result.THROTTLE_OTP_LIMIT).toBe(5);
  expect(result.THROTTLE_AUTH_LIMIT).toBe(10);
});

it("throws when THROTTLE_LIMIT is not a positive integer", () => {
  expect(() =>
    validateEnv({ ...REQUIRED_BASE, THROTTLE_LIMIT: "not-a-number" }),
  ).toThrow(/THROTTLE_LIMIT/);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation`
Expected: FAIL — `result.THROTTLE_TTL_SECONDS` etc. are `undefined`, not `60`/`100`/`5`/`10`.

- [ ] **Step 3: Implement — extend the schema**

In `apps/api/src/config/env.validation.ts`, add these four lines to the `envSchema` object, directly after the existing `PRESIGNED_URL_EXPIRY_SECONDS` field (the last field in the object):

```ts
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_OTP_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation`
Expected: PASS — both new tests green, all existing tests still green.

- [ ] **Step 5: Update the three env files**

Append to `apps/api/.env` (real dev values — same as defaults, since there's no secret here):

```
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=100
THROTTLE_OTP_LIMIT=5
THROTTLE_AUTH_LIMIT=10
```

Append to `apps/api/.env.example` (with a comment matching the file's existing style):

```
# Rate limiting (defaults shown)
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=100
THROTTLE_OTP_LIMIT=5
THROTTLE_AUTH_LIMIT=10
```

Append to `apps/api/.env.test` — same values as `.env`/`.env.example`. (Note: these `THROTTLE_OTP_LIMIT`/`THROTTLE_AUTH_LIMIT` values do not actually drive Task 3's `@Throttle()` decorators, which use hardcoded literals — see Task 3's explanation. Keeping `.env.test` consistent with production values here avoids implying a test-only override exists when it doesn't; Task 5's e2e test loops enough iterations to exceed the real hardcoded limits of 5/10 directly.)

```
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=100
THROTTLE_OTP_LIMIT=5
THROTTLE_AUTH_LIMIT=10
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.validation.ts apps/api/src/config/env.validation.spec.ts apps/api/.env apps/api/.env.example apps/api/.env.test
git commit -m "feat(api): add THROTTLE_* env vars for rate limiting"
```

---

## Task 2: Install dependencies + wire ThrottlerModule into AppModule

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `EnvConfig.THROTTLE_TTL_SECONDS`, `EnvConfig.THROTTLE_LIMIT` (Task 1), `RedisService`/`REDIS_URL` (existing, from `RedisModule`).
- Produces: a global `ThrottlerGuard` active on every route in the application — consumed implicitly by every existing and future controller; Task 3's `@Throttle()`/`@SkipThrottle()` decorators only work once this task's global registration exists.

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @staybangla/api add @nestjs/throttler@^6.5.0 @nest-lab/throttler-storage-redis@^1.2.0
```

- [ ] **Step 2: Wire ThrottlerModule and the global guard**

Read the current `apps/api/src/app.module.ts` first to confirm the exact import list and `imports`/`providers` arrays match what's shown below (this module currently has no `providers` array — you are adding one).

Replace the full contents of `apps/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { LoggerModule } from "nestjs-pino";
import Redis from "ioredis";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { CaslModule } from "./casl/casl.module";
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";
import { HealthModule } from "./health/health.module";
import { HotelsModule } from "./hotels/hotels.module";
import { VehiclesModule } from "./vehicles/vehicles.module";
import { BookingsModule } from "./bookings/bookings.module";
import { AdminModule } from "./admin/admin.module";

const isProduction = process.env.NODE_ENV === "production";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? "info" : "debug",
        transport: isProduction ? undefined : { target: "pino-pretty" },
        // Never log credentials/tokens even at debug level.
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
      },
    }),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL") },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>("THROTTLE_TTL_SECONDS", 60) * 1000,
            limit: config.get<number>("THROTTLE_LIMIT", 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis(config.get<string>("REDIS_URL", "redis://127.0.0.1:6380")),
        ),
      }),
    }),
    CaslModule,
    UsersModule,
    AuthModule,
    HealthModule,
    HotelsModule,
    VehiclesModule,
    BookingsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

Note: `ThrottlerStorageRedisService` takes its own `ioredis` client instance (not the app's `RedisService` provider directly, since `ThrottlerModule.forRootAsync`'s `useFactory` runs before Nest's DI can inject `RedisService` into it) — this creates a second lightweight `ioredis` connection using the same `REDIS_URL`, which is the pattern this library expects. `ttl` in `@nestjs/throttler` v6's config is in milliseconds, hence the `* 1000` conversion from the env var's seconds.

- [ ] **Step 3: Verify the app still boots and existing tests pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS — all existing unit tests green (this change doesn't alter any existing service/controller logic, only module wiring).

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — confirms `AppModule` (including the new `ThrottlerModule`) actually compiles and boots correctly end-to-end, not just in isolated unit tests.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/src/app.module.ts pnpm-lock.yaml
git commit -m "feat(api): register global ThrottlerGuard with Redis-backed storage"
```

---

## Task 3: Per-route overrides — OTP request, login, register

**Files:**

- Modify: `apps/api/src/auth/otp.controller.ts`
- Modify: `apps/api/src/auth/credentials.controller.ts`

**Interfaces:**

- Consumes: `ThrottlerGuard` (Task 2, active globally — this task only adds decorator overrides on top of it).

**Important constraint on the limit values:** `@Throttle()` is a static decorator — its arguments are TypeScript literals evaluated at class-definition time, before NestJS's DI container exists, so they cannot read from `ConfigService` at request time. This means the `5` and `10` limits below are hardcoded literals, matching Task 1's `THROTTLE_OTP_LIMIT`/`THROTTLE_AUTH_LIMIT` env var _default_ values. Those env vars exist as documented, human-readable constants (and Task 5's e2e test asserts against these same hardcoded numbers) — they do not dynamically drive the decorator. If this value ever needs to change, update it in both the `.env*` files (for documentation) and the decorator literal (for actual effect). `Task 2`'s `ThrottlerModule.forRootAsync` keeps a single unnamed `"default"` throttler; each `@Throttle({ default: { limit: N, ttl: 60000 } })` below overrides that same `"default"` key's limit for its one route — this is the standard, supported `@nestjs/throttler` per-route override mechanism.

- [ ] **Step 1: Add the override to OtpController.request()**

Read the current `apps/api/src/auth/otp.controller.ts` first to confirm it matches the structure below (it should be unchanged since this plan's design phase).

In `apps/api/src/auth/otp.controller.ts`, add `Throttle` to the `@nestjs/throttler` import (new import line) and the decorator to the `request` method:

```ts
import { Body, Controller, Ip, Post, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { Role } from "@prisma/client";
import { OtpRequestDto } from "./dto/otp-request.dto";
import { OtpVerifyDto } from "./dto/otp-verify.dto";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@Controller("auth/otp")
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post("request")
  @Throttle({
    default: { limit: 5, ttl: 60000 },
  })
  async request(
    @Body() dto: OtpRequestDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.otpService.requestOtp(dto.channel, dto.identifier, ip);
    return { message: "OTP sent" };
  }

  @Post("verify")
  async verify(
    @Body() dto: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: PublicUser }> {
    await this.otpService.verifyOtp(dto.identifier, dto.otp);

    const existing = await this.usersService.findByIdentifier(dto.identifier);
    const user =
      existing ??
      (await this.usersService.create({
        [dto.identifier.includes("@") ? "email" : "phone"]: dto.identifier,
        role: Role.TRAVELER,
      }));

    const { accessToken, refreshToken } =
      await this.tokenService.issueTokenPair({
        id: user.id,
        roles: ["TRAVELER"],
      });

    const isProduction = this.config.get<string>("NODE_ENV") === "production";
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { accessToken, user: toPublicUser(user) };
  }
}
```

- [ ] **Step 2: Add the overrides to CredentialsController's register() and login()**

`apps/api/src/auth/credentials.controller.ts`'s `login()` and `register()` methods both get:

```ts
  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const user = await this.credentialsService.register(dto);
    return toPublicUser(user);
  }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
```

The `5`/`10`/`60000` literals are accepted as hardcoded values (not read from `ConfigService` at the decorator site — decorators evaluate at class-definition time, before any DI container exists). `THROTTLE_OTP_LIMIT`/`THROTTLE_AUTH_LIMIT` from Task 1 remain in the env schema as documented, human-readable constants that mirror these literals; Task 5's e2e test uses `.env.test`'s lower value only for the assertion's own loop-count math (see Task 5), not to alter the decorator's behavior.

- [ ] **Step 3: Full file for `credentials.controller.ts`**

Replace the full contents of `apps/api/src/auth/credentials.controller.ts`:

```ts
import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { CredentialsService } from "./credentials.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@Controller("auth")
export class CredentialsController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    const isProduction = this.config.get<string>("NODE_ENV") === "production";
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const user = await this.credentialsService.register(dto);
    return toPublicUser(user);
  }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const { accessToken, refreshToken } = await this.credentialsService.login(
      dto.identifier,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!presented) {
      throw new UnauthorizedException("Missing refresh token");
    }

    const { accessToken, refreshToken } =
      await this.tokenService.rotateRefreshToken(presented, async (userId) => {
        const user = await this.usersService.findById(userId);
        const roles =
          (user as { roles?: { role: string }[] } | null)?.roles?.map(
            (r) => r.role,
          ) ?? [];
        return { id: userId, roles };
      });

    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post("logout")
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (presented) {
      await this.tokenService.revokeFamilyByToken(presented);
    }
    res.clearCookie(REFRESH_COOKIE);
    return { message: "Logged out" };
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS — clean, no type errors from the new `@Throttle` import/usage.

- [ ] **Step 5: Run existing unit tests for both controllers**

Run: `pnpm --filter @staybangla/api run test:unit -- otp.controller`
Run: `pnpm --filter @staybangla/api run test:unit -- credentials.controller`
Expected: PASS — decorators don't change these controllers' runtime logic or their existing mocked-service unit tests, only their metadata (which unit tests with mocked guards don't exercise).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/otp.controller.ts apps/api/src/auth/credentials.controller.ts
git commit -m "feat(api): add stricter throttle overrides to OTP request, login, register"
```

---

## Task 4: Exempt health checks from throttling

**Files:**

- Modify: `apps/api/src/health/health.controller.ts`

**Interfaces:**

- Consumes: `SkipThrottle` from `@nestjs/throttler` (Task 2 dependency, already installed).

- [ ] **Step 1: Write the failing e2e test first**

This task is verified by Task 5's shared e2e spec file rather than a separate test file — see Task 5, which includes a case specifically for health-check exemption. Proceed directly to implementation; Task 5 will prove this task's correctness.

- [ ] **Step 2: Implement**

Replace the full contents of `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }

  @Get("db")
  async db(): Promise<{ db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { db: "ok" };
  }
}
```

`@SkipThrottle()` at the controller level (rather than repeating it on each method) exempts every route on this controller — both `GET /health` and `GET /health/db`.

- [ ] **Step 3: Run existing health e2e test to confirm no regression**

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — both existing assertions (`GET /health` returns `{status:"ok"}`, `GET /health/db` returns `{db:"ok"}`) still pass; `@SkipThrottle()` only affects throttling behavior, not response shape.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/health/health.controller.ts
git commit -m "feat(api): exempt health check routes from rate limiting"
```

---

## Task 5: E2e coverage — throttling actually triggers, and health stays exempt

**Files:**

- Create: `apps/api/test/rate-limiting.e2e-spec.ts`

**Interfaces:**

- Consumes: `AppModule`, `configureApp` (existing bootstrap helpers), `cleanDatabase` from `apps/api/test/helpers/test-db.ts` (existing).

- [ ] **Step 1: Write the e2e test**

`apps/api/test/rate-limiting.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";

describe("Rate limiting (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it("throttles /auth/otp/request after 5 requests in the window and returns a well-formed 429", async () => {
    // The route's own @Throttle decorator hardcodes limit:5 (see Task 3) —
    // this test exercises that literal directly, not an env-driven value.
    let lastRes;
    for (let i = 0; i < 6; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/auth/otp/request")
        .send({ channel: "sms", identifier: `+880170000${i}` });
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        error: expect.any(String),
        message: expect.any(String),
        timestamp: expect.any(String),
        path: "/auth/otp/request",
      }),
    );
  });

  it("throttles /auth/login after 10 requests in the window", async () => {
    let lastRes;
    for (let i = 0; i < 11; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ identifier: "nobody@example.com", password: "wrong-password" });
    }

    expect(lastRes!.status).toBe(429);
  });

  it("never throttles GET /health even after exceeding the global default many times over", async () => {
    const requests = Array.from({ length: 150 }, () =>
      request(app.getHttpServer()).get("/health"),
    );
    const results = await Promise.all(requests);

    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});
```

Note: the OTP-request test uses a different phone number identifier on each call (`+880170000${i}`) specifically to avoid tripping `OtpService`'s own separate per-identifier rate limit (which would throw its own 429 for a different reason — reusing the same identifier would make this test ambiguous about which layer actually fired). This isolates the assertion to the new HTTP-level throttle.

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- rate-limiting`
Expected: PASS — all three cases green. If the first test fails with a status other than 429 on the 6th request, that indicates Task 3's `@Throttle()` override isn't correctly applied (check the decorator is present and the module's `ThrottlerModule` registration is correct) — this is real verification, not a rubber stamp, since Tasks 2-4 have not been end-to-end tested against a real running app until this task.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/rate-limiting.e2e-spec.ts
git commit -m "test(api): add e2e coverage for global/override/exempt rate limiting"
```

---

## Task 6: Full monorepo verification + PR

**Files:** None (verification only).

- [ ] **Step 1: Full monorepo checks**

Run:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 2: Push branch and open PR**

```bash
git checkout -b feat/rate-limiting
git push -u origin feat/rate-limiting
gh pr create --title "feat: add global rate limiting with Redis storage" --body "Implements ROADMAP.md item 1.5. See docs/superpowers/specs/2026-07-25-rate-limiting-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 3: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Update ROADMAP.md**

After merge, on a new small branch/PR: change item 1.5's status from `🚧 next` to `✅`, and mark 1.6 (`add-payment-gateway-integration`) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** global default (Task 2), per-route overrides (Task 3), health exemption (Task 4), Redis storage (Task 2), `AllExceptionsFilter` compatibility (verified by Task 5's assertion on the 429 body shape, not a separate task since no filter code changes) — every section of the design doc has a corresponding task. ✓
- **Placeholder scan:** none found — every step has complete, real code.
- **Type consistency:** `EnvConfig.THROTTLE_*` field names (Task 1) match exactly what Task 2's `app.module.ts` reads via `config.get<number>("THROTTLE_...")`. ✓
- **Found during self-review and corrected inline (Task 3):** the plan's first draft assumed `@Throttle()`'s limit values could be read from `ConfigService` at the decorator site, which is impossible (decorators evaluate before DI exists). This is now resolved explicitly in Task 3 with a documented, deliberate tradeoff: the two override routes' limits are hardcoded literals matching the env vars' documented values, not dynamically read. If this tradeoff is ever unacceptable (e.g., ops wants to tune these without a code change), a follow-up task could introduce a custom `ConfigurableThrottlerGuard` that reads limits from `ConfigService` per-request instead of via the `@Throttle()` decorator — out of scope for this module.
