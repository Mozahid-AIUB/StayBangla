# Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /health/detailed` (ADMIN/SUPER_ADMIN only) to `HealthController`, checking Postgres, Redis, and MinIO independently, alongside the existing unauthenticated `GET /health` and `GET /health/db`.

**Architecture:** `HealthController` gains two new constructor dependencies (`RedisService`, `StoragePort`) and one new route. Each of the three checks runs in its own try/catch inside the route handler; the response body and HTTP status code (200 if all three `"ok"`, 503 if any is `"down"`) are written directly via `@Res()` so the exact `{db, redis, minio}` shape survives on both the success and failure path — `AllExceptionsFilter` reshapes any thrown `HttpException`'s body into a generic `{statusCode, error, message, ...}` envelope, which would discard the per-service breakdown if we threw an exception for the 503 case instead.

**Tech Stack:** `@nestjs/common`, `@nestjs/swagger` (already installed and wired across the codebase), `ioredis` (via the existing `RedisService`), `minio` (via the existing `StoragePort`/`MinioStorageService`).

## Global Constraints

- `GET /health` and `GET /health/db` stay exactly as they are today — unauthenticated, unchanged response shape, unchanged behavior. This plan only adds a new route; it does not touch either existing one.
- `GET /health/detailed` is guarded by `JwtAuthGuard` + `RolesGuard` + `@Roles("ADMIN", "SUPER_ADMIN")` — the exact pattern already used by `CommissionController`/`VendorVerificationController` (`apps/api/src/admin/commission.controller.ts`).
- Each of the three checks (Postgres/Redis/MinIO) must be wrapped in its own independent try/catch — one service failing must never prevent the other two from running and reporting their real status.
- No background scheduler, no alerting/notification integration, no per-queue job-count metrics — every check is synchronous and only runs when the route is called (see the design doc's "Explicitly deferred" section).
- `HealthController`'s response body for `/health/detailed` must be exactly `{ db: "ok" | "down", redis: "ok" | "down", minio: "ok" | "down" }` — written via `@Res()` directly, not via a thrown `HttpException`, so `AllExceptionsFilter` never reshapes it.

---

## File Structure

```
apps/api/src/health/
├── health.controller.ts       [MODIFY: add detailed() route + 2 new constructor deps]
├── health.controller.spec.ts  [CREATE: first unit-test file for this controller]
└── health.module.ts           [MODIFY: import StorageModule]

apps/api/test/
└── health.e2e-spec.ts         [MODIFY: add 3 new e2e cases for /health/detailed]
```

No new files beyond the new unit-spec — `HealthController` stays a single, small file since it's still only 3 routes with no shared private logic complex enough to warrant splitting out.

---

## Task 1: `GET /health/detailed` — Postgres+Redis+MinIO check, RBAC-guarded

**Files:**

- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`

**Interfaces:**

- Consumes: `RedisService` (`apps/api/src/common/redis/redis.module.ts`, `@Global()`, extends `ioredis`'s `Redis` — `.ping(): Promise<string>` is inherited, resolves `"PONG"` on success), `StoragePort` (`apps/api/src/common/storage/storage.port.ts`, abstract class with `ensureBucketExists(): Promise<void>`), `PrismaService` (already injected in this controller), `JwtAuthGuard`/`RolesGuard`/`Roles` (existing auth guards, same pattern as `apps/api/src/admin/commission.controller.ts`).
- Produces: `HealthController.detailed(res: Response): Promise<void>` — writes `{ db, redis, minio }` (each `"ok"`/`"down"`) via `res.status(...).json(...)`, HTTP 200 if all three `"ok"`, HTTP 503 otherwise. No later task depends on this signature (this is the only task in the plan).

- [ ] **Step 1: Write the failing unit tests**

`apps/api/src/health/health.controller.spec.ts` (new file):

```ts
import { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { StoragePort } from "../common/storage/storage.port";
import { HealthController } from "./health.controller";

function makeResMock(): { status: jest.Mock; json: jest.Mock } {
  const res: { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("HealthController", () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let storage: { ensureBucketExists: jest.Mock };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    redis = { ping: jest.fn() };
    storage = { ensureBucketExists: jest.fn() };
    controller = new HealthController(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      storage as unknown as StoragePort,
    );
  });

  describe("check", () => {
    it("returns status ok", () => {
      expect(controller.check()).toEqual({ status: "ok" });
    });
  });

  describe("db", () => {
    it("returns db ok when Postgres reachable", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      await expect(controller.db()).resolves.toEqual({ db: "ok" });
    });
  });

  describe("detailed", () => {
    it("returns 200 with all three ok when every check succeeds", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "ok",
        minio: "ok",
      });
    });

    it("returns 503 with db down when Postgres fails, but redis/minio still report ok", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "down",
        redis: "ok",
        minio: "ok",
      });
    });

    it("returns 503 with redis down when Redis fails, but db/minio still report ok", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));
      storage.ensureBucketExists.mockResolvedValue(undefined);
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "down",
        minio: "ok",
      });
    });

    it("returns 503 with minio down when MinIO fails, but db/redis still report ok", async () => {
      prisma.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
      redis.ping.mockResolvedValue("PONG");
      storage.ensureBucketExists.mockRejectedValue(
        new Error("bucket unreachable"),
      );
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "ok",
        redis: "ok",
        minio: "down",
      });
    });

    it("returns 503 with all three down when every check fails", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("connection refused"));
      redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));
      storage.ensureBucketExists.mockRejectedValue(
        new Error("bucket unreachable"),
      );
      const res = makeResMock();

      await controller.detailed(res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        db: "down",
        redis: "down",
        minio: "down",
      });
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- health.controller`
Expected: FAIL — `HealthController`'s constructor doesn't accept `RedisService`/`StoragePort` yet, and `detailed()` doesn't exist.

- [ ] **Step 3: Implement**

Replace the full contents of `apps/api/src/health/health.controller.ts`:

```ts
import {
  Controller,
  Get,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { StoragePort } from "../common/storage/storage.port";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";

type ServiceStatus = "ok" | "down";

interface DetailedHealth {
  db: ServiceStatus;
  redis: ServiceStatus;
  minio: ServiceStatus;
}

@ApiTags("Health")
@Controller({ path: "health", version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StoragePort,
  ) {}

  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }

  @Get("db")
  async db(): Promise<{ db: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { db: "ok" };
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: "Detailed dependency health check (ADMIN/SUPER_ADMIN only)",
    description:
      "Checks Postgres, Redis, and MinIO independently. Each service's " +
      "status is reported even if the others fail. Returns 503 if any " +
      "service is down, 200 if all three are ok.",
  })
  @ApiResponse({ status: 200, description: "All three services are ok." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 503, description: "At least one service is down." })
  @Get("detailed")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "SUPER_ADMIN")
  async detailed(@Res() res: Response): Promise<void> {
    const [db, redis, minio] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.checkMinio(),
    ]);

    const body: DetailedHealth = { db, redis, minio };
    const allOk = db === "ok" && redis === "ok" && minio === "ok";
    res.status(allOk ? 200 : 503).json(body);
  }

  private async checkDb(): Promise<ServiceStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "down";
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      await this.redis.ping();
      return "ok";
    } catch {
      return "down";
    }
  }

  private async checkMinio(): Promise<ServiceStatus> {
    try {
      await this.storage.ensureBucketExists();
      return "ok";
    } catch {
      return "down";
    }
  }
}
```

Note on the response-writing approach: `@Res()` (without `{ passthrough: true }`) hands full control of the response to the handler — NestJS will not attempt to serialize a returned value for this route, since none is returned (the method's return type is `Promise<void>` and the body is written directly via `res.json(...)`). This deliberately bypasses `AllExceptionsFilter`'s exception-body-reshaping entirely, since nothing is thrown here — both the 200 and 503 paths write the exact `{db, redis, minio}` shape directly.

Note on `Promise.all`: the three checks run concurrently (each already has its own try/catch, so one rejecting does not reject the `Promise.all` as a whole — each `checkX()` method catches its own error and resolves to `"down"` rather than rejecting).

- [ ] **Step 4: Wire `StorageModule` into `HealthModule`**

Replace the full contents of `apps/api/src/health/health.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { StorageModule } from "../common/storage/storage.module";
import { HealthController } from "./health.controller";

@Module({ imports: [StorageModule], controllers: [HealthController] })
export class HealthModule {}
```

Note: `RedisService` needs no import here — `RedisModule` (`apps/api/src/common/redis/redis.module.ts`) is `@Global()` and already imported once in `AppModule`, making `RedisService` injectable anywhere without a module-level import.

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- health.controller`
Expected: PASS — all 6 test cases (1 for `check`, 1 for `db`, 4 for `detailed`) green.

- [ ] **Step 6: Add e2e coverage**

Replace the full contents of `apps/api/test/health.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { createAdmin, createVerifiedVendor } from "./helpers/test-fixtures";

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
    await cleanDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
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

  it("GET /health/detailed requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/health/detailed");
    expect(res.status).toBe(401);
  });

  it("GET /health/detailed rejects a non-admin caller", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "health-vendor@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/health/detailed")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /health/detailed returns 200 with all three services ok for an admin caller", async () => {
    const { accessToken } = await createAdmin(app, "health-admin@example.com");
    const res = await request(app.getHttpServer())
      .get("/health/detailed")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ db: "ok", redis: "ok", minio: "ok" });
  });
});
```

Note: `createAdmin`/`createVerifiedVendor` are existing helpers in `apps/api/test/helpers/test-fixtures.ts` (already used by other e2e specs in this codebase, e.g. `admin-commission.e2e-spec.ts`) — no new test helper is needed for this task.

- [ ] **Step 7: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- health`
Expected: PASS — all 7 e2e cases green (Docker services must be up: Postgres/Redis/MinIO all genuinely healthy in this environment, so the admin-caller test expects a real 200 with all three `"ok"`, not mocked).

- [ ] **Step 8: Full regression check**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: PASS, zero errors.

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS, no regressions in any other suite (this task only adds to `HealthController`/`HealthModule` and creates one new spec file — nothing else should be affected).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/health/health.controller.ts apps/api/src/health/health.controller.spec.ts apps/api/src/health/health.module.ts apps/api/test/health.e2e-spec.ts
git commit -m "feat(api): add GET /health/detailed with Postgres/Redis/MinIO checks"
```

---

## Task 2: Full monorepo verification + PR

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

- [ ] **Step 2: Manually verify the new route via Swagger UI**

Run: `pnpm --filter @staybangla/api dev` (with Docker services up), then open `http://localhost:3001/api/docs` in a browser.
Expected: under the "Health" tag, `GET /health/detailed` is listed with a JWT-authorize requirement, and its documented responses include 200/401/403/503. Close/stop the dev server afterward.

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feat/add-observability
gh pr create --title "feat: add detailed health check for Postgres/Redis/MinIO" --body "Implements ROADMAP.md item 1.8. See docs/superpowers/specs/2026-07-30-add-observability-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 4: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Update ROADMAP.md**

After merge, on a new small branch/PR: change item 1.8's status from `🚧 next` to `✅`, and mark the next `⬜` item (`add-vendor-dashboard-basic`, 1.9) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc has a corresponding step — `/health`/`/health/db` unchanged (Global Constraints + Task 1's diff leaves them untouched), `/health/detailed` with independent per-service try/catch (Task 1 Step 3), RBAC guard matching the existing `CommissionController` pattern (Task 1 Step 3), module wiring (Task 1 Step 4), unit + e2e testing strategy (Task 1 Steps 1, 6), no scheduler/alerting/queue-metrics/APM (nothing in this plan adds any of those). ✓
- **Found during self-review:** the design doc doesn't specify HOW the 503 response body should be constructed given `AllExceptionsFilter` reshapes thrown-exception bodies. Resolved by using `@Res()` with direct `res.status(...).json(...)` writes for both the success and failure path, bypassing the exception-filter mechanism entirely — documented explicitly in Task 1 Step 3's note so the implementer understands why this route doesn't follow the more common "return a value, let Nest serialize it" pattern used elsewhere in this codebase.
- **Type consistency:** `ServiceStatus`/`DetailedHealth` types are defined once in Task 1 Step 3 and used consistently within the same file — no other task references them, since this is a single-task plan.
- **No placeholders:** every step has complete, real code — no DTO, controller, or test file is left as a description without code; the unit test file, controller implementation, module wiring, and e2e spec are all given in full.
