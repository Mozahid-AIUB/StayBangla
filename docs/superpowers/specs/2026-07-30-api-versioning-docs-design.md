# API Versioning + Documentation — Design

**ROADMAP:** Phase 1, item 1.7 (`add-api-versioning-docs`)
**Status:** Design approved 2026-07-30

## Problem

The StayBangla API currently has no version prefix (`GET /hotels`, `POST /auth/login`, ...) and no meaningful Swagger documentation — `main.ts` wires a bare `SwaggerModule.setup("api/docs", ...)` with only a title and version string, and none of the 11 controllers, 38 routes, or 19 DTOs carry any `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiProperty` decorators. Anyone consuming this API (a future frontend team, a future EPS/bKash integration, an external partner) currently has no way to discover what an endpoint expects or returns short of reading the TypeScript source directly.

Two related but separable problems, both moved into this one module since they touch the same 11 controllers:

1. **No API versioning** — no seam exists for introducing a breaking change without disrupting every existing client. This is preparedness for the future, not a fix for a current failure: no external client exists yet.
2. **No usable API reference** — the auto-generated Swagger page exists but is functionally empty.

## Scope

Whole-project, not module-by-module — every existing controller and DTO gets versioned and documented in this one pass, since doing it once consistently is cheaper than 11 separate touch-ups and avoids a half-documented API in the interim.

## Architecture

### Versioning

NestJS's built-in URI versioning, enabled globally in `main.ts`:

```ts
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: "1",
});
```

Every controller's routes are automatically prefixed with `/v1/` — no per-controller changes needed for the default case. A future breaking change gets its own controller (or method) tagged `@Version("2")`, coexisting with the `v1` route rather than replacing it.

**Two endpoints are explicitly exempted from versioning** via `@Version(VERSION_NEUTRAL)`:

- `HealthController` (`GET /health`, `GET /health/db`) — monitoring/load-balancer tooling expects a stable, version-independent health check path.
- `PaymentsController`'s IPN webhook (`POST /payments/sslcommerz/ipn`) — this URL is configured inside SSLCommerz's own merchant dashboard as `ipn_url` (see `SslcommerzPaymentProviderService`). A version bump should never require updating a third-party dashboard's webhook configuration; keeping this route version-neutral avoids that coupling entirely.

No backward-compatible unversioned routes are kept for anything else — there is no existing external client to preserve compatibility for, so every other route moves to `/v1/` outright.

### Documentation

`main.ts`'s `DocumentBuilder` is filled in properly:

- Real title, description, and version (matching `package.json`'s version, not a hardcoded `"0.0.0"`).
- `.addBearerAuth()` — adds a JWT "Authorize" button to the Swagger UI, so an endpoint requiring auth can be logged into and tested directly from the browser without an external tool like Postman.

Every controller gets `@ApiTags("<module-name>")` (`auth`, `users`, `hotels`, `vehicles`, `bookings`, `payments`, `admin`) so Swagger UI groups routes by module rather than listing all 38 alphabetically.

Every route gets:

- `@ApiOperation({ summary, description })` — a one-line summary plus a slightly longer description where the endpoint's behavior isn't obvious from its name alone (e.g. `confirmIfValid`'s idempotent, silently-no-op-on-invalid-input semantics deserve a note; a plain CRUD `GET` doesn't).
- `@ApiResponse({ status, description })` for every status code the endpoint can actually produce — including error paths (400/401/403/404/409), not just the happy-path 200/201. This is read from the existing `throw new XException(...)` calls already in each service/controller, not invented.
- `@ApiBearerAuth()` on every route sitting behind `JwtAuthGuard` (all of them except `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/register`, `POST /auth/login`, `GET /health`, `GET /health/db`, and the IPN webhook).

Every DTO field gets `@ApiProperty({ example, description })` (or `@ApiPropertyOptional` for optional fields) with a realistic example value — a real-looking date string for a booking's `checkIn`, a real-looking BDT minor-unit integer for a price, not `"string"` or `0`.

`SwaggerModule.setup()`'s mount path is independent of `enableVersioning()` (it isn't a controller route, so URI versioning doesn't touch it automatically) and stays exactly where it already is today: `api/docs` (i.e. `GET /api/docs`), unchanged by this module. This keeps the docs URL stable across future version bumps, the same reasoning as the health-check exemption.

### What does NOT change

- No new runtime dependency (`@nestjs/swagger` is already installed and wired).
- No route path changes beyond the `/v1/` prefix — no renaming, no restructuring, no new endpoints.
- No response-shape changes — `@ApiResponse`'s `type`/`description` describe what a route already returns; nothing about actual controller/service logic is touched.
- No `v2` routes are created — the versioning scaffold is put in place, not exercised, per the ROADMAP note this module is scoped to "prepare for," not "use yet."

## Test migration

All ~17 e2e-spec files call `request(app.getHttpServer()).post("/bookings")`-style paths directly. Every one of these needs its path updated to include the `/v1/` prefix (`/v1/bookings`, `/v1/hotels`, `/v1/auth/login`, etc.), except calls to `/health`, `/health/db`, and `/payments/sslcommerz/ipn`, which stay unversioned. Unit tests (controller/service specs) call methods directly, not HTTP paths, so they are unaffected.

## Testing strategy

- Existing unit tests continue to pass unchanged (versioning and Swagger decorators don't touch business logic).
- Every e2e spec's HTTP paths are updated to the new `/v1/`-prefixed shape; a full e2e run confirms nothing broke.
- One new e2e assertion: `GET /api/docs` returns 200, confirming Swagger UI is still reachable at its unchanged path post-versioning.
- One new e2e assertion: `GET /health` (no `/v1/` prefix) still returns 200, confirming the version-neutral exemption works.
- No new unit tests needed for the decorators themselves — `@ApiTags`/`@ApiOperation`/`@ApiProperty` are declarative metadata with no runtime branching to test; NestJS's own Swagger module is responsible for correctly reading them, which is out of scope to re-test here.

## Explicitly deferred (YAGNI)

- Backward-compatible unversioned aliases for old routes — no existing external client needs them.
- A `v2` of anything — no breaking change is planned yet; this module only builds the seam for one.
- Auto-generating a static OpenAPI JSON/YAML file as a build artifact (e.g. for a separate docs site or client-SDK generation) — the live Swagger UI at `/api/docs` is sufficient for now; revisit if a concrete need for offline/generated clients appears.
- Custom Swagger UI theming/branding — default NestJS Swagger UI styling is used as-is.
