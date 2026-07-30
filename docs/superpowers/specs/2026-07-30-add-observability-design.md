# Observability — Design

**ROADMAP:** Phase 1, item 1.8 (`add-observability`)
**Status:** Design approved 2026-07-30

## Problem

`HealthController` currently exposes `GET /health` (a hardcoded `{status:"ok"}`) and `GET /health/db` (a real Postgres `SELECT 1` check). Neither route says anything about Redis (used for OTP, rate-limiting, and — via BullMQ — the booking-expiry and payment-reconciliation background jobs) or MinIO (hotel/room photo storage). If either of those goes down in production, both existing health routes keep reporting success, giving a false "everything is fine" signal exactly when something real (login, photo uploads, payment reconciliation) is broken.

## Scope

Extend the existing `HealthController` to check Redis and MinIO/storage as well as Postgres, and expose the full per-service breakdown behind an admin-only route — following the two-tier pattern real production systems use (a cheap, public, no-detail liveness check for load balancers/uptime monitors; a detailed, authenticated breakdown for operators). No background scheduler, alerting, or notification system (Slack/email/SMS) is part of this module — every check runs synchronously when its route is called, nothing runs on a timer. That kind of proactive alerting is a distinct, larger feature or product decision and is explicitly out of scope here (see Explicitly Deferred).

## Endpoints

- **`GET /health`** (unchanged) — public, `{status:"ok"}`. Stays a trivial, dependency-free liveness check; this is what a load balancer or uptime monitor should poll.
- **`GET /health/db`** (unchanged) — public, Postgres-only check, kept side-by-side with the new route for backward compatibility (no existing external client exists yet, but this route already existed and nothing requires removing it).
- **`GET /health/detailed`** (new) — **ADMIN/SUPER_ADMIN only**, behind `JwtAuthGuard` + `RolesGuard` + `@Roles("ADMIN", "SUPER_ADMIN")` (the exact pattern already used by `CommissionController` and `VendorVerificationController`). Returns:
  ```json
  { "db": "ok", "redis": "ok", "minio": "ok" }
  ```
  Each of `db`/`redis`/`minio` is independently `"ok"` or `"down"` — one service failing does not prevent the other two from reporting correctly (each check is wrapped in its own try/catch, not one shared try/catch around all three). If any service is `"down"`, the endpoint returns HTTP 503; if all three are `"ok"`, it returns HTTP 200.

Detailed status stays behind authentication rather than public, because which specific backing service is degraded is operational detail useful to an attacker (e.g., "MinIO is down" tells them photo uploads are a soft target) and not useful to a load balancer, which only needs a yes/no liveness signal.

## Checks

- **Postgres:** unchanged — reuses the existing `this.prisma.$queryRaw\`SELECT 1\``pattern already in`health.db()`.
- **Redis:** `RedisService` (`apps/api/src/common/redis/redis.module.ts`, `@Global()`) already extends `ioredis`'s `Redis` class directly, so `this.redisService.ping()` is available with no new wiring. A successful `PING`/`PONG` round-trip is `"ok"`; a thrown error (connection refused, timeout) is `"down"`.
- **MinIO:** `StoragePort` (`apps/api/src/common/storage/storage.port.ts`) already declares `ensureBucketExists(): Promise<void>` as an abstract method, implemented by `MinioStorageService` as a real bucket-existence round-trip against the MinIO server. The health check depends on the `StoragePort` abstraction (not the concrete `MinioStorageService`), consistent with how the rest of the codebase (e.g. `HotelsModule`) already consumes storage — calling `ensureBucketExists()` is a real network call to MinIO, so a successful resolve means MinIO is reachable and the bucket is confirmed to exist; a thrown error is `"down"`.
- **BullMQ queues:** no separate check. Both `BookingExpiryQueueService` and `PaymentReconciliationQueueService` run entirely on top of the same Redis instance `RedisService` already connects to — a working Redis `PING` is a working queue backend. Adding a second, redundant "is BullMQ alive" check would test the same underlying dependency twice for no additional signal (YAGNI).

## Module wiring

`HealthModule` currently only declares `HealthController`. It needs `StorageModule` imported so `StoragePort` is available for injection (Redis is already globally available via `RedisModule`, no import needed there). `HealthController`'s constructor grows from `(prisma)` to `(prisma, redisService, storagePort)`.

## Error handling

Each of the three checks is performed independently inside the `detailed()` handler, each wrapped in its own try/catch — a Redis outage must not prevent the Postgres or MinIO checks from running and reporting their own real status. The overall HTTP status code (200 vs 503) is derived from whether all three came back `"ok"`, computed after all three checks have already run to completion (never short-circuited on the first failure).

## Testing strategy

- Unit tests for `HealthController.detailed()`: each of the 3 services mocked to succeed/fail independently, asserting the correct per-service `"ok"`/`"down"` string and the correct overall HTTP status (200 when all three succeed, 503 when any one fails) — including the case where exactly one of three fails, to prove the other two still report accurately rather than the whole response failing.
- E2e test: `GET /health/detailed` returns 401 with no token, 403 for a non-admin caller (e.g. TRAVELER), and 200 with the full `{db,redis,minio}` shape for an ADMIN caller against the real (healthy, in this environment) dev-database/Redis/MinIO stack.
- Existing `GET /health` and `GET /health/db` e2e tests are untouched — this module adds one new endpoint and its tests, without modifying the two existing ones' behavior.

## Explicitly deferred (YAGNI)

- Any background scheduler/cron that polls these checks on a timer — every check in this design is synchronous and only runs when its route is actually called.
- Any alerting/notification integration (Slack webhook, email, SMS, PagerDuty) when a service goes down — this module only reports current status on request; deciding whether/how to alert a human is a separate, larger product decision for a future module.
- Per-queue job-count/failure-count metrics (e.g., "3 jobs pending, 1 failed") — out of scope; Redis reachability is treated as sufficient proof the queue backend itself is alive, not a proxy for individual job health.
- Any third-party APM/observability platform integration (Datadog, New Relic, Sentry performance monitoring) — this module is a self-contained health-check API, not a broader observability platform integration.
