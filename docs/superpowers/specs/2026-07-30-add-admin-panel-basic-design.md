# Admin Panel (Basic) — Design

**ROADMAP:** Phase 1, item 1.10 (`add-admin-panel-basic`)
**Status:** Design approved 2026-07-30
**Depends on:** `add-auth-otp-rbac` (Role/RolesGuard), `add-room-listing-enhancements` (VendorVerificationLog, verifiedStatus flow — extended, not replaced), `add-payment-gateway-integration` (LedgerEntry, commissionRatePercent — read for the overview), `add-vendor-dashboard-basic` (`startOfDhakaMonth`/`endOfDhakaMonth` helpers, reused as-is for the overview's revenue window).

## Problem

Today an admin's toolkit is exactly three endpoints: approve/reject a pending vendor, set a vendor's commission rate, and check system health. There is no way to stop a bad-actor vendor who is already `VERIFIED` — rejecting them only blocks _future_ listing creation, but their existing hotels/rooms/vehicles stay bookable and they can keep logging in and taking new bookings indefinitely. There is also no unified audit trail: the only log table that exists (`VendorVerificationLog`) is hardcoded to the three verification actions (`PENDING`/`VERIFIED`/`REJECTED`) and cannot represent a suspension or a commission change — a commission-rate edit today leaves zero trace of who changed what, when, or why. Finally, an admin has no single view of the platform's shape (how many vendors, bookings, how much revenue) — every question requires a raw database query.

## Scope

Four endpoint groups, all under the existing `admin/vendors` and a new `admin` prefix, all gated identically to what already exists (`JwtAuthGuard` + `RolesGuard` + `@Roles("ADMIN", "SUPER_ADMIN")` — no distinction between the two roles anywhere in this module, matching how the codebase already treats them everywhere else):

1. **Vendor suspension** — reversible, reason-required, blocks login/new-bookings/new-listings/search-visibility for that vendor, leaves existing confirmed bookings untouched.
2. **Unified audit log** — one polymorphic table replacing `VendorVerificationLog`, covering every admin action (verification, suspension, commission changes), queryable by vendor, by admin, or as a platform-wide feed.
3. **Platform overview** — headline counts (vendors/travelers/bookings/hotels/vehicles) and a revenue/commission summary for the current month.
4. **Vendor list** — every vendor, filterable by status, for the admin to actually find who to act on.

Deliberately **not** in scope (YAGNI, confirmed during brainstorming): per-listing takedown (suspending the vendor already hides all their listings — a standalone "deactivate this one room" admin endpoint would be a second, redundant lever); multi-admin role management (this module assumes ADMIN/SUPER_ADMIN accounts already exist via whatever means created the first one — no admin-invites-admin flow); immediate revocation of an already-issued access token on suspension (this codebase's JWT access tokens are stateless by design — no request-time DB lookup anywhere today — so suspension takes effect on the next login/refresh attempt, within the existing 15-minute access-token lifetime, not mid-session).

## Vendor Suspension

```
POST /admin/vendors/:id/suspend    body: { reason: string }  (required, non-empty)
POST /admin/vendors/:id/unsuspend
```

Adds two fields to `User`: `suspendedAt DateTime?`, `suspensionReason String?`. Both null means not suspended; both set means suspended. Uses the same guarded-update discipline already established (`updateMany({ where: { id, suspendedAt: null }, ... })`, checking `count === 1` before writing the audit-log row) — a double-suspend or suspend-race is a safe no-op, not a 500, matching the exact pattern `VendorVerificationService.approve`/`reject` already use.

**What suspension blocks**, all newly enforced by this module:

- **Login:** `CredentialsService.login` checks `user.suspendedAt !== null` after password verification succeeds, before issuing tokens — rejects with `403 Forbidden` (a distinct status from the existing `401` "invalid credentials", so a suspended vendor with the _correct_ password gets an unambiguous "your account is suspended" rather than being told their password is wrong). `TokenService.rotateRefreshToken`'s subject-lookup callback gains the same check, so an already-logged-in vendor's _next_ refresh attempt also fails — this is the mechanism that bounds how long a suspended vendor's session can still work (at most one access-token lifetime, since refresh is the only way to get a new one).
- **New bookings:** `BookingsService.createBooking` already loads the resource owner (`room.hotel.owner`/`vehicle.owner`) to check `verifiedStatus === "VERIFIED"` — the same load gains a `suspendedAt === null` check alongside it, rejecting with the existing `ForbiddenException("This listing's owner is not verified")` path's sibling message.
- **New listings:** `HotelsService.create`/`VehiclesService.create` already require the caller's own `verifiedStatus === "VERIFIED"` — gains the same `suspendedAt === null` check on the caller (their own record, not a lookup) for the identical reason.
- **Public search visibility:** `HotelsService.searchAvailableRooms`/`VehiclesService.searchAvailable`'s raw-SQL queries add `AND h.owner_id NOT IN (SELECT id FROM users WHERE suspended_at IS NOT NULL)` (or the vehicle-owner equivalent) to the existing `WHERE` clause — a suspended vendor's listings stop appearing in availability search immediately (this check runs on every search request, unlike login/booking, since it's cheap — a subquery against an indexed column — and there's no equivalent "existing session" concern for anonymous search).

**What suspension does NOT touch** (explicit, matching the brainstormed decision): any `Booking` row already `CONFIRMED`+`PAID` is completely unaffected — no cancellation, no status change, no refund trigger. A traveler who already paid can still check in/out normally; the vendor can still call the existing `checkout` endpoint to mark it `COMPLETED` (suspension stops new business, not the operational completion of business already committed).

## Unified Audit Log

Replaces `VendorVerificationLog` with a single, action-polymorphic table:

```prisma
enum AdminActionType {
  VENDOR_APPROVED
  VENDOR_REJECTED
  VENDOR_RESUBMITTED
  VENDOR_SUSPENDED
  VENDOR_UNSUSPENDED
  COMMISSION_RATE_CHANGED
}

model AdminAuditLog {
  id          String          @id @default(uuid())
  actorId     String          @map("actor_id")
  targetId    String          @map("target_id")
  action      AdminActionType
  reason      String?
  metadata    Json?
  createdAt   DateTime        @default(now()) @map("created_at")

  actor  User @relation("AdminAuditActor", fields: [actorId], references: [id])
  target User @relation("AdminAuditTarget", fields: [targetId], references: [id])

  @@index([targetId])
  @@index([actorId])
  @@index([createdAt])
  @@map("admin_audit_logs")
}
```

- `actorId` is the admin who performed the action; for `VENDOR_RESUBMITTED` (the one self-service action that already existed — a vendor resubmitting their own rejected application), `actorId` equals `targetId`, matching the existing `VendorVerificationService.resubmit`'s documented convention ("self-service action; there is no admin actor for a resubmit").
- `reason` is populated for `VENDOR_REJECTED`, `VENDOR_SUSPENDED` (both required by their DTOs), and optionally `VENDOR_UNSUSPENDED`; null for the rest.
- `metadata` (`Json?`) exists for exactly one action today: `COMMISSION_RATE_CHANGED` stores `{ oldRatePercent, newRatePercent }` — the only place this module needs to record a before/after value pair, and a typed column-per-action-type would be significant schema churn for one field. No other action writes `metadata` in this module; adding a second use is a future call, not a precedent to design around now.
- **Migration:** existing `VendorVerificationLog` rows are backfilled into `AdminAuditLog` (`action` mapped from `VerifiedStatus`: `VERIFIED → VENDOR_APPROVED`, `REJECTED → VENDOR_REJECTED`; a `PENDING`-action row only ever came from `resubmit`, mapped to `VENDOR_RESUBMITTED`), then `VendorVerificationLog` is dropped. `VendorVerificationService` is updated to write to `AdminAuditLog` instead — its three existing call sites (`approve`, `reject`, `resubmit`) keep their exact business logic, only the log-write target changes.
- **`CommissionController.update` (existing endpoint, modified by this module):** currently writes no log at all (confirmed during research — a commission change today leaves zero trace). This module changes it to read the vendor's current `commissionRatePercent` before the update, perform the update, then write one `AdminAuditLog` row (`action: COMMISSION_RATE_CHANGED`, `metadata: { oldRatePercent, newRatePercent }`) in the same flow — closing the "commission change has no audit trail" half of this module's Problem statement. The endpoint's existing 404 gap (no existence check before update, flagged as a fast-follow after `add-payment-gateway-integration`) is fixed in the same change, since reading the vendor first to capture `oldRatePercent` naturally requires confirming they exist — a `NotFoundException` is thrown here instead of letting a raw Prisma error surface, matching every other admin endpoint's error-handling convention.

### Endpoints

```
GET /admin/audit-log?vendorId=&adminId=&page=&pageSize=
```

One endpoint, three usage modes via optional query params (matching the brainstormed requirement for all three): `vendorId` alone → that vendor's full history (replaces the old `GET /admin/vendors/:id/history`, which is removed since this supersedes it exactly); `adminId` alone → everything one admin has done; neither → the full platform feed, newest first, paginated. Both together is allowed (further narrows to "what did this admin do to this vendor"). `page`/`pageSize` default to `1`/`50`, matching no existing pagination convention in this codebase (this is the first paginated list endpoint) — chosen as a conservative default rather than returning an unbounded result set.

## Platform Overview

```
GET /admin/overview
```

Returns, computed at request time (no caching, no background job — matching this module's YAGNI stance and the precedent set by `add-observability`'s on-request-only health checks):

```json
{
  "totalVendors": 42,
  "totalTravelers": 310,
  "totalBookings": 128,
  "totalHotels": 30,
  "totalVehicles": 15,
  "activeSuspensions": 2,
  "monthlyRevenue": {
    "grossMinor": 4500000,
    "platformFeeMinor": 450000,
    "vendorOwedMinor": 4050000
  }
}
```

- The vendor/traveler counts are `UserRole` counts (a user can hold multiple roles, per the existing schema — counted by role, not by `User` row, to avoid double-counting a hypothetical multi-role account and to match how the rest of the system already treats roles as a set, not a single column).
- `monthlyRevenue` aggregates `LedgerEntry` grouped by `type` (`GROSS_PAYMENT`/`PLATFORM_FEE`/`VENDOR_OWED`) for the current calendar month — reusing the exact Asia/Dhaka month-boundary helpers (`startOfDhakaMonth`/`endOfDhakaMonth`) already built for `add-vendor-dashboard-basic`, not a new time-zone calculation. This is the platform-wide equivalent of one vendor's own `monthlyIncomeMinor` from that module, but summed across every vendor rather than scoped to one.
- `activeSuspensions` is a simple count of `User` rows where `suspendedAt IS NOT NULL` — included because it's the one number this dashboard exists to make visible that no other endpoint surfaces at all.

## Vendor List

```
GET /admin/vendors?status=&search=
```

- `status` filters on `verifiedStatus` (`PENDING`/`VERIFIED`/`REJECTED`) **or** the synthetic value `SUSPENDED` (meaning `suspendedAt IS NOT NULL`, independent of `verifiedStatus` — a suspended vendor keeps whatever `verifiedStatus` they had before suspension, since suspension and verification are orthogonal concepts: a `VERIFIED` vendor can be suspended, and — less commonly, but not blocked — a `REJECTED` vendor's record could theoretically also carry a stale `suspendedAt` if they were suspended before being rejected; the query treats `SUSPENDED` as a filter dimension layered on top of, not replacing, `verifiedStatus`).
- `search` does a case-insensitive partial match against `email`/`fullName`/`phone` (Prisma's `contains`+`mode: "insensitive"`), giving the admin a way to actually find one vendor among potentially hundreds rather than paging through everything.
- Returns `toPublicUser()`-mapped rows (existing helper — never leak `passwordHash`), each including `suspendedAt`/`suspensionReason` so the list itself shows suspension state without a second call.
- This replaces the narrower existing `GET /admin/vendors/pending` (which only ever returned `PENDING` vendors) — that endpoint is removed since `GET /admin/vendors?status=PENDING` is the same query, one case among several this new endpoint already handles; no functionality is lost, only a redundant narrower route.

## RBAC

Every endpoint in this module: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("ADMIN", "SUPER_ADMIN")`, identical to every existing admin route — this module introduces no new guard, no new distinction between the two roles, matching the confirmed decision that ADMIN and SUPER_ADMIN see and do exactly the same things everywhere in this system today.

## Testing Strategy

- **Suspension enforcement**, one test per blocked surface: login returns `403` (not `401`) for a suspended vendor with correct credentials; refresh fails for a suspended vendor's still-valid refresh token; `POST /bookings` against a suspended vendor's room/vehicle is rejected; `POST /hotels`/`POST /vehicles` by a suspended vendor is rejected; `GET /rooms/available`/`GET /vehicles/available` excludes a suspended vendor's active room/vehicle.
- **Suspension non-effect**, proving the boundary: an existing `CONFIRMED`+`PAID` booking for a since-suspended vendor's room is unaffected — `GET` on that booking still returns its real data, and the vendor can still `checkout` it.
- **Guarded-update race safety**: concurrent double-suspend (two admin calls) is a safe no-op on the second, matching the existing `approve`/`reject` test discipline.
- **Audit log**: each of the 6 `AdminActionType` values is asserted to produce exactly one row with the correct `actorId`/`targetId`/`reason`/`metadata` shape; `GET /admin/audit-log` tested with each of the three filter modes (vendorId only, adminId only, neither) plus pagination.
- **Migration**: an e2e or integration test seeding a pre-migration-shaped `VendorVerificationLog` row (if feasible to simulate) or, more practically, a unit test on the migration's backfill logic asserting the three `VerifiedStatus → AdminActionType` mappings are correct.
- **Overview**: unit tests for the count aggregations and the Dhaka-month-scoped revenue sum, reusing the same mock patterns already established for `add-vendor-dashboard-basic`'s equivalent aggregation tests.
- **Vendor list**: filter-by-status (including the synthetic `SUSPENDED` value), filter-by-search, and the combination of both.

## Explicitly deferred (not scope-creep, tracked for later)

| Concern                                                                    | Why deferred                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-listing takedown independent of vendor suspension                      | Confirmed during brainstorming as unnecessary — vendor suspension already hides every listing; a standalone lever would be a second, redundant path to the same outcome with no identified use case.                                                                                                                      |
| Multi-admin account management (inviting/creating new admin users via API) | Not requested; this module assumes ADMIN/SUPER_ADMIN accounts already exist by whatever means created the first one.                                                                                                                                                                                                      |
| Immediate access-token revocation on suspension                            | This codebase's JWT access tokens are stateless by design (no per-request DB lookup anywhere today); adding one purely for this would be a first-of-its-kind performance/architecture tradeoff not otherwise needed. Suspension takes effect within one access-token lifetime (≤15 minutes) via the login/refresh checks. |
| Automated vendor payout, fraud detection, per-vendor analytics dashboards  | `add-earnings-analytics-dashboard` (ROADMAP 2.3) and `add-fraud-detection-analytics` (ROADMAP 3.5) — distinct, larger modules already on the roadmap.                                                                                                                                                                     |
| Push/email notification when a vendor is suspended                         | `add-reviews-notifications` (ROADMAP 2.4) territory if ever needed; out of scope for a backend-only admin module.                                                                                                                                                                                                         |
| Photo/facility moderation                                                  | Explicitly left as only a _conditional_ candidate for this module in `add-vendor-dashboard-basic`'s design doc ("if the business need is confirmed") — no such need was raised during this module's brainstorming, so it stays deferred to a possible future `add-listing-moderation` module.                             |
