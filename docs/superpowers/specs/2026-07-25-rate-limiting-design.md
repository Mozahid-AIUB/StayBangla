# Rate Limiting — Design

**Status:** Approved for planning
**Scope:** Backend only (`apps/api`). No frontend/UI in this change.
**Depends on:** `add-auth-otp-rbac`, `add-hotel-vehicle-booking-core`, `add-room-listing-enhancements`, `fix-shared-types-contract` (all merged, `main`).

## Problem

No HTTP-level rate limiting exists anywhere in the backend today. Every route — public search endpoints, login, registration, booking creation, even admin routes — accepts unlimited requests per second from any single client. The one exception is `OtpService`'s own domain-specific Redis rate-limiting (per-identifier/per-IP hourly caps with a resend cooldown), which protects against OTP-abuse specifically (SMS/email cost, OTP brute-forcing) but is not a general HTTP-layer defense and covers only two routes (`/auth/otp/request`, `/auth/otp/verify`).

A single client can currently: scrape every public listing (`/rooms/available`, `/vehicles/available`, `/hotels/:id`, `/vehicles/:id`) at unlimited speed, brute-force `/auth/login` passwords with no backoff, or flood any authenticated endpoint. This was identified as the highest-priority gap in this session's architecture review — real SaaS platforms treat this as a baseline requirement, not an optional hardening pass.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  ThrottlerModule (global) — apps/api/src/app.module.ts         │
│  Storage: ThrottlerStorageRedisService (wraps existing          │
│  RedisService/ioredis connection — no new infra)                │
│  Guard: ThrottlerGuard registered as APP_GUARD — applies to      │
│  every route by default, no per-controller opt-in needed        │
└───────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  Global default        Per-route override      Exempt
  100 req/min/IP         (@Throttle())          (@SkipThrottle())
  (every route that      ───────────────        ──────────────
  doesn't override)      /auth/otp/request:     GET /health
                          5/min                  GET /health/db
                          /auth/login,
                          /auth/register:
                          10/min
```

Tracking key is the caller's IP address for every route (via the throttler's default IP extraction) — not per-user. This matches the plan's YAGNI stance: `OtpService`'s existing identifier-based limiting already covers the one case where per-user tracking would matter (OTP abuse), so this new HTTP layer only needs to add IP-based defense-in-depth on top, not duplicate per-user logic.

### Why global-guard-with-overrides, not per-route opt-in

A per-route opt-in (`@Throttle()` added manually to each sensitive controller) requires every future controller author to remember to add it. A global default guard means a newly-added route is protected automatically the day it's written — the plan explicitly identified "no route accidentally unprotected" as the goal.

### Why Redis storage, not in-memory

The default `@nestjs/throttler` storage is in-memory per Node process. This API currently runs as a single instance, so in-memory would work today — but the moment this app runs behind a load balancer with more than one instance (the natural next step for any real SaaS scaling out), each instance would keep its own separate counter, silently multiplying the effective limit by the instance count with no error or warning. Since `ioredis`/`RedisService` already exists as a global provider in this codebase (used by `OtpService`, BullMQ), wiring the throttler to the same Redis connection costs nothing extra in infrastructure and removes this entire class of future surprise.

### Why this doesn't touch `AllExceptionsFilter`

`@nestjs/throttler`'s `ThrottlerGuard` throws `ThrottlerException`, which extends `HttpException` with status 429. The existing `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`) already handles any `HttpException` generically — it reads `getStatus()`/`getResponse()` and produces the standard `{ statusCode, error, message, timestamp, path }` body. No filter changes are needed; a throttled request will automatically get a well-formed 429 response in the same shape every other error uses.

## New Dependencies

```
@nestjs/throttler@^6.5.0
@nest-lab/throttler-storage-redis@^1.2.0
```

Both confirmed to exist on the npm registry at these versions as of this design.

## New Environment Variables

```
THROTTLE_TTL_SECONDS=60                    # window size for the global default
THROTTLE_LIMIT=100                         # global default: 100 req/window/IP
THROTTLE_OTP_LIMIT=5                       # /auth/otp/request override
THROTTLE_AUTH_LIMIT=10                     # /auth/login, /auth/register override
```

All four follow the existing `env.validation.ts` pattern (`z.coerce.number().int().positive().default(...)`), added to the existing `envSchema` object. `THROTTLE_TTL_SECONDS` is shared across all three limits (global default and both overrides use the same 60-second window; only the request count differs) — this keeps the config surface small and matches how the brief's three numeric limits (100, 5, 10) were framed as "per minute" throughout brainstorming.

## Module Wiring

`apps/api/src/app.module.ts` gains:

```typescript
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { APP_GUARD } from "@nestjs/core";
```

`ThrottlerModule.forRootAsync(...)` added to `imports`, configured with a single default throttler (`ttl`/`limit` from the two new global env vars) and a Redis-backed `storage` option built from the existing `RedisService`/`REDIS_URL`. `{ provide: APP_GUARD, useClass: ThrottlerGuard }` added to `providers` (a new array on this module, which currently has none).

## Per-Route Overrides

```typescript
// apps/api/src/auth/otp.controller.ts — @Post("request")
@Throttle({ default: { limit: 5, ttl: 60000 } })

// apps/api/src/auth/credentials.controller.ts — @Post("login"), @Post("register")
@Throttle({ default: { limit: 10, ttl: 60000 } })
```

`@Throttle()`'s limit/ttl are read from the same env-derived constants used to configure the global default, not hardcoded numeric literals repeated in each controller (single source of truth for the three tunable values).

## Exemptions

```typescript
// apps/api/src/health/health.controller.ts — both routes
@SkipThrottle()
```

Health checks are polled frequently by monitoring/load-balancer tooling and carry no sensitive data or meaningful cost per request — exempting them avoids a false-positive 429 taking a service out of a load balancer's rotation.

## RBAC / CASL

No interaction — rate limiting is IP-based and applies before authentication is even evaluated (the `ThrottlerGuard` runs as a global guard; NestJS evaluates guards in registration order, and `JwtAuthGuard`/`RolesGuard` on individual routes still run afterward as today). A rate-limited request never reaches the auth layer at all.

## Testing Strategy

- Unit tests are not meaningful for `@nestjs/throttler`'s own guard logic (it's a well-tested third-party library) — the plan's tests instead verify StayBangla's _configuration_ of it: that the global default is wired with the correct limit/ttl from env vars, and that the three per-route/exempt decorators are present on the expected methods.
- One e2e test proves the real behavior end-to-end: fire `THROTTLE_OTP_LIMIT + 1` requests at `/auth/otp/request` in a tight loop and assert the last one returns 429 with a JSON body matching the existing error shape (`statusCode`, `error`, `message`) — this is the only way to prove the Redis-backed counting and the `AllExceptionsFilter` integration actually work together against a real running app, not mocks.
- A second e2e test proves `GET /health` is never throttled even after far exceeding the global default's request count in the same window.
- Test-env tuning: `.env.test` needs low, fast-to-exceed values for the e2e test to run quickly without a long loop — reuse the same env vars, set to small numbers (e.g., `THROTTLE_OTP_LIMIT=3`) in `.env.test` specifically, following the precedent already set by `.env.test`'s lower `ARGON2_TIME_COST`.

## Explicitly deferred (not scope-creep, tracked for later modules)

| Concern                                                                                   | Deferred to                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-authenticated-user rate limiting (in addition to IP)                                  | Not yet planned — no concrete need identified; IP-based is sufficient for the current threat model                                                                 |
| Distinguishing shared-IP false positives (office/hotel WiFi)                              | Not yet planned — acceptable tradeoff at current scale; `OtpService`'s existing per-identifier limit already provides a more precise backstop for OTP specifically |
| Rate-limiting the presigned-photo-upload MinIO PUT itself (not just the presign endpoint) | Out of this API's control — MinIO receives the PUT directly from the client, not through this backend                                                              |
| Configurable per-tenant/per-plan rate limits                                              | Not applicable — this is a single-tenant platform (per `architecture_decisions` memory)                                                                            |
