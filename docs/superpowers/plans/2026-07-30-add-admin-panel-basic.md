# Admin Panel (Enterprise) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an ADMIN/SUPER_ADMIN full platform control: suspend/unsuspend vendors AND travelers (blocking login, new bookings, new listings, and search visibility, without touching existing confirmed bookings), a unified audit log covering every admin action, a platform overview, a filterable vendor list and a filterable traveler list, admin-level booking visibility/force-cancel, and an operational analytics dashboard (revenue trend, booking-status breakdown, top vendors, district distribution).

**Architecture:** Extends the existing `AdminModule` with new controllers/services following the exact patterns already established by `VendorVerificationController`/`VendorVerificationService`. `VendorVerificationLog` is retired in favor of a new polymorphic `AdminAuditLog` table; every existing writer of the old table is updated to write the new one instead of running side-by-side. Suspension enforcement is added as small, targeted checks inside already-existing services (`CredentialsService`, `TokenService`'s refresh flow, `BookingsService`, `HotelsService`/`VehiclesService`) rather than a new cross-cutting guard, since each of those services already has its own verification-style check this can sit beside. `VendorSuspensionService` is reused for traveler suspension (its methods operate on any `User.id`, with no vendor-specific logic) — as shipped, `suspend`/`unsuspend` gained an optional trailing `action: AdminActionType` parameter (defaulting to the original `VENDOR_SUSPENDED`/`VENDOR_UNSUSPENDED` literals) rather than being reused byte-for-byte, because a hardcoded `VENDOR_*` label would have permanently mislabelled every traveler suspension in the unified audit log; `TRAVELER_SUSPENDED`/`TRAVELER_UNSUSPENDED` were added to `AdminActionType` and `TravelerSuspensionController` passes them explicitly. Only the route prefix, Swagger docs, and that one explicit argument differ from the vendor controller. Booking control and analytics are platform-wide, unscoped reads/writes over `Booking`/`LedgerEntry`, reusing the `$queryRaw`/`Prisma.sql` conditional-fragment idiom already established in `vendor-dashboard.service.ts` (required wherever `Booking.dateRange` — an `Unsupported("daterange")` Prisma type — needs `checkIn`/`checkOut` extracted) and the `startOfDhakaDay`/`endOfDhakaMonth`-style helpers in `apps/api/src/common/date/dhaka-time.ts` for any time-bucketed aggregation (extended with new `startOfDhakaWeek`/`endOfDhakaWeek` helpers, following the identical existing pattern).

**Scope decisions (confirmed with the user):**

1. **Analytics stays light/operational, not deep.** Per the user's explicit choice, this plan adds _operational_ platform-wide analytics (revenue trend, booking-status breakdown, top vendors, district distribution) but leaves deeper per-vendor payout/settlement analytics for the future `add-earnings-analytics-dashboard` (ROADMAP 2.3) — avoiding scope duplication.
2. **Admin force-cancel never triggers a refund.** Matching real-world platform convention (Stripe/Airbnb-style: a support/ops action changes booking state, but money movement is always a separate, deliberate step) and this codebase's existing no-refund-on-CONFIRMED+PAID policy, admin force-cancel only changes `Booking.status` — it never touches `paymentStatus` or any refund path, since no refund API exists in this codebase at all yet.
3. **Traveler suspension reuses the exact same underlying mechanism as vendor suspension** (`User.suspendedAt`/`suspensionReason`, and the same `VendorSuspensionService.suspend`/`unsuspend` methods) — one suspension mechanism for both roles, differing in which capability-checks enforce it (traveler: login + new-booking-creation; vendor: login + new-booking-acceptance + new-listing + search-visibility) and, as shipped, in the `AdminActionType` label the audit log records: `suspend`/`unsuspend` take an optional trailing `action` parameter (default `VENDOR_SUSPENDED`/`VENDOR_UNSUSPENDED`) so `TravelerSuspensionController` can pass `TRAVELER_SUSPENDED`/`TRAVELER_UNSUSPENDED` instead — a hardcoded `VENDOR_*` literal would have permanently mislabelled every traveler suspension in the unified audit log. This was an explicit ruling from the project owner during the pre-flight scan, not the plan's original "verbatim reuse" design.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16. No new npm dependency.

## Global Constraints

- Every new/modified admin endpoint: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("ADMIN", "SUPER_ADMIN")` — no distinction between the two roles anywhere in this module.
- `passwordHash` must never appear in any response — every vendor-shaped response goes through the existing `toPublicUser()` mapper.
- All guarded state-transition writes use the established `updateMany({ where: { id, <guard-condition> }, ... })` + `count === 0 → ConflictException` pattern (never a plain `update` for a state transition).
- Existing `CONFIRMED`+`PAID` bookings are never touched by suspension — no code in this plan cancels, flags, or holds an existing `Booking` row.
- Money fields stay integer minor units; no floats introduced.
- Kebab-case file names, constructor DI (`private readonly x: X`), relative imports — matches every existing module.
- Every task ends green on `pnpm --filter @staybangla/api run test:unit` and/or `test:e2e` before moving to the next task.
- Any query touching `Booking.checkIn`/`checkOut` must use `$queryRaw`/`Prisma.sql` with `lower(date_range)::text`/`upper(date_range)::text` — Prisma Client cannot select the `Unsupported("daterange")` column at all.
- Admin force-cancel never writes to `paymentStatus` and never triggers any refund — it is a pure booking-status/ops action (see scope decision 2 above).
- Traveler suspension reuses `VendorSuspensionService.suspend`/`unsuspend` — no new suspend/unsuspend service is written for travelers, but (per the project owner's pre-flight-scan ruling) both methods gained an optional trailing `action: AdminActionType` parameter, defaulting to the original `VENDOR_SUSPENDED`/`VENDOR_UNSUSPENDED` literals, so `TravelerSuspensionController` can pass `TRAVELER_SUSPENDED`/`TRAVELER_UNSUSPENDED` and avoid mislabelling traveler suspensions as vendor ones in the audit log.
- Deep per-vendor payout/settlement analytics, automated payout calculation, and fraud-pattern detection are explicitly out of scope here — reserved for `add-earnings-analytics-dashboard` (ROADMAP 2.3) and `add-fraud-detection-analytics` (ROADMAP 3.5).

---

## File Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma                                          [MODIFY: +suspendedAt/suspensionReason on User, +AdminActionType enum, +AdminAuditLog model, -VendorVerificationLog]
│   └── migrations/<ts>_add_admin_panel/                        [NEW]
├── src/
│   ├── admin/
│   │   ├── admin.module.ts                                     [MODIFY: +AdminAuditLogService, +VendorSuspensionController/Service, +AdminOverviewController/Service, +VendorListController, +AdminBookingController/Service, +TravelerSuspensionController/TravelerListController, +AdminAnalyticsController/Service]
│   │   ├── admin-audit-log.service.ts(+.spec)                  [NEW]
│   │   ├── admin-audit-log.controller.ts(+.spec)               [NEW]
│   │   ├── vendor-suspension.service.ts(+.spec)                [NEW]
│   │   ├── vendor-suspension.controller.ts(+.spec)             [NEW]
│   │   ├── vendor-list.controller.ts(+.spec)                   [NEW]
│   │   ├── admin-overview.service.ts(+.spec)                   [NEW]
│   │   ├── admin-overview.controller.ts(+.spec)                [NEW]
│   │   ├── vendor-verification.service.ts(+.spec)              [MODIFY: write AdminAuditLog instead of VendorVerificationLog]
│   │   ├── vendor-verification.controller.ts(+.spec)           [MODIFY: remove getHistory/GET :id/history — superseded by audit-log endpoint]
│   │   ├── commission.controller.ts(+.spec)                    [MODIFY: read-before-update, write AdminAuditLog, 404 on missing vendor]
│   │   ├── admin-booking.service.ts(+.spec)                    [NEW — Task 9]
│   │   ├── admin-booking.controller.ts(+.spec)                 [NEW — Task 9]
│   │   ├── traveler-suspension.controller.ts(+.spec)           [NEW — Task 10, injects VendorSuspensionService]
│   │   ├── traveler-list.controller.ts(+.spec)                 [NEW — Task 10]
│   │   ├── admin-analytics.service.ts(+.spec)                  [NEW — Task 11]
│   │   ├── admin-analytics.controller.ts(+.spec)               [NEW — Task 11]
│   │   └── dto/
│   │       ├── suspend-vendor.dto.ts                           [NEW]
│   │       ├── vendor-list-query.dto.ts                        [NEW]
│   │       ├── audit-log-query.dto.ts                          [NEW]
│   │       ├── admin-booking-list-query.dto.ts                 [NEW — Task 9]
│   │       ├── force-cancel-booking.dto.ts                     [NEW — Task 9]
│   │       ├── traveler-list-query.dto.ts                      [NEW — Task 10]
│   │       └── analytics-query.dto.ts                          [NEW — Task 11]
│   ├── auth/
│   │   ├── credentials.service.ts(+.spec)                      [MODIFY: +suspension check in login()]
│   │   └── credentials.controller.ts(+.spec)                   [MODIFY: refresh()'s loadSubject callback +suspension check]
│   ├── bookings/
│   │   └── bookings.service.ts(+.spec)                         [MODIFY: +suspension check alongside existing verifiedStatus check, both branches; +traveler-suspension check in createBooking (Task 10)]
│   ├── hotels/
│   │   └── hotels.service.ts(+.spec)                           [MODIFY: assertVerifiedVendor +suspension check; searchAvailableRooms +suspended-owner exclusion]
│   ├── vehicles/
│   │   └── vehicles.service.ts(+.spec)                         [MODIFY: create() +suspension check; searchAvailable +suspended-owner exclusion]
│   └── common/date/
│       └── dhaka-time.ts(+.spec)                                [MODIFY: +startOfDhakaWeek/endOfDhakaWeek — Task 11]
└── test/
    ├── admin-panel.e2e-spec.ts                                  [NEW]
    ├── admin-booking.e2e-spec.ts                                [NEW — Task 9]
    ├── admin-traveler.e2e-spec.ts                                [NEW — Task 10]
    └── admin-analytics.e2e-spec.ts                               [NEW — Task 11]
```

---

## Task 1: Prisma schema — suspension fields + `AdminAuditLog` + retire `VendorVerificationLog`

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: migration folder `apps/api/prisma/migrations/<timestamp>_add_admin_panel/`

**Interfaces:**

- Produces: `User.suspendedAt`, `User.suspensionReason` fields; `AdminActionType` enum (`VENDOR_APPROVED | VENDOR_REJECTED | VENDOR_RESUBMITTED | VENDOR_SUSPENDED | VENDOR_UNSUSPENDED | COMMISSION_RATE_CHANGED`, later extended by Task 9/10 with `BOOKING_FORCE_CANCELLED`/`TRAVELER_SUSPENDED`/`TRAVELER_UNSUSPENDED`); `AdminAuditLog` model (`id, actorId, targetId, action, reason, metadata, createdAt`) — `targetId` is a polymorphic identifier with **no DB-level FK** (see below), not a Prisma relation field. Every later task's Prisma Client calls (`this.prisma.adminAuditLog.*`, `this.prisma.user.*` with `suspendedAt`) depend on these exact names. `VendorVerificationLog` model and both of its back-relations on `User` are removed; only one new back-relation is added (`adminAuditLogsAsActor`) — there is no `adminAuditLogsAsTarget`, since `targetId` is not a foreign key (see Step 1).

- [ ] **Step 1: Add the schema changes**

Modify `apps/api/prisma/schema.prisma` — add two fields to the existing `User` model (alongside `commissionRatePercent`):

```prisma
  suspendedAt      DateTime? @map("suspended_at")
  suspensionReason String?   @map("suspension_reason")
```

Replace `User`'s two `VendorVerificationLog` back-relations:

```prisma
  verificationLogsAsVendor VendorVerificationLog[] @relation("VendorVerificationTarget")
  verificationLogsAsAdmin  VendorVerificationLog[] @relation("VendorVerificationActor")
```

with:

```prisma
  adminAuditLogsAsActor  AdminAuditLog[] @relation("AdminAuditActor")
```

**As shipped, this is a single back-relation, not two.** `targetId` on `AdminAuditLog` is a polymorphic identifier — a `User.id` for `VENDOR_*`/`TRAVELER_*`/`COMMISSION_RATE_CHANGED` actions, but a `Booking.id` for `BOOKING_FORCE_CANCELLED` (added in Task 9) — so it cannot be a Prisma relation field to `User` at all; there is no `target User @relation(...)` and no `adminAuditLogsAsTarget` back-relation. See the note under Step 1's `AdminAuditLog` model below for why.

Delete the entire `VendorVerificationLog` model block (it currently reads):

```prisma
model VendorVerificationLog {
  id        String         @id @default(uuid())
  vendorId  String         @map("vendor_id")
  adminId   String         @map("admin_id")
  action    VerifiedStatus
  reason    String?
  createdAt DateTime       @default(now()) @map("created_at")

  vendor User @relation("VendorVerificationTarget", fields: [vendorId], references: [id])
  admin  User @relation("VendorVerificationActor", fields: [adminId], references: [id])

  @@index([vendorId])
  @@map("vendor_verification_logs")
}
```

Add the new enum and model in its place:

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
  id        String          @id @default(uuid())
  actorId   String          @map("actor_id")
  targetId  String          @map("target_id")
  action    AdminActionType
  reason    String?
  metadata  Json?
  createdAt DateTime        @default(now()) @map("created_at")

  actor  User @relation("AdminAuditActor", fields: [actorId], references: [id])

  @@index([targetId])
  @@index([actorId])
  @@index([createdAt])
  @@map("admin_audit_logs")
}
```

**As shipped, `targetId` has no `target User @relation(...)` field and no DB-level FK.** This was forced by Task 9: `BOOKING_FORCE_CANCELLED` needs `targetId` to hold a `Booking.id`, not a `User.id`, so a single `references: [id]` FK to `User` would either reject every force-cancel audit write or require a second nullable target column — both worse than the alternative. The column is documented (via a Prisma triple-slash comment on the field, in the real schema) as a polymorphic identifier: a `User.id` for `VENDOR_*`/`TRAVELER_*`/`COMMISSION_RATE_CHANGED` actions, a `Booking.id` for `BOOKING_FORCE_CANCELLED`. This also fits an append-only audit table better on its own terms — it should not FK to rows that may later be deleted, since that would either block the delete or force `ON DELETE SET NULL`/`CASCADE` semantics that don't belong on an audit trail. This was reviewed and accepted during Task 9; it is not a bug.

- [ ] **Step 2: Generate the migration SQL without applying (non-interactive shell — `prisma migrate dev` requires a TTY unavailable here)**

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p apps/api/prisma/migrations/${TS}_add_admin_panel
pnpm --filter @staybangla/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > apps/api/prisma/migrations/${TS}_add_admin_panel/migration.sql
```

- [ ] **Step 3: Add the data backfill to the generated migration, before the `DROP TABLE` for `vendor_verification_logs`**

The generated script will include a `DROP TABLE "vendor_verification_logs"` statement (Prisma detects the model removal). Before that line, insert a backfill that copies every existing row into the new table with the mapped action:

```sql
-- Backfill existing vendor_verification_logs rows into admin_audit_logs
-- before the old table is dropped. VerifiedStatus -> AdminActionType:
--   VERIFIED  -> VENDOR_APPROVED
--   REJECTED  -> VENDOR_REJECTED
--   PENDING   -> VENDOR_RESUBMITTED (a PENDING-action row only ever came
--     from VendorVerificationService.resubmit(), which sets action='PENDING')
INSERT INTO "admin_audit_logs" (id, actor_id, target_id, action, reason, metadata, created_at)
SELECT
  id,
  admin_id,
  vendor_id,
  CASE action
    WHEN 'VERIFIED' THEN 'VENDOR_APPROVED'
    WHEN 'REJECTED' THEN 'VENDOR_REJECTED'
    WHEN 'PENDING' THEN 'VENDOR_RESUBMITTED'
  END::"AdminActionType",
  reason,
  NULL,
  created_at
FROM "vendor_verification_logs";
```

If the generated script's statement order doesn't naturally place `CREATE TABLE "admin_audit_logs"` before `DROP TABLE "vendor_verification_logs"`, reorder manually so the sequence is: create `AdminActionType` enum → create `admin_audit_logs` table (with its indexes/FKs) → run the `INSERT ... SELECT` backfill above → drop `vendor_verification_logs`. The backfill must run after the new table exists and before the old one is dropped.

- [ ] **Step 4: Apply the migration to the dev database and regenerate the client**

```bash
pnpm --filter @staybangla/api exec prisma migrate deploy
pnpm --filter @staybangla/api exec prisma generate
```

- [ ] **Step 5: Apply the same migration to the `staybangla_test` database**

```bash
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
```

- [ ] **Step 6: Verify the backfill and schema**

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d admin_audit_logs"
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "SELECT action, count(*) FROM admin_audit_logs GROUP BY action;"
```

Expected: `admin_audit_logs` table exists with the documented columns; the count query returns rows only for `VENDOR_APPROVED`/`VENDOR_REJECTED`/`VENDOR_RESUBMITTED` if any pre-existing verification activity happened in this dev database (an empty result is equally correct if none did — it means there was nothing to backfill).

- [ ] **Step 7: Full unit regression run to confirm nothing broke from removing `VendorVerificationLog`**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `vendor-verification.service.ts`/`.spec.ts` and `commission.controller.ts` still reference `vendorVerificationLog`/lack audit logging; this is expected at this point (Tasks 2-4 fix them). Confirm the failures are exactly in those files, not elsewhere (a failure in an unrelated file would mean the schema change broke something this plan didn't anticipate).

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/add-admin-panel-basic
git add -A
git commit -m "feat(api): add AdminAuditLog schema, retire VendorVerificationLog, add User suspension fields"
```

---

## Task 2: `VendorVerificationService` — write to `AdminAuditLog`

**Files:**

- Modify: `apps/api/src/admin/vendor-verification.service.ts`
- Modify: `apps/api/src/admin/vendor-verification.service.spec.ts`

**Interfaces:**

- Consumes: `AdminAuditLog`/`AdminActionType` (Task 1).
- Produces: `VendorVerificationService.approve`/`reject`/`resubmit` unchanged signatures (`Promise<User>`), now writing `AdminAuditLog` instead of the removed `VendorVerificationLog`. `getHistory` is **removed** from this service (superseded by Task 3's `AdminAuditLogService.list`).

- [ ] **Step 1: Read the current spec file to see its exact mock shape**

Read `apps/api/src/admin/vendor-verification.service.spec.ts` in full before editing — it currently mocks `prisma.vendorVerificationLog.create`/`prisma.vendorVerificationLog.findMany` and `prisma.user.updateMany`/`findUniqueOrThrow`. Every mock referencing `vendorVerificationLog` needs to become `adminAuditLog`.

- [ ] **Step 2: Update the failing tests**

Replace every `prisma.vendorVerificationLog.create` mock/assertion with `prisma.adminAuditLog.create`, and update the expected `data` shape from `{ vendorId, adminId, action, reason }` to `{ targetId: vendorId, actorId: adminId, action: <AdminActionType value>, reason }`:

- The `approve` test: expect `prisma.adminAuditLog.create` called with `{ data: { targetId: "vendor-id", actorId: "admin-id", action: "VENDOR_APPROVED", reason: undefined } }`.
- The `reject` test: expect `action: "VENDOR_REJECTED"`.
- The `resubmit` test: expect `action: "VENDOR_RESUBMITTED"`, `actorId` equal to `targetId` (both the vendor's own id).
- Remove the `getHistory` describe block entirely (that method is deleted in Step 4 below) — its test coverage moves to Task 3's `AdminAuditLogService` spec.

If the current spec mocks `prisma` as a plain object (e.g. `{ user: {...}, vendorVerificationLog: {...} }`), rename the `vendorVerificationLog` key to `adminAuditLog` in that mock object too.

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.service`
Expected: FAIL — `vendor-verification.service.ts` still calls `prisma.vendorVerificationLog.create`, which no longer exists on the Prisma Client (removed in Task 1), so `this.prisma.adminAuditLog` in the test mock is never actually invoked by the untouched implementation.

- [ ] **Step 4: Implement**

Replace the full contents of `apps/api/src/admin/vendor-verification.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class VendorVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listPending(): Promise<User[]> {
    return this.prisma.user.findMany({ where: { verifiedStatus: "PENDING" } });
  }

  async approve(adminId: string, vendorId: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "PENDING" },
      data: { verifiedStatus: "VERIFIED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently pending review");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_APPROVED",
        reason: undefined,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async reject(
    adminId: string,
    vendorId: string,
    reason: string,
  ): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "PENDING" },
      data: { verifiedStatus: "REJECTED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently pending review");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_REJECTED",
        reason,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async resubmit(vendorId: string): Promise<User> {
    const vendor = await this.prisma.user.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException("User not found");

    if (vendor.verifiedStatus !== "REJECTED") {
      return vendor; // idempotent no-op: already PENDING or VERIFIED
    }

    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "REJECTED" },
      data: { verifiedStatus: "PENDING" },
    });
    if (result.count === 1) {
      await this.prisma.adminAuditLog.create({
        data: {
          targetId: vendorId,
          actorId: vendorId, // self-service action; there is no admin actor for a resubmit
          action: "VENDOR_RESUBMITTED",
          reason: undefined,
        },
      });
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
```

Note: `getHistory` is deleted from this class entirely — Task 5 will remove its corresponding controller route.

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): VendorVerificationService writes to AdminAuditLog"
```

---

## Task 3: `AdminAuditLogService` + `AdminAuditLogController`

**Files:**

- Create: `apps/api/src/admin/admin-audit-log.service.ts`
- Create: `apps/api/src/admin/admin-audit-log.service.spec.ts`
- Create: `apps/api/src/admin/admin-audit-log.controller.ts`
- Create: `apps/api/src/admin/admin-audit-log.controller.spec.ts`
- Create: `apps/api/src/admin/dto/audit-log-query.dto.ts`

**Interfaces:**

- Consumes: `PrismaService`.
- Produces: `AdminAuditLogService.list(filter: AuditLogFilter): Promise<{ items: AdminAuditLog[]; page: number; pageSize: number; total: number }>` — Task 8 (final wiring check) and the e2e task rely on this exact shape. `AuditLogFilter = { vendorId?: string; adminId?: string; page?: number; pageSize?: number }`.

- [ ] **Step 1: DTO**

`apps/api/src/admin/dto/audit-log-query.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  adminId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
```

- [ ] **Step 2: Write the failing service tests**

`apps/api/src/admin/admin-audit-log.service.spec.ts`:

```ts
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditLogService } from "./admin-audit-log.service";

describe("AdminAuditLogService", () => {
  let service: AdminAuditLogService;
  let prisma: {
    adminAuditLog: { findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      adminAuditLog: { findMany: jest.fn(), count: jest.fn() },
    };
    service = new AdminAuditLogService(prisma as unknown as PrismaService);
  });

  it("filters by vendorId (targetId) only", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ vendorId: "vendor1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetId: "vendor1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
    expect(prisma.adminAuditLog.count).toHaveBeenCalledWith({
      where: { targetId: "vendor1" },
    });
  });

  it("filters by adminId (actorId) only", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ adminId: "admin1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { actorId: "admin1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("returns the full platform feed when neither filter is given", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({});

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("combines vendorId and adminId when both given", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(0);

    await service.list({ vendorId: "vendor1", adminId: "admin1" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetId: "vendor1", actorId: "admin1" },
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 50,
    });
  });

  it("applies page/pageSize as skip/take, defaulting to page 1 / pageSize 50", async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.count.mockResolvedValue(120);

    const result = await service.list({ page: 3, pageSize: 20 });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      skip: 40,
      take: 20,
    });
    expect(result).toEqual({
      items: [],
      page: 3,
      pageSize: 20,
      total: 120,
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-audit-log.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the service**

`apps/api/src/admin/admin-audit-log.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { AdminAuditLog } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogFilter {
  vendorId?: string;
  adminId?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogResult {
  items: AdminAuditLog[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: AuditLogFilter): Promise<AuditLogResult> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const where: Record<string, string> = {};
    if (filter.vendorId) where.targetId = filter.vendorId;
    if (filter.adminId) where.actorId = filter.adminId;

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-audit-log.service`
Expected: PASS.

- [ ] **Step 6: Write the failing controller test**

`apps/api/src/admin/admin-audit-log.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminAuditLogService } from "./admin-audit-log.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminAuditLogController", () => {
  let controller: AdminAuditLogController;
  let service: { list: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuditLogController],
      providers: [{ provide: AdminAuditLogService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminAuditLogController);
  });

  it("delegates to AdminAuditLogService.list with the query params", async () => {
    service.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });

    await controller.list({
      vendorId: "vendor1",
      adminId: "admin1",
      page: 2,
      pageSize: 10,
    });

    expect(service.list).toHaveBeenCalledWith({
      vendorId: "vendor1",
      adminId: "admin1",
      page: 2,
      pageSize: 10,
    });
  });
});
```

- [ ] **Step 7: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-audit-log.controller`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the controller**

`apps/api/src/admin/admin-audit-log.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  AdminAuditLogService,
  AuditLogResult,
} from "./admin-audit-log.service";
import { AuditLogQueryDto } from "./dto/audit-log-query.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/audit-log")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminAuditLogController {
  constructor(private readonly auditLogService: AdminAuditLogService) {}

  @ApiOperation({
    summary:
      "List admin actions (ADMIN/SUPER_ADMIN only) — filter by vendor, by admin, or view the full platform feed",
  })
  @ApiResponse({ status: 200, description: "Paginated audit log entries." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: AuditLogQueryDto): Promise<AuditLogResult> {
    return this.auditLogService.list({
      vendorId: query.vendorId,
      adminId: query.adminId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
```

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-audit-log.controller`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add AdminAuditLogService/Controller for GET /admin/audit-log"
```

---

## Task 4: `VendorSuspensionService` + `VendorSuspensionController`

**Files:**

- Create: `apps/api/src/admin/vendor-suspension.service.ts`
- Create: `apps/api/src/admin/vendor-suspension.service.spec.ts`
- Create: `apps/api/src/admin/vendor-suspension.controller.ts`
- Create: `apps/api/src/admin/vendor-suspension.controller.spec.ts`
- Create: `apps/api/src/admin/dto/suspend-vendor.dto.ts`

**Interfaces:**

- Consumes: `AdminAuditLog`/`AdminActionType` (Task 1), `toPublicUser`/`PublicUser` (existing, `apps/api/src/users/to-public-user.ts`).
- Produces: `VendorSuspensionService.suspend(adminId: string, vendorId: string, reason: string): Promise<User>`, `VendorSuspensionService.unsuspend(adminId: string, vendorId: string): Promise<User>` — Tasks 6/7/e2e depend on these exact names and on `User.suspendedAt`/`suspensionReason` being set/cleared by them.

- [ ] **Step 1: DTO**

`apps/api/src/admin/dto/suspend-vendor.dto.ts`:

```ts
import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class SuspendVendorDto {
  @ApiProperty({
    example: "Repeated customer complaints about non-existent listings.",
    description: "Shown to the vendor and recorded in the audit log.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

- [ ] **Step 2: Write the failing service tests**

`apps/api/src/admin/vendor-suspension.service.spec.ts`:

```ts
import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorSuspensionService } from "./vendor-suspension.service";

describe("VendorSuspensionService", () => {
  let service: VendorSuspensionService;
  let prisma: {
    user: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    service = new VendorSuspensionService(prisma as unknown as PrismaService);
  });

  describe("suspend", () => {
    it("sets suspendedAt/suspensionReason and writes an audit log row", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "vendor1",
        suspendedAt: new Date(),
        suspensionReason: "fraud",
      });

      await service.suspend("admin1", "vendor1", "fraud");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "vendor1", suspendedAt: null },
        data: {
          suspendedAt: expect.any(Date),
          suspensionReason: "fraud",
        },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "vendor1",
          actorId: "admin1",
          action: "VENDOR_SUSPENDED",
          reason: "fraud",
        },
      });
    });

    it("throws ConflictException when the vendor is already suspended", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.suspend("admin1", "vendor1", "fraud"),
      ).rejects.toThrow(ConflictException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("unsuspend", () => {
    it("clears suspendedAt/suspensionReason and writes an audit log row", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "vendor1",
        suspendedAt: null,
        suspensionReason: null,
      });

      await service.unsuspend("admin1", "vendor1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "vendor1", suspendedAt: { not: null } },
        data: { suspendedAt: null, suspensionReason: null },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "vendor1",
          actorId: "admin1",
          action: "VENDOR_UNSUSPENDED",
          reason: undefined,
        },
      });
    });

    it("throws ConflictException when the vendor is not currently suspended", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.unsuspend("admin1", "vendor1")).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-suspension.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the service**

`apps/api/src/admin/vendor-suspension.service.ts`:

```ts
import { ConflictException, Injectable } from "@nestjs/common";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class VendorSuspensionService {
  constructor(private readonly prisma: PrismaService) {}

  async suspend(
    adminId: string,
    vendorId: string,
    reason: string,
  ): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, suspendedAt: null },
      data: { suspendedAt: new Date(), suspensionReason: reason },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is already suspended");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_SUSPENDED",
        reason,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async unsuspend(adminId: string, vendorId: string): Promise<User> {
    const result = await this.prisma.user.updateMany({
      where: { id: vendorId, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspensionReason: null },
    });
    if (result.count === 0) {
      throw new ConflictException("Vendor is not currently suspended");
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: vendorId,
        actorId: adminId,
        action: "VENDOR_UNSUSPENDED",
        reason: undefined,
      },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-suspension.service`
Expected: PASS.

- [ ] **Step 6: Write the failing controller test**

`apps/api/src/admin/vendor-suspension.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { VendorSuspensionController } from "./vendor-suspension.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorSuspensionController", () => {
  let controller: VendorSuspensionController;
  let service: { suspend: jest.Mock; unsuspend: jest.Mock };

  beforeEach(async () => {
    service = { suspend: jest.fn(), unsuspend: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorSuspensionController],
      providers: [{ provide: VendorSuspensionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorSuspensionController);
  });

  it("suspend() delegates to VendorSuspensionService.suspend with the caller's id, target id, and reason", async () => {
    service.suspend.mockResolvedValue({
      id: "vendor1",
      passwordHash: "secret",
    });

    const result = await controller.suspend(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
      { reason: "fraud" },
    );

    expect(service.suspend).toHaveBeenCalledWith("admin1", "vendor1", "fraud");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("unsuspend() delegates to VendorSuspensionService.unsuspend", async () => {
    service.unsuspend.mockResolvedValue({
      id: "vendor1",
      passwordHash: "secret",
    });

    const result = await controller.unsuspend(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
    );

    expect(service.unsuspend).toHaveBeenCalledWith("admin1", "vendor1");
    expect(result).not.toHaveProperty("passwordHash");
  });
});
```

- [ ] **Step 7: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-suspension.controller`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the controller**

`apps/api/src/admin/vendor-suspension.controller.ts`:

```ts
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
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
import { VendorSuspensionService } from "./vendor-suspension.service";
import { SuspendVendorDto } from "./dto/suspend-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorSuspensionController {
  constructor(
    private readonly vendorSuspensionService: VendorSuspensionService,
  ) {}

  @ApiOperation({
    summary: "Suspend a vendor (ADMIN/SUPER_ADMIN only)",
    description:
      "Blocks the vendor's login, new bookings, new listings, and search visibility. Existing CONFIRMED/PAID bookings are unaffected.",
  })
  @ApiResponse({ status: 201, description: "Vendor is now suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Vendor is already suspended." })
  @Post(":id/suspend")
  async suspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: SuspendVendorDto,
  ): Promise<PublicUser> {
    const vendor = await this.vendorSuspensionService.suspend(
      admin.id,
      id,
      dto.reason,
    );
    return toPublicUser(vendor);
  }

  @ApiOperation({ summary: "Unsuspend a vendor (ADMIN/SUPER_ADMIN only)" })
  @ApiResponse({ status: 201, description: "Vendor is no longer suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Vendor is not currently suspended.",
  })
  @Post(":id/unsuspend")
  async unsuspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const vendor = await this.vendorSuspensionService.unsuspend(admin.id, id);
    return toPublicUser(vendor);
  }
}
```

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-suspension.controller`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorSuspensionService/Controller for suspend/unsuspend"
```

---

## Task 5: Enforce suspension — login, refresh, bookings, listings, search

**Files:**

- Modify: `apps/api/src/auth/credentials.service.ts`
- Modify: `apps/api/src/auth/credentials.service.spec.ts`
- Modify: `apps/api/src/auth/credentials.controller.ts`
- Modify: `apps/api/src/auth/credentials.controller.spec.ts`
- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/bookings/bookings.service.spec.ts`
- Modify: `apps/api/src/hotels/hotels.service.ts`
- Modify: `apps/api/src/hotels/hotels.service.spec.ts`
- Modify: `apps/api/src/vehicles/vehicles.service.ts`
- Modify: `apps/api/src/vehicles/vehicles.service.spec.ts`

**Interfaces:**

- Consumes: `User.suspendedAt` (Task 1).
- Produces: no new public method signatures — every change adds a check inside an existing method body. Later tasks (e2e) rely on these exact HTTP outcomes: suspended-vendor login → `403`; suspended-vendor refresh → fails (existing refresh-failure shape); suspended-vendor's room/vehicle booking attempt → `403` (reusing existing `ForbiddenException` path); suspended-vendor's own listing creation → `403`; suspended-vendor's listings excluded from `GET /rooms/available`/`GET /vehicles/available`.

- [ ] **Step 1: Write the failing tests — `CredentialsService.login`**

Read `apps/api/src/auth/credentials.service.spec.ts` first to see its exact current mock shape (it mocks `usersService.findByIdentifier`, `passwordService.verify`, `tokenService.issueTokenPair`). Append:

```ts
it("rejects login for a suspended vendor with a 403, not the generic 401 invalid-credentials message", async () => {
  usersService.findByIdentifier.mockResolvedValue({
    id: "vendor1",
    passwordHash: "$argon2id$hashed",
    suspendedAt: new Date(),
    roles: [{ role: "VENDOR" }],
  });
  passwordService.verify.mockResolvedValue(true);

  await expect(
    service.login("vendor@example.com", "correct-password"),
  ).rejects.toThrow(/suspended/i);
  expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- credentials.service`
Expected: FAIL — `login` doesn't check `suspendedAt` yet, so it proceeds to `issueTokenPair`.

- [ ] **Step 3: Implement — `CredentialsService.login`**

In `apps/api/src/auth/credentials.service.ts`, add `ForbiddenException` to the existing `@nestjs/common` import, and insert a check in `login` right after the password-verification block, before the `roles`/`issueTokenPair` lines:

```ts
if (user.suspendedAt !== null) {
  throw new ForbiddenException("This account is suspended and cannot log in");
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- credentials.service`
Expected: PASS.

- [ ] **Step 5: Write the failing test — `CredentialsController.refresh`'s `loadSubject` callback**

Read `apps/api/src/auth/credentials.controller.spec.ts` first for its current mock shape (it mocks `tokenService.rotateRefreshToken`, `usersService.findById`). Append:

```ts
it("refresh() rejects when the token's user is suspended, via the loadSubject callback passed to rotateRefreshToken", async () => {
  usersService.findById.mockResolvedValue({
    id: "vendor1",
    suspendedAt: new Date(),
    roles: [{ role: "VENDOR" }],
  });
  tokenService.rotateRefreshToken.mockImplementation(
    async (
      _token: string,
      loadSubject: (userId: string) => Promise<unknown>,
    ) => {
      await loadSubject("vendor1");
      throw new Error("unreachable — loadSubject should have thrown first");
    },
  );

  await expect(
    controller.refresh(
      { cookies: { refreshToken: "some-token" } } as never,
      { cookie: jest.fn() } as never,
    ),
  ).rejects.toThrow(/suspended/i);
});
```

- [ ] **Step 6: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- credentials.controller`
Expected: FAIL — the current `loadSubject` callback in `refresh()` never checks `suspendedAt`, so it resolves normally instead of throwing.

- [ ] **Step 7: Implement — `CredentialsController.refresh`'s `loadSubject` callback**

In `apps/api/src/auth/credentials.controller.ts`, modify the `loadSubject` callback inside `refresh()` (currently `async (userId) => { const user = await this.usersService.findById(userId); ... return { id: userId, roles }; }`) to check suspension before returning:

```ts
const { accessToken, refreshToken } =
  await this.tokenService.rotateRefreshToken(presented, async (userId) => {
    const user = await this.usersService.findById(userId);
    if (user?.suspendedAt) {
      throw new UnauthorizedException(
        "This account is suspended and cannot refresh its session",
      );
    }
    const roles =
      (user as { roles?: { role: string }[] } | null)?.roles?.map(
        (r) => r.role,
      ) ?? [];
    return { id: userId, roles };
  });
```

Add `UnauthorizedException` to the existing `@nestjs/common` import if not already present.

- [ ] **Step 8: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- credentials.controller`
Expected: PASS.

- [ ] **Step 9: Write the failing tests — `BookingsService.createBooking`**

Read `apps/api/src/bookings/bookings.service.spec.ts` first for its exact mock shape for `createBooking`'s room/vehicle-owner lookups. Append two tests (one per branch):

```ts
it("rejects a booking on a room whose owner is suspended", async () => {
  prisma.room.findUnique.mockResolvedValue({
    id: "room1",
    isActive: true,
    capacity: 2,
    pricePerNightMinor: 5000,
    currency: "BDT",
    hotel: {
      ownerId: "vendor1",
      owner: { verifiedStatus: "VERIFIED", suspendedAt: new Date() },
    },
  });

  await expect(
    service.createBooking("traveler1", {
      bookableType: "ROOM",
      bookableId: "room1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
    }),
  ).rejects.toThrow(/suspended/i);
});

it("rejects a booking on a vehicle whose owner is suspended", async () => {
  prisma.vehicle.findUnique.mockResolvedValue({
    id: "veh1",
    isActive: true,
    capacity: 4,
    pricePerDayMinor: 3000,
    currency: "BDT",
    owner: { verifiedStatus: "VERIFIED", suspendedAt: new Date() },
  });

  await expect(
    service.createBooking("traveler1", {
      bookableType: "VEHICLE",
      bookableId: "veh1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
    }),
  ).rejects.toThrow(/suspended/i);
});
```

- [ ] **Step 10: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: FAIL — `createBooking` doesn't check `suspendedAt` on either owner yet.

- [ ] **Step 11: Implement — `BookingsService.createBooking`**

In `apps/api/src/bookings/bookings.service.ts`, modify both branches of the existing owner-verification block:

```ts
if (room.hotel.owner.verifiedStatus !== "VERIFIED") {
  throw new ForbiddenException("This listing's owner is not verified");
}
if (room.hotel.owner.suspendedAt !== null) {
  throw new ForbiddenException("This listing's owner is suspended");
}
```

and, in the vehicle branch:

```ts
if (vehicle.owner.verifiedStatus !== "VERIFIED") {
  throw new ForbiddenException("This listing's owner is not verified");
}
if (vehicle.owner.suspendedAt !== null) {
  throw new ForbiddenException("This listing's owner is suspended");
}
```

- [ ] **Step 12: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: PASS.

- [ ] **Step 13: Write the failing tests — `HotelsService.create` / `VehiclesService.create`**

Read `apps/api/src/hotels/hotels.service.spec.ts` and `apps/api/src/vehicles/vehicles.service.spec.ts` first for their exact mock shapes (both mock `usersService.findById`). Append to each:

`hotels.service.spec.ts`:

```ts
it("rejects hotel creation when the caller is suspended", async () => {
  usersService.findById.mockResolvedValue({
    verifiedStatus: "VERIFIED",
    suspendedAt: new Date(),
  });

  await expect(
    service.create("vendor1", {
      name: "Test Hotel",
      city: "DHAKA",
      address: "123 Road",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    }),
  ).rejects.toThrow(/suspended/i);
});
```

`vehicles.service.spec.ts`:

```ts
it("rejects vehicle creation when the caller is suspended", async () => {
  usersService.findById.mockResolvedValue({
    verifiedStatus: "VERIFIED",
    suspendedAt: new Date(),
  });

  await expect(
    service.create("vendor1", {
      category: "CNG",
      city: "DHAKA",
      capacity: 4,
      pricePerDayMinor: 3000,
    }),
  ).rejects.toThrow(/suspended/i);
});
```

- [ ] **Step 14: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service vehicles.service`
Expected: FAIL — neither `create` method checks `suspendedAt` on the caller yet.

- [ ] **Step 15: Implement — `HotelsService.create` (via its `assertVerifiedVendor` private method)**

In `apps/api/src/hotels/hotels.service.ts`, modify `assertVerifiedVendor`:

```ts
  private async assertVerifiedVendor(ownerId: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
    if (owner.suspendedAt !== null) {
      throw new ForbiddenException("Your account is suspended");
    }
  }
```

- [ ] **Step 16: Implement — `VehiclesService.create`**

In `apps/api/src/vehicles/vehicles.service.ts`, modify `create`:

```ts
  async create(ownerId: string, input: CreateVehicleInput): Promise<Vehicle> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
    if (owner.suspendedAt !== null) {
      throw new ForbiddenException("Your account is suspended");
    }
    return this.prisma.vehicle.create({ data: { ownerId, ...input } });
  }
```

- [ ] **Step 17: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service vehicles.service`
Expected: PASS.

- [ ] **Step 18: Write the failing tests — search exclusion**

Read `apps/api/src/hotels/hotels.service.spec.ts` and `apps/api/src/vehicles/vehicles.service.spec.ts` for their `searchAvailableRooms`/`searchAvailable` test setup (both mock `prisma.$queryRaw`). Since these are raw-SQL queries, add a test asserting the query text now includes the suspension exclusion — reusing the existing pattern already in this codebase's `vendor-dashboard.service.spec.ts` (Task 6 of that module's plan) for asserting on `Prisma.sql` call contents:

`hotels.service.spec.ts`:

```ts
it("excludes suspended owners' rooms from the availability query", async () => {
  prisma.$queryRaw.mockResolvedValue([]);

  await service.searchAvailableRooms("2026-09-01", "2026-09-03");

  const [sqlObject] = prisma.$queryRaw.mock.calls[0];
  const rendered = sqlObject.strings.join("");
  expect(rendered).toContain("suspended_at");
});
```

`vehicles.service.spec.ts`:

```ts
it("excludes suspended owners' vehicles from the availability query", async () => {
  prisma.$queryRaw.mockResolvedValue([]);

  await service.searchAvailable("2026-09-01", "2026-09-03");

  const [sqlObject] = prisma.$queryRaw.mock.calls[0];
  const rendered = sqlObject.strings.join("");
  expect(rendered).toContain("suspended_at");
});
```

- [ ] **Step 19: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service vehicles.service`
Expected: FAIL — neither query currently references `suspended_at`.

- [ ] **Step 20: Implement — `HotelsService.searchAvailableRooms`**

In `apps/api/src/hotels/hotels.service.ts`, modify the `WHERE` clause of `searchAvailableRooms`'s raw SQL — add the suspension exclusion alongside the existing `is_active` checks:

```ts
return this.prisma.$queryRaw<RoomAvailability[]>(Prisma.sql`
      SELECT r.id, r.hotel_id AS "hotelId", r.room_type AS "roomType",
             r.price_per_night_minor AS "pricePerNightMinor", r.currency, r.capacity
      FROM rooms r
      JOIN hotels h ON h.id = r.hotel_id
      WHERE r.is_active = true AND h.is_active = true ${cityFilter}
        AND h.owner_id NOT IN (SELECT id FROM users WHERE suspended_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
        )
    `);
```

- [ ] **Step 21: Implement — `VehiclesService.searchAvailable`**

In `apps/api/src/vehicles/vehicles.service.ts`, modify the `WHERE` clause of `searchAvailable`'s raw SQL:

```ts
return this.prisma.$queryRaw<VehicleAvailability[]>(Prisma.sql`
      SELECT v.id, v.category, v.city, v.model, v.capacity,
             v.price_per_day_minor AS "pricePerDayMinor", v.currency
      FROM vehicles v
      WHERE v.is_active = true ${cityFilter}
        AND v.owner_id NOT IN (SELECT id FROM users WHERE suspended_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.vehicle_id = v.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${startDate}::date, ${endDate}::date, '[)')
        )
    `);
```

- [ ] **Step 22: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service vehicles.service`
Expected: PASS.

- [ ] **Step 23: Full unit regression run**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS — all suites green, including Task 2's `vendor-verification.service` and the still-pending `commission.controller` (Task 6 fixes that one; if it's still failing at this point, that's expected and addressed next task, not a regression from this task's changes — confirm by checking the failure is isolated to `commission.controller`/`commission.controller.spec.ts` only).

- [ ] **Step 24: Commit**

```bash
git add -A
git commit -m "feat(api): enforce vendor suspension across login, refresh, bookings, listings, search"
```

---

## Task 6: `CommissionController` — audit log + fix the 404 gap

**Files:**

- Modify: `apps/api/src/admin/commission.controller.ts`
- Modify: `apps/api/src/admin/commission.controller.spec.ts`

**Interfaces:**

- Consumes: `AdminAuditLog`/`AdminActionType` (Task 1).
- Produces: `CommissionController.update` keeps its existing signature (`(id: string, dto: UpdateCommissionDto) => Promise<Pick<User, "id" | "commissionRatePercent">>` from the controller's perspective, now with an added `@CurrentUser()` parameter) — no other task depends on this controller's internals.

- [ ] **Step 1: Read the current spec file for its exact mock shape**

Read `apps/api/src/admin/commission.controller.spec.ts` in full (already known to mock `prisma.user.update` directly) — this task changes the controller to read-then-update-then-log, so every existing assertion on `prisma.user.update`'s exact call shape needs updating, and two new mocks (`prisma.user.findUnique`, `prisma.adminAuditLog.create`) are needed.

- [ ] **Step 2: Write the failing tests**

Replace the full contents of `apps/api/src/admin/commission.controller.spec.ts`:

```ts
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CommissionController } from "./commission.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("CommissionController", () => {
  let controller: CommissionController;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CommissionController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(CommissionController);
  });

  it("updates the vendor's commissionRatePercent and writes an audit log row with old/new rates", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 10,
    });
    prisma.user.update.mockResolvedValue({
      id: "vendor1",
      commissionRatePercent: 15,
    });

    const result = await controller.update(
      { id: "admin1", roles: ["ADMIN"] },
      "vendor1",
      { commissionRatePercent: 15 },
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "vendor1" },
      data: { commissionRatePercent: 15 },
      select: { id: true, commissionRatePercent: true },
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        targetId: "vendor1",
        actorId: "admin1",
        action: "COMMISSION_RATE_CHANGED",
        reason: undefined,
        metadata: { oldRatePercent: 10, newRatePercent: 15 },
      },
    });
    expect(result).toEqual({ id: "vendor1", commissionRatePercent: 15 });
  });

  it("throws NotFoundException when the vendor does not exist, instead of a raw Prisma error", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      controller.update({ id: "admin1", roles: ["ADMIN"] }, "nonexistent", {
        commissionRatePercent: 15,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- commission.controller`
Expected: FAIL — `controller.update` doesn't accept a `@CurrentUser()` first argument yet, doesn't check existence, and doesn't write an audit log.

- [ ] **Step 4: Implement**

Replace the full contents of `apps/api/src/admin/commission.controller.ts`:

```ts
import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
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
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
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
  @ApiResponse({ status: 404, description: "Vendor not found." })
  @Patch(":id/commission")
  async update(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateCommissionDto,
  ): Promise<Pick<User, "id" | "commissionRatePercent">> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Vendor not found");
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { commissionRatePercent: dto.commissionRatePercent },
      select: { id: true, commissionRatePercent: true },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        targetId: id,
        actorId: admin.id,
        action: "COMMISSION_RATE_CHANGED",
        reason: undefined,
        metadata: {
          oldRatePercent: existing.commissionRatePercent,
          newRatePercent: dto.commissionRatePercent,
        },
      },
    });

    return updated;
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- commission.controller`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(api): CommissionController writes audit log and returns 404 for missing vendor"
```

---

## Task 7: `AdminOverviewService`/`Controller` + `VendorListController` + retire the old history/pending routes

**Files:**

- Create: `apps/api/src/admin/admin-overview.service.ts`
- Create: `apps/api/src/admin/admin-overview.service.spec.ts`
- Create: `apps/api/src/admin/admin-overview.controller.ts`
- Create: `apps/api/src/admin/admin-overview.controller.spec.ts`
- Create: `apps/api/src/admin/vendor-list.controller.ts`
- Create: `apps/api/src/admin/vendor-list.controller.spec.ts`
- Create: `apps/api/src/admin/dto/vendor-list-query.dto.ts`
- Modify: `apps/api/src/admin/vendor-verification.controller.ts`
- Modify: `apps/api/src/admin/vendor-verification.controller.spec.ts`

**Interfaces:**

- Consumes: `startOfDhakaMonth`/`endOfDhakaMonth` (existing, `apps/api/src/common/date/dhaka-time.ts`, from `add-vendor-dashboard-basic`), `toPublicUser`/`PublicUser` (existing).
- Produces: `AdminOverviewService.getOverview(): Promise<PlatformOverview>`, `VendorListController.list(query): Promise<PublicUser[]>` — no later task in this plan depends on these, they're the final read-facing pieces.

- [ ] **Step 1: DTO**

`apps/api/src/admin/dto/vendor-list-query.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from "class-validator";

export class VendorListQueryDto {
  @IsOptional()
  @IsIn(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"])
  status?: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

  @IsOptional()
  @IsString()
  search?: string;
}
```

- [ ] **Step 2: Write the failing overview-service tests**

`apps/api/src/admin/admin-overview.service.spec.ts`:

```ts
import { PrismaService } from "../prisma/prisma.service";
import { AdminOverviewService } from "./admin-overview.service";

describe("AdminOverviewService", () => {
  let service: AdminOverviewService;
  let prisma: {
    userRole: { count: jest.Mock };
    booking: { count: jest.Mock };
    hotel: { count: jest.Mock };
    vehicle: { count: jest.Mock };
    user: { count: jest.Mock };
    ledgerEntry: { groupBy: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      userRole: { count: jest.fn() },
      booking: { count: jest.fn() },
      hotel: { count: jest.fn() },
      vehicle: { count: jest.fn() },
      user: { count: jest.fn() },
      ledgerEntry: { groupBy: jest.fn() },
    };
    service = new AdminOverviewService(prisma as unknown as PrismaService);
  });

  it("returns headline counts and Dhaka-month-scoped revenue broken out by ledger type", async () => {
    prisma.userRole.count.mockImplementation(
      async ({ where }: { where: { role: string } }) =>
        where.role === "VENDOR" ? 42 : 310,
    );
    prisma.booking.count.mockResolvedValue(128);
    prisma.hotel.count.mockResolvedValue(30);
    prisma.vehicle.count.mockResolvedValue(15);
    prisma.user.count.mockResolvedValue(2);
    prisma.ledgerEntry.groupBy.mockResolvedValue([
      { type: "GROSS_PAYMENT", _sum: { amountMinor: 4500000 } },
      { type: "PLATFORM_FEE", _sum: { amountMinor: 450000 } },
      { type: "VENDOR_OWED", _sum: { amountMinor: 4050000 } },
    ]);

    const result = await service.getOverview();

    expect(result).toEqual({
      totalVendors: 42,
      totalTravelers: 310,
      totalBookings: 128,
      totalHotels: 30,
      totalVehicles: 15,
      activeSuspensions: 2,
      monthlyRevenue: {
        grossMinor: 4500000,
        platformFeeMinor: 450000,
        vendorOwedMinor: 4050000,
      },
    });
  });

  it("returns zero revenue fields when there are no ledger entries this month", async () => {
    prisma.userRole.count.mockResolvedValue(0);
    prisma.booking.count.mockResolvedValue(0);
    prisma.hotel.count.mockResolvedValue(0);
    prisma.vehicle.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);
    prisma.ledgerEntry.groupBy.mockResolvedValue([]);

    const result = await service.getOverview();

    expect(result.monthlyRevenue).toEqual({
      grossMinor: 0,
      platformFeeMinor: 0,
      vendorOwedMinor: 0,
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-overview.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the service**

`apps/api/src/admin/admin-overview.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { startOfDhakaMonth, endOfDhakaMonth } from "../common/date/dhaka-time";

export interface PlatformOverview {
  totalVendors: number;
  totalTravelers: number;
  totalBookings: number;
  totalHotels: number;
  totalVehicles: number;
  activeSuspensions: number;
  monthlyRevenue: {
    grossMinor: number;
    platformFeeMinor: number;
    vendorOwedMinor: number;
  };
}

@Injectable()
export class AdminOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<PlatformOverview> {
    const now = new Date();
    const monthStart = startOfDhakaMonth(now);
    const monthEnd = endOfDhakaMonth(now);

    const [
      totalVendors,
      totalTravelers,
      totalBookings,
      totalHotels,
      totalVehicles,
      activeSuspensions,
      revenueByType,
    ] = await Promise.all([
      this.prisma.userRole.count({ where: { role: "VENDOR" } }),
      this.prisma.userRole.count({ where: { role: "TRAVELER" } }),
      this.prisma.booking.count(),
      this.prisma.hotel.count(),
      this.prisma.vehicle.count(),
      this.prisma.user.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.ledgerEntry.groupBy({
        by: ["type"],
        where: { createdAt: { gte: monthStart, lt: monthEnd } },
        _sum: { amountMinor: true },
      }),
    ]);

    const findSum = (type: string): number =>
      revenueByType.find((r) => r.type === type)?._sum.amountMinor ?? 0;

    return {
      totalVendors,
      totalTravelers,
      totalBookings,
      totalHotels,
      totalVehicles,
      activeSuspensions,
      monthlyRevenue: {
        grossMinor: findSum("GROSS_PAYMENT"),
        platformFeeMinor: findSum("PLATFORM_FEE"),
        vendorOwedMinor: findSum("VENDOR_OWED"),
      },
    };
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-overview.service`
Expected: PASS.

- [ ] **Step 6: Write the failing overview-controller test**

`apps/api/src/admin/admin-overview.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { AdminOverviewController } from "./admin-overview.controller";
import { AdminOverviewService } from "./admin-overview.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminOverviewController", () => {
  let controller: AdminOverviewController;
  let service: { getOverview: jest.Mock };

  beforeEach(async () => {
    service = { getOverview: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminOverviewController],
      providers: [{ provide: AdminOverviewService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminOverviewController);
  });

  it("delegates to AdminOverviewService.getOverview", async () => {
    service.getOverview.mockResolvedValue({ totalVendors: 1 });

    const result = await controller.getOverview();

    expect(service.getOverview).toHaveBeenCalled();
    expect(result).toEqual({ totalVendors: 1 });
  });
});
```

- [ ] **Step 7: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-overview.controller`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the controller**

`apps/api/src/admin/admin-overview.controller.ts`:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  AdminOverviewService,
  PlatformOverview,
} from "./admin-overview.service";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/overview")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @ApiOperation({
    summary:
      "Platform-wide headline counts and this month's revenue (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Platform overview." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async getOverview(): Promise<PlatformOverview> {
    return this.overviewService.getOverview();
  }
}
```

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-overview.controller`
Expected: PASS.

- [ ] **Step 10: Write the failing vendor-list-controller test**

`apps/api/src/admin/vendor-list.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { VendorListController } from "./vendor-list.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorListController", () => {
  let controller: VendorListController;
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorListController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorListController);
  });

  it("filters by ordinary verifiedStatus values", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: "v1", verifiedStatus: "PENDING", passwordHash: "x" },
    ]);

    const result = await controller.list({ status: "PENDING" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { verifiedStatus: "PENDING" },
    });
    expect(result[0]).not.toHaveProperty("passwordHash");
  });

  it("filters by the synthetic SUSPENDED status", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "SUSPENDED" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { suspendedAt: { not: null } },
    });
  });

  it("applies a case-insensitive search across email/fullName/phone", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ search: "acme" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { contains: "acme", mode: "insensitive" } },
          { fullName: { contains: "acme", mode: "insensitive" } },
          { phone: { contains: "acme", mode: "insensitive" } },
        ],
      },
    });
  });

  it("combines status and search", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "VERIFIED", search: "acme" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        verifiedStatus: "VERIFIED",
        OR: [
          { email: { contains: "acme", mode: "insensitive" } },
          { fullName: { contains: "acme", mode: "insensitive" } },
          { phone: { contains: "acme", mode: "insensitive" } },
        ],
      },
    });
  });

  it("returns everyone when no filter is given", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: {} });
  });
});
```

- [ ] **Step 11: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-list.controller`
Expected: FAIL — module not found.

- [ ] **Step 12: Implement the controller**

`apps/api/src/admin/vendor-list.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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
import { VendorListQueryDto } from "./dto/vendor-list-query.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorListController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary:
      "List vendors, filterable by status (PENDING/VERIFIED/REJECTED/SUSPENDED) and search (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Matching vendors." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: VendorListQueryDto): Promise<PublicUser[]> {
    const where: Record<string, unknown> = {};

    if (query.status === "SUSPENDED") {
      where.suspendedAt = { not: null };
    } else if (query.status) {
      where.verifiedStatus = query.status;
    }

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { fullName: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const vendors = await this.prisma.user.findMany({ where });
    return vendors.map(toPublicUser);
  }
}
```

- [ ] **Step 13: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-list.controller`
Expected: PASS.

- [ ] **Step 14: Remove the now-superseded routes from `VendorVerificationController`**

Read `apps/api/src/admin/vendor-verification.controller.ts` and its spec. Remove the `listPending`/`GET pending` method entirely (superseded by `VendorListController`'s `GET /admin/vendors?status=PENDING`) and the `getHistory`/`GET :id/history` method entirely (superseded by `AdminAuditLogController`'s `GET /admin/audit-log?vendorId=`). The controller keeps only `approve`/`reject`. Update `vendor-verification.controller.spec.ts` to remove the corresponding two describe blocks.

Replace the full contents of `apps/api/src/admin/vendor-verification.controller.ts`:

```ts
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
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
}
```

Note: `admin/vendors` as a base path is now shared across three controllers in this module (`VendorVerificationController`: `:id/approve`, `:id/reject`; `VendorSuspensionController`: `:id/suspend`, `:id/unsuspend`; `CommissionController`: `:id/commission`; `VendorListController`: the bare `GET /admin/vendors`) — this is consistent with how NestJS resolves multiple controllers sharing a path prefix as long as no two controllers register the identical method+path combination, which none of these do.

- [ ] **Step 15: Run the full unit suite to confirm the removed routes' old tests are gone and nothing else references them**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS — every suite green. If any other file still imports/calls the removed `listPending`/`getHistory` methods (grep for `listPending`/`getHistory` across `apps/api/src` and `apps/api/test` first), fix those call sites before this step passes.

- [ ] **Step 16: Wire everything into `AdminModule`**

Replace the full contents of `apps/api/src/admin/admin.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { VendorVerificationService } from "./vendor-verification.service";
import { VendorVerificationController } from "./vendor-verification.controller";
import { CommissionController } from "./commission.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { VendorSuspensionController } from "./vendor-suspension.controller";
import { AdminAuditLogService } from "./admin-audit-log.service";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminOverviewService } from "./admin-overview.service";
import { AdminOverviewController } from "./admin-overview.controller";
import { VendorListController } from "./vendor-list.controller";

@Module({
  controllers: [
    VendorVerificationController,
    CommissionController,
    VendorSuspensionController,
    AdminAuditLogController,
    AdminOverviewController,
    VendorListController,
  ],
  providers: [
    VendorVerificationService,
    VendorSuspensionService,
    AdminAuditLogService,
    AdminOverviewService,
  ],
  exports: [VendorVerificationService],
})
export class AdminModule {}
```

- [ ] **Step 17: Full unit + typecheck run**

Run:

```bash
pnpm --filter @staybangla/api exec tsc --noEmit
pnpm --filter @staybangla/api run test:unit
```

Expected: both PASS.

- [ ] **Step 18: Commit**

```bash
git add -A
git commit -m "feat(api): add AdminOverviewController/VendorListController, retire superseded vendor-verification routes"
```

---

## Task 8: E2e coverage

**Files:**

- Create: `apps/api/test/admin-panel.e2e-spec.ts`

**Interfaces:**

- Consumes: `createAdmin(app, email): Promise<{adminId, accessToken}>`, `createVerifiedVendor(app, email): Promise<{vendorId, accessToken}>`, `createHotelWithRoom(app, vendorToken, overrides?): Promise<{hotelId, roomId}>`, `createTraveler(app, email): Promise<{travelerId, accessToken}>` (all existing, `apps/api/test/helpers/test-fixtures.ts`), `cleanDatabase()` (existing, `apps/api/test/helpers/test-db.ts` — must also clear `adminAuditLog` before `user`, matching the same FK-ordering discipline already established for `vendorLedgerEntry` in that helper).

- [ ] **Step 1: Update `cleanDatabase()` for the new table, and remove the now-dropped one**

Read `apps/api/test/helpers/test-db.ts` in full first — its current `cleanDatabase()` (as of this plan's baseline, before Task 1 runs) deletes in this order: `hotelPhoto`, `roomPhoto`, `vendorVerificationLog`, `ledgerEntry`, `vendorLedgerEntry`, `booking`, `room`, `vehicle`, `hotel`, `refreshToken`, `userRole`, `user`, then `clearThrottlerKeys()` (Redis). Task 1 drops the `VendorVerificationLog` model entirely (replacing it with `AdminAuditLog`), so by the time this task runs, `testPrisma.vendorVerificationLog` no longer exists on the generated Prisma Client — that line must be **replaced**, not just supplemented:

```ts
await testPrisma.adminAuditLog.deleteMany();
```

Replace the existing `await testPrisma.vendorVerificationLog.deleteMany();` line with this one, in the same position (before `ledgerEntry.deleteMany()`) — `AdminAuditLog` has an FK to `User` on `actorId` (as shipped, `targetId` is a polymorphic identifier with no FK, see Task 1's Step 1 note) with the default `ON DELETE` behavior (Prisma's default is `Restrict` for required relations), so it must be deleted before `user.deleteMany()`, same constraint the old line satisfied.

- [ ] **Step 2: Write the e2e spec**

`apps/api/test/admin-panel.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Panel (e2e)", () => {
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

  it("POST /admin/vendors/:id/suspend requires ADMIN/SUPER_ADMIN", async () => {
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ reason: "test" });
    expect(res.status).toBe(403);
  });

  it("suspending a vendor blocks their login with 403, not 401", async () => {
    const { adminId: _adminId, accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin1@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor2@example.com",
    );

    const suspend = await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "policy violation" });
    expect(suspend.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "admin-e2e-vendor2@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(403);
  });

  it("a suspended vendor's room disappears from GET /rooms/available", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin2@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-10-01&checkOut=2026-10-03",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeUndefined();
  });

  it("a traveler cannot book a suspended vendor's room", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin3@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "admin-e2e-traveler1@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const booking = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-10-01",
        checkOut: "2026-10-03",
      });
    expect(booking.status).toBe(403);
  });

  it("unsuspending a vendor restores login and search visibility", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin4@example.com",
    );
    const { vendorId, accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor5@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "temporary review" });
    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/unsuspend`)
      .set("Authorization", `Bearer ${adminToken}`);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "admin-e2e-vendor5@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(201);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-10-05&checkOut=2026-10-07",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeDefined();
  });

  it("GET /admin/audit-log?vendorId= returns that vendor's suspend/unsuspend history", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin5@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor6@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "reason A" });
    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${vendorId}/unsuspend`)
      .set("Authorization", `Bearer ${adminToken}`);

    const auditLog = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?vendorId=${vendorId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditLog.status).toBe(200);
    expect(auditLog.body.items).toHaveLength(2);
    expect(auditLog.body.items[0].action).toBe("VENDOR_UNSUSPENDED");
    expect(auditLog.body.items[1].action).toBe("VENDOR_SUSPENDED");
  });

  it("PATCH /admin/vendors/:id/commission writes a COMMISSION_RATE_CHANGED audit row with old/new rates", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin6@example.com",
    );
    const { vendorId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor7@example.com",
    );

    await request(app.getHttpServer())
      .patch(`/v1/admin/vendors/${vendorId}/commission`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });

    const auditLog = await request(app.getHttpServer())
      .get(`/v1/admin/audit-log?vendorId=${vendorId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(auditLog.body.items[0]).toMatchObject({
      action: "COMMISSION_RATE_CHANGED",
      metadata: { oldRatePercent: 10, newRatePercent: 20 },
    });
  });

  it("PATCH /admin/vendors/:id/commission returns 404 for a nonexistent vendor", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin7@example.com",
    );

    const res = await request(app.getHttpServer())
      .patch(
        "/v1/admin/vendors/00000000-0000-0000-0000-000000000000/commission",
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ commissionRatePercent: 20 });
    expect(res.status).toBe(404);
  });

  it("GET /admin/vendors?status=SUSPENDED returns only suspended vendors", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin8@example.com",
    );
    const { vendorId: suspendedId } = await createVerifiedVendor(
      app,
      "admin-e2e-vendor8@example.com",
    );
    await createVerifiedVendor(app, "admin-e2e-vendor9@example.com");

    await request(app.getHttpServer())
      .post(`/v1/admin/vendors/${suspendedId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test" });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/vendors?status=SUSPENDED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(suspendedId);
  });

  it("GET /admin/overview returns headline counts", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin-e2e-admin9@example.com",
    );
    await createVerifiedVendor(app, "admin-e2e-vendor10@example.com");

    const res = await request(app.getHttpServer())
      .get("/v1/admin/overview")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalVendors).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty("monthlyRevenue");
  });
});
```

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- admin-panel`
Expected: PASS — all 10 e2e cases green (Docker services up).

Note on the login test's password: `createVerifiedVendor` (existing helper) registers via `registerAndLogin`, which uses a fixed test password already established by that helper — check `apps/api/test/helpers/test-users.ts`'s `registerAndLogin` for the exact literal string it registers with, and use that same literal in this spec's `POST /v1/auth/login` calls (the plan's draft above uses `"supersecret1"` as a placeholder matching the convention seen in other e2e specs in this codebase — confirm against the actual helper before running, and adjust if it differs).

- [ ] **Step 4: Full monorepo verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(api): add e2e coverage for admin panel (suspension, audit log, overview, vendor list)"
```

---

## Task 9: `AdminBookingService`/`Controller` — platform-wide booking list + force-cancel

**Files:**

- Create: `apps/api/src/admin/admin-booking.service.ts`
- Create: `apps/api/src/admin/admin-booking.service.spec.ts`
- Create: `apps/api/src/admin/admin-booking.controller.ts`
- Create: `apps/api/src/admin/admin-booking.controller.spec.ts`
- Create: `apps/api/src/admin/dto/admin-booking-list-query.dto.ts`
- Create: `apps/api/src/admin/dto/force-cancel-booking.dto.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Modify: `apps/api/prisma/schema.prisma` (append `BOOKING_FORCE_CANCELLED` to `AdminActionType` — this must land in Task 1's migration if that task hasn't been executed yet; if Task 1 already ran and its migration was already applied, generate a small additive migration here instead, following the exact same `prisma migrate diff --script` non-interactive approach as Task 1 Step 2)
- Create: `apps/api/test/admin-booking.e2e-spec.ts`

**Interfaces:**

- Consumes: `AdminAuditLog`/`AdminActionType` (Task 1, now including `BOOKING_FORCE_CANCELLED`), the `Prisma.sql`/`Prisma.empty` conditional-fragment idiom (existing, `vendor-dashboard.service.ts:296-320`'s `getBookings` method — copy its exact shape), `Booking.resourceOwnerId` (existing field, direct FK to the vendor `User`, no join needed to identify the owner — only `district` needs the `rooms`/`hotels`/`vehicles` join, since `city` lives on `Hotel`/`Vehicle`), `createAdmin`/`createVerifiedVendor`/`createTraveler`/`createHotelWithRoom` (existing e2e fixtures, `apps/api/test/helpers/test-fixtures.ts` — exact signatures: `createTraveler(app, email): Promise<{ travelerId: string; accessToken: string }>` where `travelerId` is that helper's own return-key for a `User.id`, unrelated to any `Booking` column).
- Produces: `AdminBookingService.list(filter: AdminBookingFilter): Promise<{ items: AdminBookingRow[]; page: number; pageSize: number; total: number }>`, `AdminBookingService.forceCancel(adminId: string, bookingId: string, reason: string): Promise<void>` — no later task depends on these, they are the final booking-control surface.

- [ ] **Step 1: Add `BOOKING_FORCE_CANCELLED` to the schema**

In `apps/api/prisma/schema.prisma`, add the new value to the existing `AdminActionType` enum (from Task 1):

```prisma
enum AdminActionType {
  VENDOR_APPROVED
  VENDOR_REJECTED
  VENDOR_RESUBMITTED
  VENDOR_SUSPENDED
  VENDOR_UNSUSPENDED
  COMMISSION_RATE_CHANGED
  BOOKING_FORCE_CANCELLED
}
```

Generate and apply the migration (non-interactive, same approach as Task 1 Step 2):

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p apps/api/prisma/migrations/${TS}_add_booking_force_cancelled
pnpm --filter @staybangla/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > apps/api/prisma/migrations/${TS}_add_booking_force_cancelled/migration.sql
pnpm --filter @staybangla/api exec prisma migrate deploy
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
pnpm --filter @staybangla/api exec prisma generate
```

- [ ] **Step 2: DTOs**

`apps/api/src/admin/dto/admin-booking-list-query.dto.ts`:

```ts
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { District } from "@prisma/client";

const BOOKING_STATUSES = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "AUTO_CANCELLED",
  "CANCELLED",
  "REFUNDED",
  "BLOCKED",
] as const;

const DISTRICTS = Object.values(District);

export class AdminBookingListQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: (typeof BOOKING_STATUSES)[number];

  @IsOptional()
  @IsIn(DISTRICTS)
  district?: District;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
```

Note: `district` is validated against the real `District` enum (`apps/api/prisma/schema.prisma` — 16 values, e.g. `DHAKA`, `SYLHET`, `COXS_BAZAR`), matching the type already used by `Hotel.city`/`Vehicle.city`, not a free-form string.

`apps/api/src/admin/dto/force-cancel-booking.dto.ts`:

```ts
import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ForceCancelBookingDto {
  @ApiProperty({
    example: "Duplicate booking created by a payment-gateway retry.",
    description:
      "Shown in the audit log; never surfaced to the traveler automatically.",
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

- [ ] **Step 3: Write the failing service tests**

`apps/api/src/admin/admin-booking.service.spec.ts`:

```ts
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AdminBookingService } from "./admin-booking.service";

describe("AdminBookingService", () => {
  let service: AdminBookingService;
  let prisma: {
    $queryRaw: jest.Mock;
    booking: { updateMany: jest.Mock };
    adminAuditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      booking: { updateMany: jest.fn() },
      adminAuditLog: { create: jest.fn() },
    };
    service = new AdminBookingService(prisma as unknown as PrismaService);
  });

  describe("list", () => {
    it("runs an unfiltered platform-wide query when no filters are given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      const result = await service.list({});

      expect(result).toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("includes the status filter fragment when status is given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      await service.list({ status: "CONFIRMED" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain("CONFIRMED");
    });

    it("includes the district filter fragment when district is given", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "0" }])
        .mockResolvedValueOnce([]);

      await service.list({ district: "DHAKA" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain("DHAKA");
    });

    it("applies page/pageSize as offset/limit, defaulting to page 1 / pageSize 50", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total: "120" }])
        .mockResolvedValueOnce([]);

      const result = await service.list({ page: 3, pageSize: 20 });

      const [sqlObject] = prisma.$queryRaw.mock.calls[1];
      expect(sqlObject.values).toContain(20);
      expect(sqlObject.values).toContain(40);
      expect(result).toEqual({ items: [], page: 3, pageSize: 20, total: 120 });
    });
  });

  describe("forceCancel", () => {
    it("cancels an active booking and writes a BOOKING_FORCE_CANCELLED audit row, never touching paymentStatus", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });

      await service.forceCancel("admin1", "booking1", "duplicate booking");

      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: "booking1",
          status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
        },
        data: { status: "CANCELLED" },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "booking1",
          actorId: "admin1",
          action: "BOOKING_FORCE_CANCELLED",
          reason: "duplicate booking",
        },
      });
    });

    it("throws ConflictException when the booking is not in a cancellable state (already terminal, or a double force-cancel)", async () => {
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.forceCancel("admin1", "booking1", "duplicate booking"),
      ).rejects.toThrow(ConflictException);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 4: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-booking.service`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the service**

`apps/api/src/admin/admin-booking.service.ts`:

```ts
import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface AdminBookingFilter {
  status?: string;
  district?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminBookingRow {
  id: string;
  status: string;
  bookableType: string;
  bookableId: string;
  district: string | null;
  userId: string | null;
  checkIn: string;
  checkOut: string;
  totalAmountMinor: number;
  currency: string;
  paymentStatus: string;
}

export interface AdminBookingListResult {
  items: AdminBookingRow[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminBookingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: AdminBookingFilter): Promise<AdminBookingListResult> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;

    const statusFilter = filter.status
      ? Prisma.sql`AND b.status = ${filter.status}`
      : Prisma.empty;
    const districtFilter = filter.district
      ? Prisma.sql`AND COALESCE(h.city, v.city) = ${filter.district}`
      : Prisma.empty;
    const fromFilter = filter.from
      ? Prisma.sql`AND lower(b.date_range) >= ${filter.from}::date`
      : Prisma.empty;
    const toFilter = filter.to
      ? Prisma.sql`AND upper(b.date_range) <= ${filter.to}::date`
      : Prisma.empty;

    const whereClause = Prisma.sql`
      FROM bookings b
      LEFT JOIN rooms r ON r.id = b.room_id
      LEFT JOIN hotels h ON h.id = r.hotel_id
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE 1 = 1 ${statusFilter} ${districtFilter} ${fromFilter} ${toFilter}
    `;

    const [countRows, items] = await Promise.all([
      this.prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT count(*)::text AS total ${whereClause}`,
      ),
      this.prisma.$queryRaw<AdminBookingRow[]>(Prisma.sql`
        SELECT
          b.id, b.status,
          b.bookable_type AS "bookableType",
          COALESCE(b.room_id, b.vehicle_id) AS "bookableId",
          COALESCE(h.city, v.city) AS district,
          b.user_id AS "userId",
          lower(b.date_range)::text AS "checkIn",
          upper(b.date_range)::text AS "checkOut",
          b.total_amount_minor AS "totalAmountMinor",
          b.currency,
          b.payment_status AS "paymentStatus"
        ${whereClause}
        ORDER BY b.created_at DESC
        OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
      `),
    ]);

    return {
      items,
      page,
      pageSize,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async forceCancel(
    adminId: string,
    bookingId: string,
    reason: string,
  ): Promise<void> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Booking is not in a state that can be force-cancelled",
      );
    }
    await this.prisma.adminAuditLog.create({
      data: {
        targetId: bookingId,
        actorId: adminId,
        action: "BOOKING_FORCE_CANCELLED",
        reason,
      },
    });
  }
}
```

Note: this method never writes `paymentStatus` — matching the confirmed decision that force-cancel is a pure booking-status/ops action, never a money-movement action. The column names used above (`bookable_type`, `room_id`, `vehicle_id`, `user_id`, `date_range`, `total_amount_minor`, `payment_status`, `created_at`) are confirmed against `apps/api/prisma/schema.prisma`'s `Booking` model `@map(...)` values (`bookings.service.ts:130-134` shows the identical column set already used elsewhere in this codebase for the equivalent `RETURNING` clause) — the traveler who made a booking is `Booking.userId`/`user_id`, **not** `travelerId`/`traveler_id` (that name only exists as a test-fixture helper's return-object key in `apps/api/test/helpers/test-fixtures.ts`, never as a real column). `Booking.resourceOwnerId` already gives the vendor directly with no join, but `district` still requires the `rooms`/`hotels`/`vehicles` join shown above, since `city` lives on `Hotel`/`Vehicle`, not on `Booking` itself.

- [ ] **Step 6: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-booking.service`
Expected: PASS.

- [ ] **Step 7: Write the failing controller tests**

`apps/api/src/admin/admin-booking.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { AdminBookingController } from "./admin-booking.controller";
import { AdminBookingService } from "./admin-booking.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminBookingController", () => {
  let controller: AdminBookingController;
  let service: { list: jest.Mock; forceCancel: jest.Mock };

  beforeEach(async () => {
    service = { list: jest.fn(), forceCancel: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBookingController],
      providers: [{ provide: AdminBookingService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminBookingController);
  });

  it("list() delegates to AdminBookingService.list with the query params", async () => {
    service.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });

    await controller.list({ status: "CONFIRMED", district: "DHAKA" });

    expect(service.list).toHaveBeenCalledWith({
      status: "CONFIRMED",
      district: "DHAKA",
      from: undefined,
      to: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });

  it("forceCancel() delegates to AdminBookingService.forceCancel with the caller's id, booking id, and reason", async () => {
    await controller.forceCancel(
      { id: "admin1", roles: ["ADMIN"] },
      "booking1",
      { reason: "duplicate" },
    );

    expect(service.forceCancel).toHaveBeenCalledWith(
      "admin1",
      "booking1",
      "duplicate",
    );
  });
});
```

- [ ] **Step 8: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-booking.controller`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement the controller**

`apps/api/src/admin/admin-booking.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
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
import {
  AdminBookingService,
  AdminBookingListResult,
} from "./admin-booking.service";
import { AdminBookingListQueryDto } from "./dto/admin-booking-list-query.dto";
import { ForceCancelBookingDto } from "./dto/force-cancel-booking.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/bookings")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminBookingController {
  constructor(private readonly adminBookingService: AdminBookingService) {}

  @ApiOperation({
    summary:
      "Platform-wide booking list, filterable by status/district/date-range (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Paginated bookings." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(
    @Query() query: AdminBookingListQueryDto,
  ): Promise<AdminBookingListResult> {
    return this.adminBookingService.list({
      status: query.status,
      district: query.district,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @ApiOperation({
    summary:
      "Force-cancel a booking (ADMIN/SUPER_ADMIN only). Never touches paymentStatus or triggers a refund.",
  })
  @ApiResponse({ status: 201, description: "Booking is now CANCELLED." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Booking is not in a cancellable state.",
  })
  @Post(":id/force-cancel")
  async forceCancel(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: ForceCancelBookingDto,
  ): Promise<void> {
    await this.adminBookingService.forceCancel(admin.id, id, dto.reason);
  }
}
```

- [ ] **Step 10: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-booking.controller`
Expected: PASS.

- [ ] **Step 11: Wire into `AdminModule`**

In `apps/api/src/admin/admin.module.ts`, add `AdminBookingService` to `providers` and `AdminBookingController` to `controllers` (import both from their new files).

- [ ] **Step 12: Write the e2e spec**

`apps/api/test/admin-booking.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Booking Control (e2e)", () => {
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

  async function createConfirmedBooking(
    travelerToken: string,
    roomId: string,
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
      });
    return created.body.id;
  }

  it("GET /admin/bookings requires ADMIN/SUPER_ADMIN", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/admin/bookings")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/bookings?status= filters correctly and is platform-wide (not scoped to one vendor)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin1@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler1@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    const res = await request(app.getHttpServer())
      .get("/v1/admin/bookings?status=HELD")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.some((b: { id: string }) => b.id === bookingId)).toBe(
      true,
    );
  });

  it("POST /admin/bookings/:id/force-cancel cancels the booking without touching paymentStatus", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler2@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    const before = await request(app.getHttpServer())
      .get(`/v1/admin/bookings?status=HELD`)
      .set("Authorization", `Bearer ${adminToken}`);
    const paymentStatusBefore = before.body.items.find(
      (b: { id: string }) => b.id === bookingId,
    ).paymentStatus;

    const cancel = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "duplicate booking from a payment retry" });
    expect(cancel.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get(`/v1/admin/bookings?status=CANCELLED`)
      .set("Authorization", `Bearer ${adminToken}`);
    const cancelled = after.body.items.find(
      (b: { id: string }) => b.id === bookingId,
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.paymentStatus).toBe(paymentStatusBefore);
  });

  it("POST /admin/bookings/:id/force-cancel is a safe no-op guard on a double force-cancel (returns 409)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "booking-e2e-admin3@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "booking-e2e-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "booking-e2e-traveler3@example.com",
    );
    const bookingId = await createConfirmedBooking(travelerToken, roomId);

    await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "first cancel" });

    const second = await request(app.getHttpServer())
      .post(`/v1/admin/bookings/${bookingId}/force-cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "second cancel attempt" });
    expect(second.status).toBe(409);
  });
});
```

- [ ] **Step 13: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- admin-booking`
Expected: PASS (Docker services up).

- [ ] **Step 14: Full unit regression + commit**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add admin platform-wide booking list and force-cancel"
```

---

## Task 10: Traveler control — reuses `VendorSuspensionService` (with an added `action` parameter)

**Files:**

- Create: `apps/api/src/admin/traveler-suspension.controller.ts`
- Create: `apps/api/src/admin/traveler-suspension.controller.spec.ts`
- Create: `apps/api/src/admin/traveler-list.controller.ts`
- Create: `apps/api/src/admin/traveler-list.controller.spec.ts`
- Create: `apps/api/src/admin/dto/traveler-list-query.dto.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/bookings/bookings.service.spec.ts`
- Create: `apps/api/test/admin-traveler.e2e-spec.ts`

**Interfaces:**

- Consumes: `VendorSuspensionService.suspend`/`unsuspend` (Task 4 — as shipped, both gained an optional trailing `action: AdminActionType` parameter, defaulting to `VENDOR_SUSPENDED`/`VENDOR_UNSUSPENDED`, so `TravelerSuspensionController` passes `TRAVELER_SUSPENDED`/`TRAVELER_UNSUSPENDED` explicitly instead of the audit log mislabelling every traveler suspension as a vendor one — a ruling from the project owner during the pre-flight scan, not new suspend/unsuspend service logic), `toPublicUser`/`PublicUser` (existing), `createAdmin`/`createTraveler` (existing e2e fixtures).
- Produces: `TravelerListController.list(query): Promise<PublicUser[]>` — no later task depends on this.

- [ ] **Step 1: DTO**

`apps/api/src/admin/dto/traveler-list-query.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from "class-validator";

export class TravelerListQueryDto {
  @IsOptional()
  @IsIn(["SUSPENDED"])
  status?: "SUSPENDED";

  @IsOptional()
  @IsString()
  search?: string;
}
```

- [ ] **Step 2: Write the failing `TravelerSuspensionController` tests**

`apps/api/src/admin/traveler-suspension.controller.spec.ts` — this mirrors `vendor-suspension.controller.spec.ts` exactly, proving the same `VendorSuspensionService` is reused for a traveler id:

```ts
import { Test } from "@nestjs/testing";
import { TravelerSuspensionController } from "./traveler-suspension.controller";
import { VendorSuspensionService } from "./vendor-suspension.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("TravelerSuspensionController", () => {
  let controller: TravelerSuspensionController;
  let service: { suspend: jest.Mock; unsuspend: jest.Mock };

  beforeEach(async () => {
    service = { suspend: jest.fn(), unsuspend: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [TravelerSuspensionController],
      providers: [{ provide: VendorSuspensionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TravelerSuspensionController);
  });

  it("suspend() delegates to the shared VendorSuspensionService.suspend with the traveler's id", async () => {
    service.suspend.mockResolvedValue({
      id: "traveler1",
      passwordHash: "secret",
    });

    const result = await controller.suspend(
      { id: "admin1", roles: ["ADMIN"] },
      "traveler1",
      { reason: "abusive behavior toward vendors" },
    );

    expect(service.suspend).toHaveBeenCalledWith(
      "admin1",
      "traveler1",
      "abusive behavior toward vendors",
    );
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("unsuspend() delegates to the shared VendorSuspensionService.unsuspend", async () => {
    service.unsuspend.mockResolvedValue({
      id: "traveler1",
      passwordHash: "secret",
    });

    const result = await controller.unsuspend(
      { id: "admin1", roles: ["ADMIN"] },
      "traveler1",
    );

    expect(service.unsuspend).toHaveBeenCalledWith("admin1", "traveler1");
    expect(result).not.toHaveProperty("passwordHash");
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- traveler-suspension.controller`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `TravelerSuspensionController`**

`apps/api/src/admin/traveler-suspension.controller.ts` — identical shape to `vendor-suspension.controller.ts`, only the route prefix and Swagger copy differ, and it injects the exact same `VendorSuspensionService`:

```ts
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
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
import { VendorSuspensionService } from "./vendor-suspension.service";
import { SuspendVendorDto } from "./dto/suspend-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/travelers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class TravelerSuspensionController {
  constructor(
    private readonly vendorSuspensionService: VendorSuspensionService,
  ) {}

  @ApiOperation({
    summary: "Suspend a traveler (ADMIN/SUPER_ADMIN only)",
    description:
      "Blocks the traveler's login and new booking creation. Existing CONFIRMED/PAID bookings are unaffected. Reuses the same suspension mechanism as vendor suspension.",
  })
  @ApiResponse({ status: 201, description: "Traveler is now suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({ status: 409, description: "Traveler is already suspended." })
  @Post(":id/suspend")
  async suspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: SuspendVendorDto,
  ): Promise<PublicUser> {
    const traveler = await this.vendorSuspensionService.suspend(
      admin.id,
      id,
      dto.reason,
    );
    return toPublicUser(traveler);
  }

  @ApiOperation({ summary: "Unsuspend a traveler (ADMIN/SUPER_ADMIN only)" })
  @ApiResponse({ status: 201, description: "Traveler is no longer suspended." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @ApiResponse({
    status: 409,
    description: "Traveler is not currently suspended.",
  })
  @Post(":id/unsuspend")
  async unsuspend(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const traveler = await this.vendorSuspensionService.unsuspend(admin.id, id);
    return toPublicUser(traveler);
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- traveler-suspension.controller`
Expected: PASS.

- [ ] **Step 6: Write the failing `TravelerListController` tests**

`apps/api/src/admin/traveler-list.controller.spec.ts` — mirrors `vendor-list.controller.spec.ts`'s structure, scoped to `Role.TRAVELER` via the `UserRole` join instead of a `verifiedStatus` filter:

```ts
import { Test } from "@nestjs/testing";
import { TravelerListController } from "./traveler-list.controller";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("TravelerListController", () => {
  let controller: TravelerListController;
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [TravelerListController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TravelerListController);
  });

  it("scopes to TRAVELER role and returns everyone when no filter is given", async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: "t1", roles: [{ role: "TRAVELER" }], passwordHash: "x" },
    ]);

    const result = await controller.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { roles: { some: { role: "TRAVELER" } } },
    });
    expect(result[0]).not.toHaveProperty("passwordHash");
  });

  it("filters by the synthetic SUSPENDED status", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ status: "SUSPENDED" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        roles: { some: { role: "TRAVELER" } },
        suspendedAt: { not: null },
      },
    });
  });

  it("applies a case-insensitive search across email/fullName/phone", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await controller.list({ search: "karim" });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        roles: { some: { role: "TRAVELER" } },
        OR: [
          { email: { contains: "karim", mode: "insensitive" } },
          { fullName: { contains: "karim", mode: "insensitive" } },
          { phone: { contains: "karim", mode: "insensitive" } },
        ],
      },
    });
  });
});
```

- [ ] **Step 7: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- traveler-list.controller`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `TravelerListController`**

`apps/api/src/admin/traveler-list.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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
import { TravelerListQueryDto } from "./dto/traveler-list-query.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/travelers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class TravelerListController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary:
      "List travelers, filterable by status=SUSPENDED and search (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Matching travelers." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get()
  async list(@Query() query: TravelerListQueryDto): Promise<PublicUser[]> {
    const where: Record<string, unknown> = {
      roles: { some: { role: "TRAVELER" } },
    };

    if (query.status === "SUSPENDED") {
      where.suspendedAt = { not: null };
    }

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: "insensitive" } },
        { fullName: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const travelers = await this.prisma.user.findMany({ where });
    return travelers.map(toPublicUser);
  }
}
```

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- traveler-list.controller`
Expected: PASS.

- [ ] **Step 10: Write the failing test — `BookingsService.createBooking` traveler-suspension check**

Read `apps/api/src/bookings/bookings.service.spec.ts` first for its exact mock shape (its `prisma` test double already provides `prisma.room.findUnique`/`prisma.vehicle.findUnique` mocks for the owner-verification tests — this task adds a new `prisma.user.findUnique` mock for the calling traveler, since `createBooking` does not currently look up the caller's own row at all). Append:

```ts
it("rejects a booking attempt when the traveler (not just the resource owner) is suspended", async () => {
  prisma.user.findUnique.mockResolvedValue({
    id: "traveler1",
    suspendedAt: new Date(),
  });
  prisma.room.findUnique.mockResolvedValue({
    id: "room1",
    isActive: true,
    capacity: 2,
    pricePerNightMinor: 5000,
    currency: "BDT",
    hotel: {
      ownerId: "vendor1",
      owner: { verifiedStatus: "VERIFIED", suspendedAt: null },
    },
  });

  await expect(
    service.createBooking("traveler1", {
      bookableType: "ROOM",
      bookableId: "room1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
    }),
  ).rejects.toThrow(/suspended/i);
});
```

- [ ] **Step 11: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: FAIL — `createBooking` does not yet check the traveler's own `suspendedAt`.

- [ ] **Step 12: Implement — `BookingsService.createBooking` traveler-suspension check**

In `apps/api/src/bookings/bookings.service.ts`, `createBooking`'s first parameter is named `userId` (`bookings.service.ts:69` — `async createBooking(userId: string, input: CreateBookingInput)`), not `travelerId`. Add a check for the calling user near the top of the method body, right after `this.validateDates(...)` and before the room/vehicle owner lookups (`bookings.service.ts:72-73`):

```ts
const traveler = await this.prisma.user.findUnique({ where: { id: userId } });
if (traveler?.suspendedAt) {
  throw new ForbiddenException("Your account is suspended");
}
```

This is a new lookup — `createBooking` does not currently load the calling user's own row anywhere (it only loads the room/vehicle owner's row, via `include: { hotel: { include: { owner: true } } }` / `include: { owner: true }` at `bookings.service.ts:81`/`:97`), so this is not a duplicate query.

- [ ] **Step 13: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: PASS.

- [ ] **Step 14: Wire into `AdminModule`**

In `apps/api/src/admin/admin.module.ts`, add `TravelerSuspensionController` and `TravelerListController` to `controllers` (both import `VendorSuspensionService`/`PrismaService` respectively — no new provider needed, since `TravelerSuspensionController` reuses the already-registered `VendorSuspensionService`).

- [ ] **Step 15: Write the e2e spec**

`apps/api/test/admin-traveler.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createTraveler,
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Admin Traveler Control (e2e)", () => {
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

  it("suspending a traveler blocks their login with 403", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin1@example.com",
    );
    const { travelerId } = await createTraveler(
      app,
      "traveler-e2e-traveler1@example.com",
    );

    const suspend = await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "abusive messages to vendors" });
    expect(suspend.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({
        identifier: "traveler-e2e-traveler1@example.com",
        password: "supersecret1",
      });
    expect(login.status).toBe(403);
  });

  it("a suspended traveler cannot create a new booking", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "traveler-e2e-vendor1@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { travelerId, accessToken: travelerToken } = await createTraveler(
      app,
      "traveler-e2e-traveler2@example.com",
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${travelerId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "fraud" });

    const booking = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
      });
    expect(booking.status).toBe(403);
  });

  it("GET /admin/travelers?status=SUSPENDED returns only suspended travelers", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "traveler-e2e-admin3@example.com",
    );
    const { travelerId: suspendedId } = await createTraveler(
      app,
      "traveler-e2e-traveler3@example.com",
    );
    await createTraveler(app, "traveler-e2e-traveler4@example.com");

    await request(app.getHttpServer())
      .post(`/v1/admin/travelers/${suspendedId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "test" });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/travelers?status=SUSPENDED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(suspendedId);
  });
});
```

- [ ] **Step 16: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- admin-traveler`
Expected: PASS (Docker services up).

- [ ] **Step 17: Full unit regression + commit**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add traveler suspend/unsuspend (reusing VendorSuspensionService) and traveler list"
```

---

## Task 11: `AdminAnalyticsService`/`Controller` — operational platform analytics

**Files:**

- Create: `apps/api/src/admin/admin-analytics.service.ts`
- Create: `apps/api/src/admin/admin-analytics.service.spec.ts`
- Create: `apps/api/src/admin/admin-analytics.controller.ts`
- Create: `apps/api/src/admin/admin-analytics.controller.spec.ts`
- Create: `apps/api/src/admin/dto/analytics-query.dto.ts`
- Modify: `apps/api/src/common/date/dhaka-time.ts`
- Modify: `apps/api/src/common/date/dhaka-time.spec.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Create: `apps/api/test/admin-analytics.e2e-spec.ts`

**Interfaces:**

- Consumes: `startOfDhakaDay`/`endOfDhakaDay`/`startOfDhakaMonth`/`endOfDhakaMonth` (existing, `apps/api/src/common/date/dhaka-time.ts`), the `Prisma.sql`/`Prisma.empty` idiom (existing, `vendor-dashboard.service.ts`), `prisma.ledgerEntry.groupBy`/`prisma.booking.groupBy` (precedent already established in this same plan's Task 7 `AdminOverviewService`).
- Produces: `startOfDhakaWeek(date: Date): Date`, `endOfDhakaWeek(date: Date): Date` (new, in `dhaka-time.ts`) — no other task in this plan depends on these besides this one. `AdminAnalyticsService.revenueTrend`, `.bookingStatusBreakdown`, `.topVendors`, `.districtDistribution` — this is the final task, nothing downstream depends on their exact shapes.

**Explicitly NOT built here** (reserved for `add-earnings-analytics-dashboard`, ROADMAP 2.3, and `add-fraud-detection-analytics`, ROADMAP 3.5, per the confirmed scope decision): per-vendor payout/settlement views, automated payout calculation, any chart-rendering UI, fraud-pattern detection.

- [ ] **Step 1: Write the failing tests for `startOfDhakaWeek`/`endOfDhakaWeek`**

`apps/api/src/common/date/dhaka-time.ts` currently exports exactly four functions — `startOfDhakaDay`, `endOfDhakaDay`, `startOfDhakaMonth`, `endOfDhakaMonth` (lines 30, 35, 45, 50) — built on two internal (non-exported) helpers: `toDhakaParts(date: Date): { year, month, day }` (lines 3-19, uses `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year/month/day: "2-digit" })` + `formatToParts`) and `dhakaMidnightUtc(year, month, day): Date` (lines 21-28, computes `Date.UTC(year, month-1, day) - DHAKA_OFFSET_MINUTES*60*1000` against the fixed `DHAKA_OFFSET_MINUTES = 6 * 60` constant at line 1). Read the file in full before writing the new functions, so `startOfDhakaWeek`/`endOfDhakaWeek` reuse these same two internal helpers rather than introducing a second, divergent way of computing Dhaka calendar boundaries. Append to `dhaka-time.spec.ts`:

```ts
describe("startOfDhakaWeek / endOfDhakaWeek", () => {
  it("returns the Monday 00:00 Dhaka-time start of the week containing the given instant", () => {
    // 2026-07-30 is a Thursday in Asia/Dhaka
    const thursday = new Date("2026-07-30T10:00:00Z");
    const start = startOfDhakaWeek(thursday);
    // Monday 2026-07-27 00:00 Dhaka (UTC+6) = 2026-07-26T18:00:00Z
    expect(start.toISOString()).toBe("2026-07-26T18:00:00.000Z");
  });

  it("returns the exclusive end (next Monday 00:00 Dhaka-time)", () => {
    const thursday = new Date("2026-07-30T10:00:00Z");
    const end = endOfDhakaWeek(thursday);
    expect(end.toISOString()).toBe("2026-08-02T18:00:00.000Z");
  });

  it("treats a Monday itself as the start of its own week", () => {
    const monday = new Date("2026-07-27T05:00:00Z");
    const start = startOfDhakaWeek(monday);
    expect(start.toISOString()).toBe("2026-07-26T18:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- dhaka-time`
Expected: FAIL — `startOfDhakaWeek`/`endOfDhakaWeek` not exported.

- [ ] **Step 3: Implement `startOfDhakaWeek`/`endOfDhakaWeek`**

Append to `apps/api/src/common/date/dhaka-time.ts`, reusing the file's own `toDhakaParts`/`dhakaMidnightUtc` internal helpers exactly as `startOfDhakaMonth`/`endOfDhakaMonth` already do (do not introduce a second `Intl.DateTimeFormat` call or a different offset calculation):

```ts
export function startOfDhakaWeek(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  // Date.UTC's day-of-week is timezone-agnostic for this purpose: (year, month, day)
  // as a UTC calendar date has the same weekday as that same calendar date in any
  // timezone, so getUTCDay() here safely tells us the Dhaka weekday (0=Sun..6=Sat).
  const dhakaWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = dhakaWeekday === 0 ? 6 : dhakaWeekday - 1;
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday));
  return dhakaMidnightUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

export function endOfDhakaWeek(date: Date): Date {
  const start = startOfDhakaWeek(date);
  const { year, month, day } = toDhakaParts(start);
  const nextMonday = new Date(Date.UTC(year, month - 1, day + 7));
  return dhakaMidnightUtc(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
  );
}
```

Both `toDhakaParts` and `dhakaMidnightUtc` are already defined (not exported) earlier in this same file — this is the identical two-step "compute Dhaka-local date components, do calendar arithmetic via `Date.UTC`, then re-normalize through `dhakaMidnightUtc`" shape that `endOfDhakaDay`/`endOfDhakaMonth` already use for their own month/year-rollover handling (lines 35-43, 50-58).

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- dhaka-time`
Expected: PASS.

- [ ] **Step 5: DTO**

`apps/api/src/admin/dto/analytics-query.dto.ts`:

```ts
import { IsIn, IsInt, IsISO8601, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";

export class RevenueTrendQueryDto {
  @IsOptional()
  @IsIn(["daily", "weekly", "monthly"])
  period?: "daily" | "weekly" | "monthly";

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TopVendorsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsIn(["revenue", "bookings"])
  metric?: "revenue" | "bookings";
}
```

- [ ] **Step 6: Write the failing service tests**

`apps/api/src/admin/admin-analytics.service.spec.ts`:

```ts
import { PrismaService } from "../prisma/prisma.service";
import { AdminAnalyticsService } from "./admin-analytics.service";

describe("AdminAnalyticsService", () => {
  let service: AdminAnalyticsService;
  let prisma: {
    ledgerEntry: { findMany: jest.Mock };
    booking: { groupBy: jest.Mock };
    $queryRaw: jest.Mock;
    hotel: { groupBy: jest.Mock };
    vehicle: { groupBy: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      ledgerEntry: { findMany: jest.fn() },
      booking: { groupBy: jest.fn() },
      $queryRaw: jest.fn(),
      hotel: { groupBy: jest.fn() },
      vehicle: { groupBy: jest.fn() },
    };
    service = new AdminAnalyticsService(prisma as unknown as PrismaService);
  });

  describe("bookingStatusBreakdown", () => {
    it("zero-fills every BookingStatus value not returned by groupBy", async () => {
      prisma.booking.groupBy.mockResolvedValue([
        { status: "CONFIRMED", _count: 5 },
        { status: "CANCELLED", _count: 2 },
      ]);

      const result = await service.bookingStatusBreakdown();

      expect(result).toEqual({
        HELD: 0,
        CONFIRMED: 5,
        CHECKED_IN: 0,
        COMPLETED: 0,
        AUTO_CANCELLED: 0,
        CANCELLED: 2,
        REFUNDED: 0,
        BLOCKED: 0,
      });
    });
  });

  describe("districtDistribution", () => {
    it("merges hotel and vehicle counts per district", async () => {
      prisma.hotel.groupBy.mockResolvedValue([{ city: "DHAKA", _count: 10 }]);
      prisma.vehicle.groupBy.mockResolvedValue([
        { city: "DHAKA", _count: 3 },
        { city: "SYLHET", _count: 4 },
      ]);

      const result = await service.districtDistribution();

      expect(result).toEqual(
        expect.arrayContaining([
          { district: "DHAKA", hotels: 10, vehicles: 3 },
          { district: "SYLHET", hotels: 0, vehicles: 4 },
        ]),
      );
    });
  });

  describe("topVendors", () => {
    it("defaults to the revenue metric with limit 10", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.topVendors({});

      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toContain(10);
    });

    it("applies a caller-provided limit", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.topVendors({ limit: 5, metric: "bookings" });

      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toContain(5);
    });
  });

  describe("revenueTrend", () => {
    it("buckets by month when period=monthly", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([]);

      const result = await service.revenueTrend({ period: "monthly" });

      expect(result).toEqual([]);
    });

    it("defaults to daily bucketing when no period is given, aggregating GROSS_PAYMENT/PLATFORM_FEE/VENDOR_OWED per bucket", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          type: "GROSS_PAYMENT",
          amountMinor: 10000,
          createdAt: new Date("2026-07-30T00:00:00Z"),
        },
        {
          type: "PLATFORM_FEE",
          amountMinor: 1000,
          createdAt: new Date("2026-07-30T01:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({});

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        grossMinor: 10000,
        platformFeeMinor: 1000,
        vendorOwedMinor: 0,
      });
      expect(result[0]).toHaveProperty("bucketStart");
    });

    it("groups two entries in the same Dhaka day into a single bucket", async () => {
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          type: "GROSS_PAYMENT",
          amountMinor: 5000,
          createdAt: new Date("2026-07-30T01:00:00Z"),
        },
        {
          type: "GROSS_PAYMENT",
          amountMinor: 3000,
          createdAt: new Date("2026-07-30T15:00:00Z"),
        },
      ]);

      const result = await service.revenueTrend({});

      expect(result).toHaveLength(1);
      expect(result[0].grossMinor).toBe(8000);
    });
  });
});
```

- [ ] **Step 7: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-analytics.service`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the service**

`apps/api/src/admin/admin-analytics.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  startOfDhakaDay,
  startOfDhakaWeek,
  startOfDhakaMonth,
} from "../common/date/dhaka-time";

const ALL_BOOKING_STATUSES = [
  "HELD",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "AUTO_CANCELLED",
  "CANCELLED",
  "REFUNDED",
  "BLOCKED",
] as const;

export interface RevenueTrendPoint {
  bucketStart: string;
  grossMinor: number;
  platformFeeMinor: number;
  vendorOwedMinor: number;
}

export interface RevenueTrendFilter {
  period?: "daily" | "weekly" | "monthly";
  from?: string;
  to?: string;
}

export interface TopVendorRow {
  vendorId: string;
  vendorName: string | null;
  totalRevenueMinor: number;
  bookingCount: number;
}

export interface TopVendorsFilter {
  limit?: number;
  metric?: "revenue" | "bookings";
}

export interface DistrictDistributionRow {
  district: string;
  hotels: number;
  vehicles: number;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private bucketStartFor(
    date: Date,
    period: "daily" | "weekly" | "monthly",
  ): Date {
    if (period === "weekly") return startOfDhakaWeek(date);
    if (period === "monthly") return startOfDhakaMonth(date);
    return startOfDhakaDay(date);
  }

  async revenueTrend(filter: RevenueTrendFilter): Promise<RevenueTrendPoint[]> {
    const period = filter.period ?? "daily";
    const where: Record<string, unknown> = {};
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lt: new Date(filter.to) } : {}),
      };
    }

    // groupBy(["type", "createdAt"]) would group by the exact millisecond
    // timestamp — every row would form its own group, defeating bucketing
    // entirely. Instead, fetch matching rows and bucket them in JS with a
    // Map accumulator, the same pattern vendor-dashboard.service.ts's
    // getEarnings uses for its byListing aggregation.
    const entries = await this.prisma.ledgerEntry.findMany({
      where,
      select: { type: true, amountMinor: true, createdAt: true },
    });

    const buckets = new Map<string, RevenueTrendPoint>();
    for (const entry of entries) {
      const bucketStart = this.bucketStartFor(
        entry.createdAt,
        period,
      ).toISOString();
      const existing = buckets.get(bucketStart) ?? {
        bucketStart,
        grossMinor: 0,
        platformFeeMinor: 0,
        vendorOwedMinor: 0,
      };
      if (entry.type === "GROSS_PAYMENT")
        existing.grossMinor += entry.amountMinor;
      if (entry.type === "PLATFORM_FEE")
        existing.platformFeeMinor += entry.amountMinor;
      if (entry.type === "VENDOR_OWED")
        existing.vendorOwedMinor += entry.amountMinor;
      buckets.set(bucketStart, existing);
    }

    return Array.from(buckets.values()).sort((a, b) =>
      a.bucketStart.localeCompare(b.bucketStart),
    );
  }

  async bookingStatusBreakdown(): Promise<Record<string, number>> {
    const rows = await this.prisma.booking.groupBy({
      by: ["status"],
      _count: true,
    });

    const result: Record<string, number> = {};
    for (const status of ALL_BOOKING_STATUSES) {
      result[status] = 0;
    }
    for (const row of rows) {
      result[row.status] = typeof row._count === "number" ? row._count : 0;
    }
    return result;
  }

  async topVendors(filter: TopVendorsFilter): Promise<TopVendorRow[]> {
    const limit = filter.limit ?? 10;
    const metric = filter.metric ?? "revenue";

    const orderBy =
      metric === "bookings"
        ? Prisma.sql`booking_count DESC`
        : Prisma.sql`total_revenue_minor DESC`;

    return this.prisma.$queryRaw<TopVendorRow[]>(Prisma.sql`
      SELECT
        u.id AS "vendorId",
        u.full_name AS "vendorName",
        COALESCE(SUM(le.amount_minor) FILTER (WHERE le.type = 'GROSS_PAYMENT'), 0)::int AS "totalRevenueMinor",
        COUNT(DISTINCT b.id)::int AS "bookingCount"
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'VENDOR'
      LEFT JOIN bookings b ON b.resource_owner_id = u.id
      LEFT JOIN ledger_entries le ON le.booking_id = b.id
      GROUP BY u.id, u.full_name
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `);
  }

  async districtDistribution(): Promise<DistrictDistributionRow[]> {
    const [hotelRows, vehicleRows] = await Promise.all([
      this.prisma.hotel.groupBy({ by: ["city"], _count: true }),
      this.prisma.vehicle.groupBy({ by: ["city"], _count: true }),
    ]);

    const byDistrict = new Map<string, DistrictDistributionRow>();
    for (const row of hotelRows) {
      const count = typeof row._count === "number" ? row._count : 0;
      byDistrict.set(row.city, {
        district: row.city,
        hotels: count,
        vehicles: 0,
      });
    }
    for (const row of vehicleRows) {
      const count = typeof row._count === "number" ? row._count : 0;
      const existing = byDistrict.get(row.city) ?? {
        district: row.city,
        hotels: 0,
        vehicles: 0,
      };
      existing.vehicles = count;
      byDistrict.set(row.city, existing);
    }

    return Array.from(byDistrict.values());
  }
}
```

Note on `topVendors`'s raw SQL: this deliberately joins `bookings` directly on `resource_owner_id = u.id` rather than joining through `rooms`/`hotels`/`vehicles` to find the owner — `Booking.resourceOwnerId` (`@map("resource_owner_id")`) already identifies the vendor for both ROOM and VEHICLE bookings alike (confirmed in `bookings.service.ts`, e.g. lines 91/109 setting `resourceOwnerId` from either the room's hotel owner or the vehicle's owner at booking-creation time), so no join through `rooms`/`hotels`/`vehicles` is needed at all here — that join is only needed in Task 9's `AdminBookingService.list`, where `district` (which lives on `Hotel`/`Vehicle`, not `Booking`) is actually being selected. All other column/table names above (`users`, `full_name`, `user_roles`, `user_id`, `role`, `bookings`, `ledger_entries`, `booking_id`, `amount_minor`, `type`) are confirmed against `apps/api/prisma/schema.prisma`.

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-analytics.service`
Expected: PASS.

- [ ] **Step 10: Write the failing controller tests**

`apps/api/src/admin/admin-analytics.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("AdminAnalyticsController", () => {
  let controller: AdminAnalyticsController;
  let service: {
    revenueTrend: jest.Mock;
    bookingStatusBreakdown: jest.Mock;
    topVendors: jest.Mock;
    districtDistribution: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      revenueTrend: jest.fn(),
      bookingStatusBreakdown: jest.fn(),
      topVendors: jest.fn(),
      districtDistribution: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAnalyticsController],
      providers: [{ provide: AdminAnalyticsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AdminAnalyticsController);
  });

  it("revenueTrend() delegates with query params", async () => {
    service.revenueTrend.mockResolvedValue([]);
    await controller.revenueTrend({ period: "weekly" });
    expect(service.revenueTrend).toHaveBeenCalledWith({
      period: "weekly",
      from: undefined,
      to: undefined,
    });
  });

  it("bookingStatusBreakdown() delegates with no params", async () => {
    service.bookingStatusBreakdown.mockResolvedValue({});
    await controller.bookingStatusBreakdown();
    expect(service.bookingStatusBreakdown).toHaveBeenCalled();
  });

  it("topVendors() delegates with query params", async () => {
    service.topVendors.mockResolvedValue([]);
    await controller.topVendors({ limit: 5, metric: "bookings" });
    expect(service.topVendors).toHaveBeenCalledWith({
      limit: 5,
      metric: "bookings",
    });
  });

  it("districtDistribution() delegates with no params", async () => {
    service.districtDistribution.mockResolvedValue([]);
    await controller.districtDistribution();
    expect(service.districtDistribution).toHaveBeenCalled();
  });
});
```

- [ ] **Step 11: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-analytics.controller`
Expected: FAIL — module not found.

- [ ] **Step 12: Implement the controller**

`apps/api/src/admin/admin-analytics.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import {
  AdminAnalyticsService,
  RevenueTrendPoint,
  TopVendorRow,
  DistrictDistributionRow,
} from "./admin-analytics.service";
import {
  RevenueTrendQueryDto,
  TopVendorsQueryDto,
} from "./dto/analytics-query.dto";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @ApiOperation({
    summary:
      "Platform revenue trend bucketed daily/weekly/monthly (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Revenue trend points." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("revenue-trend")
  async revenueTrend(
    @Query() query: RevenueTrendQueryDto,
  ): Promise<RevenueTrendPoint[]> {
    return this.analyticsService.revenueTrend({
      period: query.period,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({
    summary:
      "Booking counts by status, zero-filled for every BookingStatus value (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Booking status breakdown." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("booking-status-breakdown")
  async bookingStatusBreakdown(): Promise<Record<string, number>> {
    return this.analyticsService.bookingStatusBreakdown();
  }

  @ApiOperation({
    summary: "Top vendors by revenue or booking count (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "Ranked vendor rows." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("top-vendors")
  async topVendors(
    @Query() query: TopVendorsQueryDto,
  ): Promise<TopVendorRow[]> {
    return this.analyticsService.topVendors({
      limit: query.limit,
      metric: query.metric,
    });
  }

  @ApiOperation({
    summary:
      "Active hotel/vehicle listing counts per district (ADMIN/SUPER_ADMIN only)",
  })
  @ApiResponse({ status: 200, description: "District distribution rows." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not ADMIN or SUPER_ADMIN.",
  })
  @Get("district-distribution")
  async districtDistribution(): Promise<DistrictDistributionRow[]> {
    return this.analyticsService.districtDistribution();
  }
}
```

- [ ] **Step 13: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- admin-analytics.controller`
Expected: PASS.

- [ ] **Step 14: Wire into `AdminModule`**

In `apps/api/src/admin/admin.module.ts`, add `AdminAnalyticsService` to `providers` and `AdminAnalyticsController` to `controllers`.

- [ ] **Step 15: Write the e2e spec**

`apps/api/test/admin-analytics.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createAdmin,
  createVerifiedVendor,
  createHotelWithRoom,
  createTraveler,
} from "./helpers/test-fixtures";

describe("Admin Analytics (e2e)", () => {
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

  it("GET /admin/analytics/booking-status-breakdown requires ADMIN/SUPER_ADMIN", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/booking-status-breakdown")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/analytics/booking-status-breakdown returns all 8 statuses, zero-filled, against a small seeded dataset", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin1@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createTraveler(
      app,
      "analytics-e2e-traveler1@example.com",
    );
    await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-01",
        checkOut: "2026-12-03",
      });

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/booking-status-breakdown")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "AUTO_CANCELLED",
        "BLOCKED",
        "CANCELLED",
        "CHECKED_IN",
        "COMPLETED",
        "CONFIRMED",
        "HELD",
        "REFUNDED",
      ].sort(),
    );
    expect(res.body.HELD).toBeGreaterThanOrEqual(1);
  });

  it("GET /admin/analytics/district-distribution reflects seeded hotel/vehicle counts", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin2@example.com",
    );
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "analytics-e2e-vendor3@example.com",
    );
    await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/district-distribution")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((row: { hotels: number }) => row.hotels >= 1)).toBe(
      true,
    );
  });

  it("GET /admin/analytics/top-vendors ranks by revenue by default", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "analytics-e2e-admin3@example.com",
    );

    const res = await request(app.getHttpServer())
      .get("/v1/admin/analytics/top-vendors")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 16: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- admin-analytics`
Expected: PASS (Docker services up).

- [ ] **Step 17: Full monorepo verification + commit**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

```bash
git add -A
git commit -m "feat(api): add operational platform analytics (revenue trend, booking-status breakdown, top vendors, district distribution)"
```

---

## Task 12: Swagger check + PR + ROADMAP update

**Files:** None (verification + process only).

- [ ] **Step 1: Manually verify Swagger UI**

Run: `pnpm --filter @staybangla/api dev` (Docker services up), open `http://localhost:3001/api/docs`.
Expected: under the "admin" tag, all of the following are listed with bearer-auth required:

- Vendors: `POST/GET vendors` (list), `POST :id/suspend`/`:id/unsuspend`, `PATCH :id/commission`, `POST :id/approve`/`:id/reject`
- Travelers: `GET travelers` (list), `POST :id/suspend`/`:id/unsuspend`
- Audit log: `GET audit-log`
- Overview: `GET overview`
- Bookings: `GET bookings` (list), `POST :id/force-cancel`
- Analytics: `GET analytics/revenue-trend`, `GET analytics/booking-status-breakdown`, `GET analytics/top-vendors`, `GET analytics/district-distribution`

`GET pending` and `GET :id/history` are gone (removed in Task 7).

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/add-admin-panel-basic
gh pr create --title "feat: add enterprise admin panel (suspension, audit log, overview, booking control, traveler control, analytics)" --body "Implements ROADMAP.md item 1.10. See docs/superpowers/specs/2026-07-30-add-admin-panel-basic-design.md for the base design; this PR additionally covers admin booking control, traveler control (reusing vendor suspension), and operational platform analytics, per the enterprise-scope expansion agreed with the project owner."
gh pr checks --watch
```

- [ ] **Step 3: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Update ROADMAP.md**

On a new small branch/PR: change item 1.10's status from `🚧 next` to `✅` (summarizing all endpoint groups — vendor suspension, traveler suspension, unified audit log, platform overview, vendor/traveler lists, admin booking control with force-cancel, and operational analytics — the `VendorVerificationLog → AdminAuditLog` migration, and every suspension-enforcement surface touched), and mark item 1.11 (`add-marketing-landing-page`) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc (vendor suspension + all 4 enforcement surfaces, unified audit log + migration, commission-endpoint audit logging + 404 fix, platform overview, vendor list, RBAC, testing strategy) has a corresponding task, and every enterprise-expansion item requested by the project owner (booking control, traveler control, analytics dashboard) has a corresponding task (9, 10, 11). ✓
- **Found during self-review:** the design doc's endpoint list didn't explicitly say `GET /admin/vendors/pending` and `GET /admin/vendors/:id/history` are removed, only that the new endpoints "replace"/"supersede" them — Task 7 makes this explicit (Step 14) and Task 7's Step 15 requires grepping for any other caller of the removed methods before considering the task done, so a forgotten reference doesn't silently ship as a 500.
- **Found during self-review:** the plan's tasks originally had `VendorSuspensionService`/`AdminAuditLogService`/`AdminOverviewService` all as separate providers with no shared base — confirmed this is correct and intentional (YAGNI: no shared abstraction needed for three services with genuinely different responsibilities), not an oversight. The same reasoning extends to Tasks 9-11: `AdminBookingService`/`AdminAnalyticsService` are separate providers, and Task 10 deliberately adds _no_ new suspension service at all (reuses `VendorSuspensionService` verbatim), which is the DRY-correct choice here, not a missing abstraction.
- **Found during self-review (enterprise expansion):** the original scope-decision write-up assumed `groupBy` had zero precedent in this codebase before this expansion; re-reading Task 7's `AdminOverviewService` (already in this same plan) shows `prisma.ledgerEntry.groupBy` is used there. Task 11 (`AdminAnalyticsService`) is therefore not the first `groupBy` usage — corrected in Task 11's Interfaces note to cite Task 7 as precedent instead of claiming a first-ever usage.
- **Found during self-review (enterprise expansion):** Task 9's `BOOKING_FORCE_CANCELLED` enum addition depends on whether Task 1's migration has already been applied by the time Task 9 executes. Task 9 Step 1 handles both orderings: fold into Task 1's not-yet-run migration, or generate a small additive migration if Task 1 already ran — this is called out explicitly so the implementer doesn't silently skip the migration step in either case.
- **Type consistency:** `AdminActionType` values (`VENDOR_APPROVED`, `VENDOR_REJECTED`, `VENDOR_RESUBMITTED`, `VENDOR_SUSPENDED`, `VENDOR_UNSUSPENDED`, `COMMISSION_RATE_CHANGED`, `BOOKING_FORCE_CANCELLED`) are defined once (Task 1, extended in Task 9) and used identically by name in Tasks 2, 4, 6, and 9 — no renamed duplicates. `AuditLogFilter`/`AuditLogResult` (Task 3), `PlatformOverview` (Task 7), `AdminBookingFilter`/`AdminBookingRow`/`AdminBookingListResult` (Task 9), `RevenueTrendPoint`/`RevenueTrendFilter`/`TopVendorRow`/`TopVendorsFilter`/`DistrictDistributionRow` (Task 11) are each defined once and consumed only within their own task — no cross-task type dependency for any of these, confirmed correct since nothing downstream needs them.
- **No placeholders:** every step has complete, real code — every DTO, service, controller, and e2e spec (Tasks 1-11) is given in full. The explicit caveats are flagged as check-before-running notes, not TBDs: Task 8 Step 3's test-password-literal check, and Tasks 9/11's raw-SQL column-name verification against the actual `schema.prisma` `@map(...)` values (raw SQL bypasses Prisma's compile-time field checking, so this check is load-bearing, not optional).
- **Never-refund guarantee (enterprise expansion):** Task 9's `AdminBookingService.forceCancel` is grep-confirmed to only ever write `{ status: "CANCELLED" }` — no `paymentStatus` field appears anywhere in that method — and Task 9's e2e spec includes an explicit assertion (`expect(cancelled.paymentStatus).toBe(paymentStatusBefore)`) proving this holds end-to-end, not just at the unit level.
- **Fixed during a later polish pass, against the real codebase (not just design-doc memory):** an Explore agent was dispatched to read the actual current `schema.prisma`, `bookings.service.ts`, `hotels.service.ts`, `vehicles.service.ts`, `vendor-dashboard.service.ts`, `dhaka-time.ts`, and `test-fixtures.ts`/`test-db.ts`, and several concrete errors were found and corrected: (1) Task 9's `AdminBookingRow`/SQL used invented column names `traveler_id`/`total_price_minor` that don't exist — the real `Booking` fields are `userId`/`user_id` and `totalAmountMinor`/`total_amount_minor`; (2) Task 9's `district` DTO field was a free-form string instead of the real `District` enum; (3) Task 10's `createBooking` traveler-suspension check used a parameter name `travelerId` that doesn't exist on the real method (it's `userId`) and incorrectly implied the check might duplicate an existing lookup, when `createBooking` never loads the caller's own row today; (4) Task 11's `startOfDhakaWeek`/`endOfDhakaWeek` used a divergent `Intl.DateTimeFormat`-with-`weekday`-option approach instead of reusing the file's actual internal helpers (`toDhakaParts`/`dhakaMidnightUtc`) — rewritten to match, and the date arithmetic was verified by running it in Node against the plan's own test expectations; (5) Task 11's `revenueTrend` had a real correctness bug — `groupBy(["type", "createdAt"])` groups by the exact millisecond timestamp, producing one "bucket" per ledger entry instead of per day/week/month — rewritten to `findMany` + a `Map` accumulator, mirroring `vendor-dashboard.service.ts`'s `getEarnings` pattern, with new test cases proving two same-day entries merge into one bucket; (6) Task 11's `topVendors` raw SQL joined `bookings` to vendors via a correlated subquery through `rooms`/`hotels`/`vehicles`, which is both invalid-shaped SQL and would double-count vendors who own both hotels and vehicles — simplified to join directly on `Booking.resourceOwnerId`, which already identifies the vendor with no join needed; (7) Task 8's `cleanDatabase()` instructions said to _add_ an `adminAuditLog.deleteMany()` line without noting that Task 1 drops `VendorVerificationLog` entirely, so the existing `vendorVerificationLog.deleteMany()` line must be _replaced_, not supplemented, or the test helper references a Prisma Client property that no longer exists.
