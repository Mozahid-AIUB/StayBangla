# API Versioning + Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NestJS URI versioning (`/v1/` prefix, with `/health` and the SSLCommerz IPN webhook exempted) and full Swagger/OpenAPI documentation (`@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth`/`@ApiProperty`) across every existing controller and DTO in `apps/api`.

**Architecture:** `app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" })` is added inside the shared `configureApp()` helper (used by both `main.ts` and every e2e test), so every route is versioned identically in production and tests with zero duplicated wiring. `HealthController` and `PaymentsController`'s IPN route get `@Version(VERSION_NEUTRAL)` to opt out. Every controller gets `@ApiTags`, every route gets `@ApiOperation`/`@ApiResponse`(/`@ApiBearerAuth` where guarded), every DTO field gets `@ApiProperty`/`@ApiPropertyOptional`. All ~64 HTTP call sites across 17 e2e-spec files are updated to the new `/v1/`-prefixed paths (except calls to `/health` and `/payments/sslcommerz/ipn`), plus one response-body path assertion in `rate-limiting.e2e-spec.ts` that must also gain the `/v1/` prefix since it echoes the real request URL.

**Tech Stack:** `@nestjs/swagger` (already installed), `@nestjs/common`'s built-in `VersioningType`/`VERSION_NEUTRAL`/`@Version()` (no new dependency).

## Global Constraints

- Every DTO's `@ApiProperty`/`@ApiPropertyOptional` example value must be realistic (a real-looking date string, a real-looking BDT minor-unit integer), never `"string"`/`0`/a placeholder.
- Every `@ApiResponse` status code must correspond to an exception the route's controller or service actually throws (or a guard actually produces) — read from existing `throw new XException(...)` call sites, never invented speculatively.
- `GET /health`, `GET /health/db`, and `POST /payments/sslcommerz/ipn` stay unversioned (`@Version(VERSION_NEUTRAL)`) — every other route gets `/v1/`.
- `SwaggerModule.setup()`'s mount path stays `api/docs` (unchanged, not versioned).
- No route path renames, no response-shape changes, no new endpoints — this plan only adds decorators/metadata and the version prefix.
- No `v2` of anything is created in this plan.
- Every task ends green on the full monorepo test suite relevant to its change before moving on.

---

## File Structure

```
apps/api/src/
├── main.ts                                          [MODIFY: DocumentBuilder polish, .addBearerAuth()]
├── bootstrap/configure-app.ts                        [MODIFY: app.enableVersioning(...)]
├── health/health.controller.ts                       [MODIFY: @Version(VERSION_NEUTRAL), @ApiTags, @ApiOperation]
├── bookings/payments.controller.ts                   [MODIFY: @Version(VERSION_NEUTRAL), @ApiTags, @ApiOperation]
├── auth/
│   ├── otp.controller.ts                             [MODIFY: @ApiTags, @ApiOperation, @ApiResponse]
│   ├── credentials.controller.ts                     [MODIFY: same]
│   └── dto/{login,otp-request,otp-verify,register}.dto.ts  [MODIFY: @ApiProperty]
├── users/
│   ├── users.controller.ts                           [MODIFY: @ApiTags, @ApiOperation, @ApiResponse, @ApiBearerAuth]
│   └── dto/update-profile.dto.ts                     [MODIFY: @ApiPropertyOptional]
├── hotels/
│   ├── hotels.controller.ts                          [MODIFY: same]
│   ├── rooms.controller.ts                            [MODIFY: same]
│   └── dto/{create-hotel,create-room,update-room,presign-photo,confirm-photo,search-available-rooms}.dto.ts [MODIFY]
├── vehicles/
│   ├── vehicles.controller.ts                         [MODIFY: same]
│   └── dto/{create-vehicle,update-vehicle,search-available-vehicles}.dto.ts [MODIFY]
├── bookings/
│   ├── bookings.controller.ts                         [MODIFY: same]
│   └── dto/{create-booking,create-block,cancel-booking}.dto.ts [MODIFY]
└── admin/
    ├── vendor-verification.controller.ts              [MODIFY: same]
    ├── commission.controller.ts                       [MODIFY: same]
    └── dto/{reject-vendor,update-commission}.dto.ts   [MODIFY]

apps/api/test/
├── health.e2e-spec.ts                                 [MODIFY: add missing configureApp(app) call, +2 assertions]
├── security.e2e-spec.ts                               [MODIFY: +1 Swagger-reachability assertion]
├── rate-limiting.e2e-spec.ts                           [MODIFY: /v1/ prefix on request paths AND the path: assertion]
├── auth-credentials.e2e-spec.ts                        [MODIFY: /v1/ prefix]
├── auth-otp.e2e-spec.ts                                [MODIFY: /v1/ prefix]
├── auth-refresh.e2e-spec.ts                            [MODIFY: /v1/ prefix]
├── rbac-casl.e2e-spec.ts                               [MODIFY: /v1/ prefix]
├── hotel-vehicle-detail.e2e-spec.ts                    [MODIFY: /v1/ prefix]
├── room-listing-photos.e2e-spec.ts                     [MODIFY: /v1/ prefix]
├── vendor-approval.e2e-spec.ts                         [MODIFY: /v1/ prefix]
├── admin-commission.e2e-spec.ts                        [MODIFY: /v1/ prefix]
├── booking-lifecycle.e2e-spec.ts                       [MODIFY: /v1/ prefix]
├── booking-ownership.e2e-spec.ts                       [MODIFY: /v1/ prefix]
├── booking-availability.e2e-spec.ts                    [MODIFY: /v1/ prefix]
├── booking-concurrency.e2e-spec.ts                     [MODIFY: /v1/ prefix]
├── booking-cancellation-policy.e2e-spec.ts             [MODIFY: /v1/ prefix]
└── payment-confirmation.e2e-spec.ts                    [MODIFY: /v1/ prefix, except the ipn/health calls]
```

---

## Task 1: Enable URI versioning + version-neutral exemptions

**Files:**

- Modify: `apps/api/src/bootstrap/configure-app.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/bookings/payments.controller.ts`
- Modify: `apps/api/test/health.e2e-spec.ts`

**Interfaces:**

- Produces: every route except `GET /health`, `GET /health/db`, `POST /payments/sslcommerz/ipn` now lives at `/v1/...` — every later task in this plan (decorator tasks, e2e path-migration tasks) depends on this being in place first.

- [ ] **Step 1: Add versioning to `configureApp`**

Replace the full contents of `apps/api/src/bootstrap/configure-app.ts`:

```ts
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { parseCorsOrigins } from "./parse-cors-origins";

// Shared by main.ts (real bootstrap) and e2e tests, so tests exercise the exact
// same hardening wiring that runs in production — no risk of the two drifting apart.
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigins = parseCorsOrigins(
    configService.get<string>("CORS_ORIGINS", "http://localhost:3000"),
  );

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
```

- [ ] **Step 2: Exempt `HealthController` from versioning**

Replace the full contents of `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

@Controller({ path: "health", version: VERSION_NEUTRAL })
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

- [ ] **Step 3: Exempt `PaymentsController`'s IPN webhook from versioning**

Replace the full contents of `apps/api/src/bookings/payments.controller.ts`:

```ts
import {
  Body,
  Controller,
  Logger,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

interface SslcommerzIpnBody {
  tran_id: string;
  val_id: string;
  status: string;
}

@Controller({ path: "payments/sslcommerz", version: VERSION_NEUTRAL })
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("ipn")
  async handleIpn(
    @Body() body: SslcommerzIpnBody,
  ): Promise<{ status: string }> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { gatewayTranId: body.tran_id },
      });
      if (booking) {
        await this.bookingsService.confirmIfValid(booking.id, body.val_id);
      } else {
        this.logger.warn(
          `IPN received for unknown tran_id=${body.tran_id} — no matching booking`,
        );
      }
    } catch (error) {
      // Always ack SSLCommerz with 200 regardless of internal outcome — a
      // non-200 causes SSLCommerz to retry indefinitely, which is only
      // useful for a transient failure, not a permanently-invalid IPN. Log
      // and move on; confirmIfValid's own guards mean a rejected/invalid
      // IPN simply doesn't confirm anything, which is the correct outcome.
      this.logger.error(
        `Error processing SSLCommerz IPN for tran_id=${body.tran_id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    return { status: "ok" };
  }
}
```

Note: only the `@Controller(...)` decorator's argument shape changed (from a plain string to `{ path, version }`); no other line in either file changes.

- [ ] **Step 4: Fix `health.e2e-spec.ts`'s missing `configureApp` call**

`health.e2e-spec.ts` is the only e2e spec in this codebase that does NOT call `configureApp(app)` — it only calls `app.init()` directly. This means versioning (and helmet, CORS, the exception filter) never actually applied to this specific test's app instance, silently drifting from what `main.ts` and every other e2e spec exercise. Since this task's whole point is proving `/health` correctly stays unversioned while the rest of the app becomes versioned, this file must call `configureApp` like every other spec does.

Replace the full contents of `apps/api/test/health.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";

describe("Health (e2e)", () => {
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
    await app.close();
  });

  it("GET /health returns 200 with status ok", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/db returns 200 when Postgres reachable", async () => {
    const res = await request(app.getHttpServer()).get("/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: "ok" });
  });

  it("GET /v1/health does NOT exist — health is version-neutral, not versioned", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — all 3 assertions green (the new one specifically proves `/v1/health` is NOT a valid path, confirming the version-neutral exemption is real, not accidental).

- [ ] **Step 6: Confirm the rest of the app is now versioned (quick manual check)**

Run: `pnpm --filter @staybangla/api run test:e2e -- security`
Expected: FAIL at this point — `security.e2e-spec.ts` calls `/health` (still fine, unversioned) but this confirms nothing else in the suite is touched yet. This is expected; Tasks 8+ will migrate the remaining e2e specs' paths. Do not attempt to fix other e2e specs in this task — that is explicitly out of scope here and handled by later tasks.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/configure-app.ts apps/api/src/health/health.controller.ts apps/api/src/bookings/payments.controller.ts apps/api/test/health.e2e-spec.ts
git commit -m "feat(api): enable URI versioning, exempt health check and IPN webhook"
```

---

## Task 2: Swagger bootstrap polish (title, description, bearer auth)

**Files:**

- Modify: `apps/api/src/main.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: a `.addBearerAuth()`-registered Swagger document — every later task's `@ApiBearerAuth()` decorator on a controller/route relies on this being registered here, or Swagger UI's "Authorize" button won't appear.

- [ ] **Step 1: Replace `main.ts`'s Swagger setup**

Replace the full contents of `apps/api/src/main.ts`:

```ts
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = new DocumentBuilder()
    .setTitle("StayBangla API")
    .setDescription(
      "StayBangla is a Bangladesh tourism-booking platform: hotel rooms, " +
        "vehicles, and (in progress) tour guides. This API serves traveler " +
        "booking flows, vendor listing management, SSLCommerz payment " +
        "confirmation, and admin verification/commission workflows.",
    )
    .setVersion("1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description:
        "Paste the accessToken returned by /v1/auth/login, /v1/auth/otp/verify, " +
        "or /v1/auth/refresh.",
    })
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, config),
  );

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
```

Note: `.setVersion("1.0")` here is the OpenAPI document's own version metadata (a Swagger/OpenAPI concept, describing this document, unrelated to the `/v1/` URI path prefix from Task 1) — not read from `package.json`, since `package.json`'s version is currently `"0.0.0"` (not yet meaningfully maintained) and conflating the two would tie unrelated concerns together. `1.0` reads correctly as "first version of this documented API."

- [ ] **Step 2: Verify the app still boots (Swagger document generation happens at boot)**

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — confirms `SwaggerModule.createDocument(app, config)` doesn't throw when generating a document from the (currently mostly undecorated) route table. This will keep passing as later tasks add decorators.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat(api): flesh out Swagger title/description and add JWT bearer auth"
```

---

## Task 3: `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` — Auth module

**Files:**

- Modify: `apps/api/src/auth/otp.controller.ts`
- Modify: `apps/api/src/auth/credentials.controller.ts`
- Modify: `apps/api/src/auth/dto/otp-request.dto.ts`
- Modify: `apps/api/src/auth/dto/otp-verify.dto.ts`
- Modify: `apps/api/src/auth/dto/login.dto.ts`
- Modify: `apps/api/src/auth/dto/register.dto.ts`

**Interfaces:**

- Consumes: Task 1/2's versioning + Swagger bootstrap (already in place; this task only adds decorators, no behavior change).
- Produces: nothing consumed by later tasks — each controller-family task in this plan is independent of the others (Tasks 3-7 can be done in any order relative to each other, only after Tasks 1-2).

- [ ] **Step 1: Decorate the OTP DTOs**

Replace the full contents of `apps/api/src/auth/dto/otp-request.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class OtpRequestDto {
  @ApiProperty({
    enum: ["sms", "email"],
    example: "sms",
    description: "Delivery channel for the one-time password.",
  })
  @IsIn(["sms", "email"])
  channel!: "sms" | "email";

  @ApiProperty({
    example: "+8801700000000",
    description:
      "Phone number (for channel=sms) or email address (for channel=email).",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;
}
```

Replace the full contents of `apps/api/src/auth/dto/otp-verify.dto.ts`:

```ts
import { IsNotEmpty, IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class OtpVerifyDto {
  @ApiProperty({
    example: "+8801700000000",
    description: "The same phone number or email the OTP was requested for.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    example: "123456",
    description: "The 6-digit one-time password received via SMS or email.",
  })
  @IsString()
  @Length(6, 6)
  otp!: string;
}
```

Replace the full contents of `apps/api/src/auth/dto/login.dto.ts`:

```ts
import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({
    example: "vendor@example.com",
    description: "Email address used at registration.",
  })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({
    example: "correct-horse-battery-staple",
    description: "Account password (vendor/guide/admin credential login).",
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
```

Replace the full contents of `apps/api/src/auth/dto/register.dto.ts`:

```ts
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "vendor@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: "correct-horse-battery-staple",
    minLength: 8,
    description: "Minimum 8 characters.",
  })
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: "Karim Hotel & Resorts" })
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({
    enum: ["VENDOR", "GUIDE"],
    example: "VENDOR",
    description:
      "Only VENDOR and GUIDE self-register; TRAVELER uses OTP, ADMIN/SUPER_ADMIN are created internally.",
  })
  @IsIn(["VENDOR", "GUIDE"])
  role!: "VENDOR" | "GUIDE";

  @ApiPropertyOptional({
    enum: ["HOTEL", "VEHICLE", "BOTH"],
    example: "HOTEL",
    description: "Required when role=VENDOR; ignored for role=GUIDE.",
  })
  @IsOptional()
  @IsIn(["HOTEL", "VEHICLE", "BOTH"])
  vendorType?: "HOTEL" | "VEHICLE" | "BOTH";
}
```

- [ ] **Step 2: Decorate `OtpController`**

Replace the full contents of `apps/api/src/auth/otp.controller.ts`:

```ts
import { Body, Controller, Ip, Post, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { Role } from "@prisma/client";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { OtpRequestDto } from "./dto/otp-request.dto";
import { OtpVerifyDto } from "./dto/otp-verify.dto";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@ApiTags("auth")
@Controller("auth/otp")
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  @ApiOperation({
    summary: "Request a one-time password",
    description:
      "Sends a 6-digit OTP via SMS or email to the given identifier. " +
      "Rate-limited to 5 requests/minute per IP on top of the OtpService's " +
      "own per-identifier cooldown.",
  })
  @ApiResponse({ status: 201, description: "OTP sent." })
  @ApiResponse({ status: 400, description: "Invalid channel or identifier." })
  @ApiTooManyRequestsResponse({
    description:
      "Too many OTP requests (5/min per IP, or per-identifier cooldown).",
  })
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

  @ApiOperation({
    summary: "Verify a one-time password and issue tokens",
    description:
      "On success, creates a new TRAVELER account if the identifier has " +
      "never been seen before, then issues an access token (returned in " +
      "the body) and a refresh token (set as an httpOnly cookie).",
  })
  @ApiResponse({ status: 201, description: "OTP verified; tokens issued." })
  @ApiResponse({ status: 400, description: "Incorrect OTP." })
  @ApiResponse({ status: 410, description: "OTP expired or never requested." })
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

- [ ] **Step 3: Decorate `CredentialsController`**

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
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { CredentialsService } from "./credentials.service";
import { TokenService } from "./token.service";
import { UsersService } from "../users/users.service";
import { toPublicUser, PublicUser } from "../users/to-public-user";

const REFRESH_COOKIE = "refreshToken";

@ApiTags("auth")
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

  @ApiOperation({
    summary: "Register a vendor or guide account",
    description:
      "Traveler accounts are never created here — they self-provision via OTP verify.",
  })
  @ApiResponse({
    status: 201,
    description: "Account created with verifiedStatus=PENDING.",
  })
  @ApiResponse({ status: 409, description: "Email already registered." })
  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const user = await this.credentialsService.register(dto);
    return toPublicUser(user);
  }

  @ApiOperation({
    summary: "Log in with email + password (vendor/guide/admin)",
  })
  @ApiResponse({
    status: 201,
    description: "Access token returned; refresh token set as httpOnly cookie.",
  })
  @ApiResponse({ status: 401, description: "Invalid credentials." })
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

  @ApiOperation({
    summary: "Rotate the refresh-token cookie and issue a new access token",
    description:
      "Reusing an already-rotated refresh token revokes its entire token family (reuse detection).",
  })
  @ApiResponse({
    status: 201,
    description: "New access token issued; refresh cookie rotated.",
  })
  @ApiResponse({
    status: 401,
    description: "Missing, expired, or reused refresh token.",
  })
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

  @ApiOperation({
    summary:
      "Log out — revokes the current refresh-token family and clears the cookie",
  })
  @ApiResponse({
    status: 201,
    description: "Logged out (idempotent — no error if already logged out).",
  })
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

- [ ] **Step 4: Run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS — zero errors (this task only adds decorators/imports, no logic changes).

Run: `pnpm --filter @staybangla/api run test:unit -- otp.controller credentials.controller`
Expected: PASS — existing unit tests for these controllers are untouched by this task and must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/otp.controller.ts apps/api/src/auth/credentials.controller.ts apps/api/src/auth/dto/otp-request.dto.ts apps/api/src/auth/dto/otp-verify.dto.ts apps/api/src/auth/dto/login.dto.ts apps/api/src/auth/dto/register.dto.ts
git commit -m "docs(api): add Swagger decorators to auth module"
```

---

## Task 4: `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` — Users module

**Files:**

- Modify: `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/users/dto/update-profile.dto.ts`

**Interfaces:**

- Consumes: Tasks 1-2 only. Independent of Task 3.

- [ ] **Step 1: Decorate `UpdateProfileDto`**

Replace the full contents of `apps/api/src/users/dto/update-profile.dto.ts`:

```ts
import { IsOptional, IsString, MinLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Karim Hotel & Resorts" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;
}
```

- [ ] **Step 2: Decorate `UsersController`**

Replace the full contents of `apps/api/src/users/users.controller.ts`:

```ts
import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/decorators/check-policies.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { UsersService } from "./users.service";
import { VendorVerificationService } from "../admin/vendor-verification.service";
import { toPublicUser, PublicUser } from "./to-public-user";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @ApiOperation({ summary: "Get the current authenticated user's profile" })
  @ApiResponse({
    status: 200,
    description: "The caller's own profile (passwordHash never included).",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async me(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const found = await this.usersService.findById(user.id);
    return toPublicUser(found!);
  }

  @ApiOperation({ summary: "Update the current authenticated user's profile" })
  @ApiResponse({ status: 200, description: "Updated profile." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @Patch("me")
  @UseGuards(JwtAuthGuard, PoliciesGuard)
  @CheckPolicies((ability, request) =>
    ability.can("update", { __caslSubjectType__: "User", id: request.user.id }),
  )
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const updated = await this.usersService.updateProfile(user.id, dto);
    return toPublicUser(updated);
  }

  @ApiOperation({
    summary: "Resubmit a previously-rejected vendor application",
    description:
      "Flips verifiedStatus back to PENDING so an admin can re-review it.",
  })
  @ApiResponse({
    status: 201,
    description: "Resubmitted; status is now PENDING.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description: "Only a REJECTED vendor can resubmit.",
  })
  @Post("me/resubmit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async resubmit(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const updated = await this.vendorVerificationService.resubmit(user.id);
    return toPublicUser(updated);
  }
}
```

- [ ] **Step 3: Run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @staybangla/api run test:unit -- users.controller`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/users/users.controller.ts apps/api/src/users/dto/update-profile.dto.ts
git commit -m "docs(api): add Swagger decorators to users module"
```

---

## Task 5: `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` — Hotels module

**Files:**

- Modify: `apps/api/src/hotels/hotels.controller.ts`
- Modify: `apps/api/src/hotels/rooms.controller.ts`
- Modify: `apps/api/src/hotels/dto/create-hotel.dto.ts`
- Modify: `apps/api/src/hotels/dto/create-room.dto.ts`
- Modify: `apps/api/src/hotels/dto/update-room.dto.ts`
- Modify: `apps/api/src/hotels/dto/presign-photo.dto.ts`
- Modify: `apps/api/src/hotels/dto/confirm-photo.dto.ts`
- Modify: `apps/api/src/hotels/dto/search-available-rooms.dto.ts`

**Interfaces:**

- Consumes: Tasks 1-2 only. Independent of Tasks 3-4.

- [ ] **Step 1: Decorate the Hotels/Rooms DTOs**

Replace the full contents of `apps/api/src/hotels/dto/create-hotel.dto.ts`:

```ts
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { District, FacilityCatalog } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateHotelDto {
  @ApiProperty({ example: "Cox's Bazar Beach Resort" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: District, example: "COXS_BAZAR" })
  @IsEnum(District)
  city!: District;

  @ApiProperty({ example: "Marine Drive Road, Kolatoli" })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({ example: "Beachfront resort with sea-view rooms." })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: FacilityCatalog,
    isArray: true,
    example: ["WIFI", "SWIMMING_POOL"],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(FacilityCatalog, { each: true })
  amenities?: FacilityCatalog[];

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiProperty({ example: "14:00" })
  @IsString()
  @IsNotEmpty()
  checkInTime!: string;

  @ApiProperty({ example: "11:00" })
  @IsString()
  @IsNotEmpty()
  checkOutTime!: string;
}
```

Replace the full contents of `apps/api/src/hotels/dto/create-room.dto.ts`:

```ts
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { BedType, RoomType } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateRoomDto {
  @ApiProperty({ enum: RoomType, example: "DOUBLE" })
  @IsEnum(RoomType)
  roomType!: RoomType;

  @ApiProperty({
    example: 500000,
    description: "Price per night in minor units (poisha).",
  })
  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  hasAC!: boolean;

  @ApiProperty({ enum: BedType, example: "DOUBLE" })
  @IsEnum(BedType)
  bedType!: BedType;

  @ApiPropertyOptional({ example: ["Sea view", "Balcony"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}
```

Replace the full contents of `apps/api/src/hotels/dto/update-room.dto.ts`:

```ts
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateRoomDto {
  @ApiPropertyOptional({
    example: 550000,
    description: "Price per night in minor units (poisha).",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerNightMinor?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

Replace the full contents of `apps/api/src/hotels/dto/presign-photo.dto.ts`:

```ts
import { IsIn } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class PresignPhotoDto {
  @ApiProperty({
    enum: ["image/jpeg", "image/png", "image/webp"],
    example: "image/jpeg",
  })
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}
```

Replace the full contents of `apps/api/src/hotels/dto/confirm-photo.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ConfirmPhotoDto {
  @ApiProperty({
    example: "hotels/abc123/photo-1.jpg",
    description: "The objectKey returned by the presign step.",
  })
  @IsString()
  objectKey!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
```

Replace the full contents of `apps/api/src/hotels/dto/search-available-rooms.dto.ts`:

```ts
import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableRoomsDto {
  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ enum: District, example: "DHAKA" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
```

- [ ] **Step 2: Decorate `HotelsController`**

Replace the full contents of `apps/api/src/hotels/hotels.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Hotel, HotelPhoto } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { HotelsService, HotelDetailResult } from "./hotels.service";
import { CreateHotelDto } from "./dto/create-hotel.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@ApiTags("hotels")
@Controller("hotels")
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @ApiOperation({ summary: "Get a hotel's public detail page" })
  @ApiResponse({
    status: 200,
    description: "Hotel detail with photos and active rooms.",
  })
  @ApiResponse({ status: 404, description: "Hotel not found." })
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<HotelDetailResult> {
    return this.hotelsService.findPublicDetailOrThrow(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a hotel listing (vendor only)" })
  @ApiResponse({ status: 201, description: "Hotel created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not a VENDOR, or is not yet verified.",
  })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateHotelDto,
  ): Promise<Hotel> {
    return this.hotelsService.create(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a presigned MinIO upload URL for a hotel photo",
    description:
      "Upload the file directly to uploadUrl, then call POST /:id/photos/confirm with the returned objectKey.",
  })
  @ApiResponse({ status: 201, description: "Presigned URL and objectKey." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel not found." })
  @Post(":id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.hotelsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirm a hotel photo upload after it lands in MinIO",
  })
  @ApiResponse({ status: 201, description: "Photo record created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({
    status: 404,
    description: "Hotel not found, or the object was never actually uploaded.",
  })
  @Post(":id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<HotelPhoto> {
    return this.hotelsService.confirmPhoto(
      user.id,
      id,
      dto.objectKey,
      dto.isPrimary ?? false,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a hotel photo" })
  @ApiResponse({ status: 200, description: "Photo deleted." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel or photo not found." })
  @Delete(":id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.hotelsService.deletePhoto(user.id, id, photoId);
  }
}
```

- [ ] **Step 3: Decorate `RoomsController`**

Replace the full contents of `apps/api/src/hotels/rooms.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Room, RoomPhoto } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { RoomsService } from "./rooms.service";
import { HotelsService, RoomAvailability } from "./hotels.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { SearchAvailableRoomsDto } from "./dto/search-available-rooms.dto";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

@ApiTags("hotels")
@Controller()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @ApiOperation({
    summary: "Search for available rooms across all hotels for a date range",
  })
  @ApiResponse({
    status: 200,
    description: "Rooms with no overlapping booking/block for the given dates.",
  })
  @ApiResponse({
    status: 400,
    description: "checkIn is not before checkOut, or a date is in the past.",
  })
  @Get("rooms/available")
  async available(
    @Query() query: SearchAvailableRoomsDto,
  ): Promise<RoomAvailability[]> {
    return this.hotelsService.searchAvailableRooms(
      query.checkIn,
      query.checkOut,
      query.city,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Add a room to a hotel (vendor only, must own the hotel)",
  })
  @ApiResponse({ status: 201, description: "Room created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this hotel." })
  @ApiResponse({ status: 404, description: "Hotel not found." })
  @Post("hotels/:hotelId/rooms")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<Room> {
    return this.roomsService.create(user.id, hotelId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a room's price or active status" })
  @ApiResponse({ status: 200, description: "Room updated." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room not found." })
  @Patch("rooms/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<Room> {
    return this.roomsService.update(user.id, id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a presigned MinIO upload URL for a room photo",
  })
  @ApiResponse({ status: 201, description: "Presigned URL and objectKey." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room not found." })
  @Post("rooms/:id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.roomsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Confirm a room photo upload after it lands in MinIO",
  })
  @ApiResponse({ status: 201, description: "Photo record created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({
    status: 404,
    description: "Room not found, or the object was never actually uploaded.",
  })
  @Post("rooms/:id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<RoomPhoto> {
    return this.roomsService.confirmPhoto(
      user.id,
      id,
      dto.objectKey,
      dto.isPrimary ?? false,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a room photo" })
  @ApiResponse({ status: 200, description: "Photo deleted." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({ status: 403, description: "Caller does not own this room." })
  @ApiResponse({ status: 404, description: "Room or photo not found." })
  @Delete("rooms/:id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.roomsService.deletePhoto(user.id, id, photoId);
  }
}
```

- [ ] **Step 4: Run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.controller rooms.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hotels/hotels.controller.ts apps/api/src/hotels/rooms.controller.ts apps/api/src/hotels/dto/create-hotel.dto.ts apps/api/src/hotels/dto/create-room.dto.ts apps/api/src/hotels/dto/update-room.dto.ts apps/api/src/hotels/dto/presign-photo.dto.ts apps/api/src/hotels/dto/confirm-photo.dto.ts apps/api/src/hotels/dto/search-available-rooms.dto.ts
git commit -m "docs(api): add Swagger decorators to hotels module"
```

---

## Task 6: `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` — Vehicles module

**Files:**

- Modify: `apps/api/src/vehicles/vehicles.controller.ts`
- Modify: `apps/api/src/vehicles/dto/create-vehicle.dto.ts`
- Modify: `apps/api/src/vehicles/dto/update-vehicle.dto.ts`
- Modify: `apps/api/src/vehicles/dto/search-available-vehicles.dto.ts`

**Interfaces:**

- Consumes: Tasks 1-2 only. Independent of Tasks 3-5, 7.

- [ ] **Step 1: Decorate the Vehicles DTOs**

Replace the full contents of `apps/api/src/vehicles/dto/create-vehicle.dto.ts`:

```ts
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateVehicleDto {
  @ApiProperty({ enum: ["CNG", "JEEP", "BOAT"], example: "JEEP" })
  @IsIn(["CNG", "JEEP", "BOAT"])
  category!: "CNG" | "JEEP" | "BOAT";

  @ApiProperty({ enum: District, example: "BANDARBAN" })
  @IsEnum(District)
  city!: District;

  @ApiPropertyOptional({ example: "Toyota Land Cruiser" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiProperty({
    example: 400000,
    description: "Price per day in minor units (poisha).",
  })
  @IsInt()
  @Min(1)
  pricePerDayMinor!: number;
}
```

Replace the full contents of `apps/api/src/vehicles/dto/update-vehicle.dto.ts`:

```ts
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateVehicleDto {
  @ApiPropertyOptional({
    example: 450000,
    description: "Price per day in minor units (poisha).",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerDayMinor?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

Replace the full contents of `apps/api/src/vehicles/dto/search-available-vehicles.dto.ts`:

```ts
import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SearchAvailableVehiclesDto {
  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ enum: District, example: "BANDARBAN" })
  @IsOptional()
  @IsEnum(District)
  city?: District;
}
```

- [ ] **Step 2: Decorate `VehiclesController`**

Replace the full contents of `apps/api/src/vehicles/vehicles.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Vehicle } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VehiclesService, VehicleAvailability } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { SearchAvailableVehiclesDto } from "./dto/search-available-vehicles.dto";

@ApiTags("vehicles")
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({
    summary:
      "Search for available vehicles across all vendors for a date range",
  })
  @ApiResponse({
    status: 200,
    description:
      "Vehicles with no overlapping booking/block for the given dates.",
  })
  @ApiResponse({
    status: 400,
    description: "startDate is not before endDate, or a date is in the past.",
  })
  @Get("available")
  async available(
    @Query() query: SearchAvailableVehiclesDto,
  ): Promise<VehicleAvailability[]> {
    return this.vehiclesService.searchAvailable(
      query.startDate,
      query.endDate,
      query.city,
    );
  }

  @ApiOperation({ summary: "Get a vehicle's public detail page" })
  @ApiResponse({ status: 200, description: "Vehicle detail." })
  @ApiResponse({ status: 404, description: "Vehicle not found." })
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<Vehicle> {
    return this.vehiclesService.findByIdOrThrow(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a vehicle listing (vendor only)" })
  @ApiResponse({ status: 201, description: "Vehicle created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not a VENDOR, or is not yet verified.",
  })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.create(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a vehicle's price or active status" })
  @ApiResponse({ status: 200, description: "Vehicle updated." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this vehicle.",
  })
  @ApiResponse({ status: 404, description: "Vehicle not found." })
  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.update(user.id, id, dto);
  }
}
```

- [ ] **Step 3: Run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @staybangla/api run test:unit -- vehicles.controller`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/vehicles/vehicles.controller.ts apps/api/src/vehicles/dto/create-vehicle.dto.ts apps/api/src/vehicles/dto/update-vehicle.dto.ts apps/api/src/vehicles/dto/search-available-vehicles.dto.ts
git commit -m "docs(api): add Swagger decorators to vehicles module"
```

---

## Task 7: `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` — Bookings + Payments + Admin modules

**Files:**

- Modify: `apps/api/src/bookings/bookings.controller.ts`
- Modify: `apps/api/src/bookings/dto/create-booking.dto.ts`
- Modify: `apps/api/src/bookings/dto/create-block.dto.ts`
- Modify: `apps/api/src/bookings/dto/cancel-booking.dto.ts`
- Modify: `apps/api/src/admin/vendor-verification.controller.ts`
- Modify: `apps/api/src/admin/commission.controller.ts`
- Modify: `apps/api/src/admin/dto/reject-vendor.dto.ts`
- Modify: `apps/api/src/admin/dto/update-commission.dto.ts`

**Interfaces:**

- Consumes: Tasks 1-2 only. Independent of Tasks 3-6.
- Note: `PaymentsController` (the IPN webhook) was already fully finished in Task 1 (it needed `@Version(VERSION_NEUTRAL)`, not Swagger decorators, since it's not meant to be called by any interactive Swagger UI client) — no further work on it in this task. Add `@ApiTags("payments")`/`@ApiExcludeEndpoint()` is explicitly NOT needed either; leaving it undecorated for Swagger is fine since it's a webhook, not a documented client-facing endpoint.

- [ ] **Step 1: Decorate the Bookings DTOs**

Replace the full contents of `apps/api/src/bookings/dto/create-booking.dto.ts`:

```ts
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateBookingDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  @ApiProperty({ example: "2026-09-01" })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: "2026-09-03" })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}
```

Replace the full contents of `apps/api/src/bookings/dto/create-block.dto.ts`:

```ts
import { IsDateString, IsIn, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateBlockDto {
  @ApiProperty({ enum: ["ROOM", "VEHICLE"], example: "ROOM" })
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @ApiProperty({ example: "8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e" })
  @IsUUID()
  bookableId!: string;

  @ApiProperty({ example: "2026-09-10" })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: "2026-09-15" })
  @IsDateString()
  endDate!: string;
}
```

Replace the full contents of `apps/api/src/bookings/dto/cancel-booking.dto.ts`:

```ts
import { IsBoolean, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class CancelBookingDto {
  @ApiPropertyOptional({
    example: true,
    description:
      "Required (must be true) to cancel a CONFIRMED+PAID booking — " +
      "acknowledges no refund will be issued. Not needed for a HELD booking.",
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeNoRefund?: boolean;
}
```

- [ ] **Step 2: Decorate `BookingsController`**

Replace the full contents of `apps/api/src/bookings/bookings.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { BookingsService } from "./bookings.service";
import { BookingRecord } from "./bookings.types";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { CreateBlockDto } from "./dto/create-block.dto";
import { CancelBookingDto } from "./dto/cancel-booking.dto";

@ApiTags("bookings")
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @ApiOperation({
    summary: "Create a HELD booking for a room or vehicle (traveler only)",
  })
  @ApiResponse({
    status: 201,
    description: "Booking created with status=HELD.",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid dates, or guestCount exceeds capacity.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 404,
    description: "Room or vehicle not found or inactive.",
  })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or vendor block.",
  })
  @Post("bookings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @ApiOperation({
    summary: "Start a SSLCommerz payment session for a HELD booking",
    description:
      "Redirect the traveler's browser to the returned gatewayUrl to complete payment.",
  })
  @ApiResponse({
    status: 201,
    description: "SSLCommerz gatewayUrl to redirect to.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this booking.",
  })
  @ApiResponse({ status: 404, description: "Booking not found." })
  @ApiResponse({ status: 409, description: "Booking is not in HELD state." })
  @Post("bookings/:id/initiate-payment")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async initiatePayment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ gatewayUrl: string }> {
    return this.bookingsService.initiatePayment(user.id, id);
  }

  @ApiOperation({ summary: "Get a booking's current payment status" })
  @ApiResponse({
    status: 200,
    description: "paymentStatus (PENDING/PAID/FAILED) and gatewayTranId.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this booking.",
  })
  @ApiResponse({ status: 404, description: "Booking not found." })
  @Get("bookings/:id/payment-status")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async getPaymentStatus(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<{ paymentStatus: string; gatewayTranId: string | null }> {
    return this.bookingsService.getPaymentStatus(user.id, id);
  }

  @ApiOperation({
    summary: "Mark a CONFIRMED booking as COMPLETED (vendor only)",
  })
  @ApiResponse({ status: 201, description: "Booking status is now COMPLETED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description:
      "Booking not found, not yours, or not in a checkout-eligible state.",
  })
  @Post("bookings/:id/checkout")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async checkout(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.checkout(user.id, id);
  }

  @ApiOperation({
    summary: "Cancel a booking",
    description:
      "A HELD booking cancels freely (no charge was ever completed). " +
      "A CONFIRMED+PAID booking forfeits the payment — no refund is " +
      "issued — and requires acknowledgeNoRefund: true in the body.",
  })
  @ApiResponse({ status: 201, description: "Booking status is now CANCELLED." })
  @ApiResponse({
    status: 400,
    description:
      "CONFIRMED+PAID cancellation attempted without acknowledgeNoRefund.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 409,
    description: "Booking not found, not yours, or not cancellable.",
  })
  @Post("bookings/:id/cancel")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: CancelBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.cancel(user.id, id, dto.acknowledgeNoRefund);
  }

  @ApiOperation({
    summary: "Block off dates on a vendor's own room or vehicle (vendor only)",
    description:
      "Used for maintenance/personal blackout dates, not a real booking — no traveler, no payment.",
  })
  @ApiResponse({
    status: 201,
    description: "Block created with status=BLOCKED.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this room/vehicle.",
  })
  @ApiResponse({ status: 404, description: "Room or vehicle not found." })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or block.",
  })
  @Post("vendor/blocks")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async createBlock(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBlockDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBlock(user.id, dto);
  }
}
```

- [ ] **Step 3: Decorate the Admin DTOs**

Replace the full contents of `apps/api/src/admin/dto/reject-vendor.dto.ts`:

```ts
import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RejectVendorDto {
  @ApiProperty({
    example: "Business registration document is illegible.",
    description:
      "Shown to the vendor and recorded in the verification history.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

Replace the full contents of `apps/api/src/admin/dto/update-commission.dto.ts`:

```ts
import { IsInt, Max, Min } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateCommissionDto {
  @ApiProperty({
    example: 12,
    minimum: 0,
    maximum: 100,
    description:
      "Platform's commission rate for this vendor, as a whole-number percent.",
  })
  @IsInt()
  @Min(0)
  @Max(100)
  commissionRatePercent!: number;
}
```

- [ ] **Step 4: Decorate `VendorVerificationController`**

Replace the full contents of `apps/api/src/admin/vendor-verification.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { VendorVerificationLog } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VendorVerificationService } from "./vendor-verification.service";
import { RejectVendorDto } from "./dto/reject-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorVerificationController {
  constructor(
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @ApiOperation({
    summary: "List vendors awaiting verification (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({
    status: 200,
    description: "Vendors with verifiedStatus=PENDING.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("pending")
  async listPending(): Promise<PublicUser[]> {
    const vendors = await this.vendorVerificationService.listPending();
    return vendors.map(toPublicUser);
  }

  @ApiOperation({
    summary: "Approve a pending vendor (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 201, description: "verifiedStatus is now VERIFIED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is not currently PENDING." })
  @Post(":id/approve")
  async approve(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const vendor = await this.vendorVerificationService.approve(admin.id, id);
    return toPublicUser(vendor);
  }

  @ApiOperation({
    summary: "Reject a pending vendor with a reason (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 201, description: "verifiedStatus is now REJECTED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is not currently PENDING." })
  @Post(":id/reject")
  async reject(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<PublicUser> {
    const vendor = await this.vendorVerificationService.reject(
      admin.id,
      id,
      dto.reason,
    );
    return toPublicUser(vendor);
  }

  @ApiOperation({
    summary:
      "Get a vendor's full verification history (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({
    status: 200,
    description: "Chronological approve/reject/resubmit log.",
  })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get(":id/history")
  async getHistory(@Param("id") id: string): Promise<VendorVerificationLog[]> {
    return this.vendorVerificationService.getHistory(id);
  }
}
```

- [ ] **Step 5: Decorate `CommissionController`**

Replace the full contents of `apps/api/src/admin/commission.controller.ts`:

```ts
import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { User } from "@prisma/client";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateCommissionDto } from "./dto/update-commission.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class CommissionController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary: "Set a vendor's platform commission rate (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Updated commissionRatePercent." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Patch(":id/commission")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateCommissionDto,
  ): Promise<Pick<User, "id" | "commissionRatePercent">> {
    return this.prisma.user.update({
      where: { id },
      data: { commissionRatePercent: dto.commissionRatePercent },
      select: { id: true, commissionRatePercent: true },
    });
  }
}
```

- [ ] **Step 6: Run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS.

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.controller vendor-verification.controller commission.controller`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bookings/bookings.controller.ts apps/api/src/bookings/dto/create-booking.dto.ts apps/api/src/bookings/dto/create-block.dto.ts apps/api/src/bookings/dto/cancel-booking.dto.ts apps/api/src/admin/vendor-verification.controller.ts apps/api/src/admin/commission.controller.ts apps/api/src/admin/dto/reject-vendor.dto.ts apps/api/src/admin/dto/update-commission.dto.ts
git commit -m "docs(api): add Swagger decorators to bookings and admin modules"
```

---

## Task 8: Migrate e2e specs — Auth + RBAC + Health/Security group

**Files:**

- Modify: `apps/api/test/auth-credentials.e2e-spec.ts`
- Modify: `apps/api/test/auth-otp.e2e-spec.ts`
- Modify: `apps/api/test/auth-refresh.e2e-spec.ts`
- Modify: `apps/api/test/rbac-casl.e2e-spec.ts`
- Modify: `apps/api/test/security.e2e-spec.ts`
- Modify: `apps/api/test/rate-limiting.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1 (versioning must already be live for these paths to resolve).

- [ ] **Step 1: Update every versioned HTTP call in the 4 auth/rbac e2e specs**

In each of `apps/api/test/auth-credentials.e2e-spec.ts`, `apps/api/test/auth-otp.e2e-spec.ts`, `apps/api/test/auth-refresh.e2e-spec.ts`, `apps/api/test/rbac-casl.e2e-spec.ts`: prepend `/v1` to every `request(app.getHttpServer()).<method>("/...")` call whose path does NOT start with `/health` or `/payments/sslcommerz`. Concretely: `.post("/auth/login")` → `.post("/v1/auth/login")`, `.post("/auth/otp/request")` → `.post("/v1/auth/otp/request")`, `.get("/users/me")` → `.get("/v1/users/me")`, `.patch("/users/me")` → `.patch("/v1/users/me")`, and so on for every call in these 4 files. Read each file first to find every call site — do not guess at what exists; grep for `request(app.getHttpServer())` within each file to enumerate them exhaustively before editing.

- [ ] **Step 2: Update `security.e2e-spec.ts`**

Read `apps/api/test/security.e2e-spec.ts` (it currently has 4 test cases, all using `/health` or a nonexistent route — neither needs a `/v1/` prefix, since `/health` stays version-neutral and `/this-route-does-not-exist` is deliberately not a real route in any version). Add one new test case confirming the Swagger docs page is still reachable:

```ts
it("Swagger docs remain reachable at their unversioned path", async () => {
  const res = await request(app.getHttpServer()).get("/api/docs");
  expect(res.status).toBe(200);
});
```

Add this as a new `it(...)` block inside the existing `describe("Security hardening (e2e)", ...)` block, after the last existing test.

- [ ] **Step 3: Update `rate-limiting.e2e-spec.ts` — request paths AND the response-body path assertion**

Replace the full contents of `apps/api/test/rate-limiting.e2e-spec.ts`:

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

  it("throttles /v1/auth/otp/request after 5 requests in the window and returns a well-formed 429", async () => {
    // The route's own @Throttle decorator hardcodes limit:5 (see Task 3) —
    // this test exercises that literal directly, not an env-driven value.
    let lastRes;
    for (let i = 0; i < 6; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/v1/auth/otp/request")
        .send({ channel: "sms", identifier: `+880170000${i}` });
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        error: expect.any(String),
        message: expect.any(String),
        timestamp: expect.any(String),
        path: "/v1/auth/otp/request",
      }),
    );
  });

  it("throttles /v1/auth/login after 10 requests in the window", async () => {
    let lastRes;
    for (let i = 0; i < 11; i += 1) {
      lastRes = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ identifier: "nobody@example.com", password: "wrong-password" });
    }

    expect(lastRes!.status).toBe(429);
  });

  it("never throttles GET /health even after exceeding the global default many times over", async () => {
    // 150 requests > the global 100/min default, proving @SkipThrottle() truly
    // exempts this route rather than just having a generous limit. Sent
    // strictly sequentially (one at a time) rather than concurrently — even
    // small concurrent batches (tried: 10-way) produced ECONNRESET on both a
    // local Windows dev machine and GitHub Actions' Linux CI runner, an infra
    // ceiling on simultaneous in-process supertest connections against a
    // single Nest test server, unrelated to the throttling behavior under
    // test. Sequential requests eliminate that ceiling entirely; the total
    // count exceeding the window's limit is what this test needs to prove,
    // not concurrency.
    const totalRequests = 150;
    for (let i = 0; i < totalRequests; i += 1) {
      const res = await request(app.getHttpServer()).get("/health");
      expect(res.status).toBe(200);
    }
  });
});
```

Note: `/health` in the third test is deliberately NOT prefixed — it stays version-neutral per Task 1.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- auth-credentials auth-otp auth-refresh rbac-casl security rate-limiting`
Expected: PASS — all 6 spec files green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/auth-credentials.e2e-spec.ts apps/api/test/auth-otp.e2e-spec.ts apps/api/test/auth-refresh.e2e-spec.ts apps/api/test/rbac-casl.e2e-spec.ts apps/api/test/security.e2e-spec.ts apps/api/test/rate-limiting.e2e-spec.ts
git commit -m "test(api): migrate auth/rbac/security/rate-limiting e2e specs to /v1/ paths"
```

---

## Task 9: Migrate e2e specs — Hotels/Vehicles/Vendor group

**Files:**

- Modify: `apps/api/test/hotel-vehicle-detail.e2e-spec.ts`
- Modify: `apps/api/test/room-listing-photos.e2e-spec.ts`
- Modify: `apps/api/test/vendor-approval.e2e-spec.ts`
- Modify: `apps/api/test/admin-commission.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1. Independent of Task 8.

- [ ] **Step 1: Update every HTTP call in these 4 files**

Read each file first (grep for `request(app.getHttpServer())` within each to enumerate every call site exhaustively), then prepend `/v1` to every path — `.post("/hotels")` → `.post("/v1/hotels")`, `.get("/vehicles/available")` → `.get("/v1/vehicles/available")`, `.patch("/admin/vendors/:id/commission")` → `.patch("/v1/admin/vendors/:id/commission")`, `.post("/admin/vendors/:id/approve")` → `.post("/v1/admin/vendors/:id/approve")`, and so on for every call across these 4 files. None of these files call `/health` or the IPN webhook, so every single HTTP call site in this group needs the prefix — there is no exception to check for within this group.

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- hotel-vehicle-detail room-listing-photos vendor-approval admin-commission`
Expected: PASS — all 4 spec files green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/hotel-vehicle-detail.e2e-spec.ts apps/api/test/room-listing-photos.e2e-spec.ts apps/api/test/vendor-approval.e2e-spec.ts apps/api/test/admin-commission.e2e-spec.ts
git commit -m "test(api): migrate hotels/vehicles/vendor-approval/admin-commission e2e specs to /v1/ paths"
```

---

## Task 10: Migrate e2e specs — Bookings + Payments group

**Files:**

- Modify: `apps/api/test/booking-lifecycle.e2e-spec.ts`
- Modify: `apps/api/test/booking-ownership.e2e-spec.ts`
- Modify: `apps/api/test/booking-availability.e2e-spec.ts`
- Modify: `apps/api/test/booking-concurrency.e2e-spec.ts`
- Modify: `apps/api/test/booking-cancellation-policy.e2e-spec.ts`
- Modify: `apps/api/test/payment-confirmation.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1. Independent of Tasks 8-9.

- [ ] **Step 1: Update every HTTP call in the 5 non-payment booking e2e specs**

Read `apps/api/test/booking-lifecycle.e2e-spec.ts`, `apps/api/test/booking-ownership.e2e-spec.ts`, `apps/api/test/booking-availability.e2e-spec.ts`, `apps/api/test/booking-concurrency.e2e-spec.ts`, `apps/api/test/booking-cancellation-policy.e2e-spec.ts` first (grep for `request(app.getHttpServer())` within each), then prepend `/v1` to every `.post("/bookings...")`, `.get("/bookings...")`, `.post("/vendor/blocks")`, `.post("/hotels")`, `.post("/hotels/:hotelId/rooms")` call in these 5 files. None of these files call the IPN webhook, so no exceptions to check for within them; `/health` also doesn't appear in these 5.

- [ ] **Step 2: Update `payment-confirmation.e2e-spec.ts` — this one HAS the exception**

Read `apps/api/test/payment-confirmation.e2e-spec.ts` first. Prepend `/v1` to every call EXCEPT the one that posts to `/payments/sslcommerz/ipn` — that call stays exactly as-is (unversioned, per Task 1). Concretely: `.post("/bookings")` → `.post("/v1/bookings")`, `.post("/bookings/:id/initiate-payment")` → `.post("/v1/bookings/:id/initiate-payment")`, `.get("/bookings/:id/payment-status")` → `.get("/v1/bookings/:id/payment-status")`, but `.post("/payments/sslcommerz/ipn")` is left untouched.

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- booking-lifecycle booking-ownership booking-availability booking-concurrency booking-cancellation-policy payment-confirmation`
Expected: PASS — all 6 spec files green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/booking-lifecycle.e2e-spec.ts apps/api/test/booking-ownership.e2e-spec.ts apps/api/test/booking-availability.e2e-spec.ts apps/api/test/booking-concurrency.e2e-spec.ts apps/api/test/booking-cancellation-policy.e2e-spec.ts apps/api/test/payment-confirmation.e2e-spec.ts
git commit -m "test(api): migrate booking and payment-confirmation e2e specs to /v1/ paths"
```

---

## Task 11: Full monorepo verification + PR

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

Expected: all green. `pnpm test` runs both unit and e2e for every package — this is the first point where ALL 17 e2e specs run together against the fully versioned app; watch specifically for any file missed in Tasks 8-10 (a leftover un-prefixed path would 404 against the new versioned app).

- [ ] **Step 2: Manually verify Swagger UI renders sensibly**

Run: `pnpm --filter @staybangla/api dev` (with Docker services up), then open `http://localhost:3001/api/docs` in a browser.
Expected: page loads, shows an "Authorize" button (JWT bearer), and routes are grouped under `auth`/`users`/`hotels`/`vehicles`/`bookings`/`admin` tags (not one flat alphabetical list) — confirming `@ApiTags` from Tasks 3-7 actually took effect. Close/stop the dev server afterward.

- [ ] **Step 3: Search for any remaining un-migrated e2e path**

Run: `grep -rn 'request(app.getHttpServer())' apps/api/test/*.e2e-spec.ts | grep -vE "/v1/|/health|/payments/sslcommerz|/api/docs|/this-route-does-not-exist"`
Expected: no output. Any line printed here is a call site Tasks 8-10 missed — fix it and re-run the full e2e suite before proceeding.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/api-versioning-docs
gh pr create --title "feat: add /v1/ API versioning and full Swagger documentation" --body "Implements ROADMAP.md item 1.7. See docs/superpowers/specs/2026-07-30-api-versioning-docs-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 5: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 6: Update ROADMAP.md**

After merge, on a new small branch/PR: change item 1.7's status from `🚧 next` to `✅`, and mark the next `⬜` item as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc has a corresponding task — versioning + exemptions (Task 1), Swagger bootstrap (Task 2), decorators across all 11 controllers/19 DTOs (Tasks 3-7), e2e path migration across all 17 specs (Tasks 8-10), final verification (Task 11). ✓
- **Found during self-review:** the design doc's testing strategy mentions "one new e2e assertion: `GET /health` (no `/v1/` prefix) still returns 200" — this was already an existing assertion in `health.e2e-spec.ts` before this plan; Task 1 Step 4 adds a genuinely NEW assertion (`GET /v1/health` returns 404) that more directly proves the version-neutral exemption than merely re-confirming `/health` still works. This is a strengthening of the design doc's stated testing strategy, not a deviation from it.
- **Found during self-review:** `health.e2e-spec.ts` never called `configureApp(app)` at all before this plan — a pre-existing gap unrelated to Tasks 2-10's work, but directly blocking Task 1's own goal (proving `/health` stays unversioned while the rest of the app versions) since `enableVersioning()` lives inside `configureApp`. Folded the fix into Task 1 Step 4 rather than creating a separate task, since fixing it is a one-line prerequisite for Task 1's own test to be meaningful, not an independently-reviewable deliverable.
- **Found during self-review:** `rate-limiting.e2e-spec.ts`'s error-body assertion (`path: "/auth/otp/request"`) will break under versioning even though the test doesn't look like a "routing" test at first glance — traced this via `AllExceptionsFilter`'s `path: request.url` (reflects the real, versioned URL). Explicitly called out in Task 8 Step 3 with the full corrected file rather than leaving it as an easy-to-miss one-line diff buried in a "prepend /v1/ to every call" instruction.
- **Type consistency:** `VERSION_NEUTRAL` and `VersioningType` are both imported once (Task 1) from `@nestjs/common` and referenced identically wherever needed; DTO `@ApiProperty`/`@ApiPropertyOptional` field names match each DTO's actual existing property names exactly (verified against the current file contents before writing every task, not assumed).
- **No placeholders:** every task has complete, real code for every file it touches — no DTO, controller, or e2e file is given only a "prepend /v1/" instruction without also showing the fully corrected file wherever a subtlety exists (Tasks 1, 8's rate-limiting file); the purely mechanical, no-subtlety files (Tasks 9-10's grep-and-prepend groups) are described precisely enough (path lists, explicit exceptions named) that no invented content is needed to complete them.
