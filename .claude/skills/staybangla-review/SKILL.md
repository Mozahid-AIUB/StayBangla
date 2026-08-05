---
name: staybangla-review
description: Use when reviewing, code-reviewing, or verifying any change to the StayBangla API (apps/api) — including per-task reviews, whole-branch reviews before a PR, and self-review before committing. Encodes five defect classes that have each shipped or nearly shipped on this codebase while the full test suite stayed green.
---

# StayBangla Review Checklist

## Overview

Five defect classes have recurred on this codebase. Every one of them **passed a fully green test suite** and was caught only because a reviewer was specifically told to look for it. Generic review does not find these — they are specific to this stack (Prisma + raw Postgres SQL, `Asia/Dhaka` business timezone, integer-minor-unit money, role-based suspension, an audit log used as the system of record).

**Core principle:** a green suite is not evidence. For each class below, the question is not "does the code look right" but "would any test fail if this were broken?"

Apply this **in addition to** normal review, not instead of it.

## When to Use

- Reviewing any diff touching `apps/api` — task-scoped or whole-branch
- Before opening a PR to `main` (branch-protected, requires a passing CI `verify`)
- Self-review before committing
- Auditing a module that has never been independently reviewed

Skip only for pure documentation changes that touch no `.ts`, `.prisma`, `.json`, or `.sql` file.

## The Five Classes

### 1. Raw SQL binding an enum without a Postgres cast

Prisma sends bound parameters as `text`. Comparing `text` to a Postgres enum column raises `42883` **at runtime only** — mocked unit tests cannot reach it.

```ts
// ✗ throws: operator does not exist: "BookingStatus" = text
Prisma.sql`AND status = ${filter.status}`;

// ✓
Prisma.sql`AND b.status = ${filter.status}::"BookingStatus"`;
```

The value must stay a bound parameter inside the tagged template. Never interpolate it into the string — that is a SQL-injection hole, not a fix.

**Check:** every `${...}` in a `Prisma.sql` template whose column is an enum (`BookingStatus`, `District`, `AdminActionType`, `PaymentStatus`, `LedgerEntryType`, `VerifiedStatus`, role values) carries `::"TypeName"`. Verify the type name against `apps/api/prisma/schema.prisma` and the migration that created it.

**Live example of both sides:** `admin-booking.service.ts:44` has the cast (added after review caught it). `vendor-dashboard.service.ts:297` still does not — a real 500 on `GET /v1/vendor/bookings?status=X`.

### 2. UTC used where `Asia/Dhaka` is required

Dhaka is UTC+6. `new Date("2026-07-30")` is `2026-07-30T00:00:00Z`, but that Dhaka day began at `2026-07-29T18:00:00Z`. Any date-bucketing, day/week/month boundary, or `from`/`to` filter that truncates in UTC is wrong by six hours — which reads as a plausible-looking number, never an error.

**Check:**

- SQL truncation uses `AT TIME ZONE 'Asia/Dhaka'`; TS uses the helpers in `apps/api/src/common/date/dhaka-time.ts`.
- **The filter window and the bucket boundaries use the same timezone.** A Dhaka-bucketed aggregation with a UTC-filtered window loses six hours off the first bucket and invents a partial trailing one.
- Half-open ranges: `startOfDhakaDay(to)` with `lt` (exclusive), not `endOfDhakaDay(to)` with `lte`. Off-by-one here double-counts or drops a whole day.

**Test adequacy — the part reviewers skip:** a timezone test whose fixtures sit at UTC times where the UTC and Dhaka calendar dates _agree_ proves nothing. A naive-UTC implementation passes it. Fixtures must land in the **18:00Z–24:00Z window**, where the two dates differ.

```ts
// This fixture discriminates; 10:00Z fixtures do not.
// Sunday 2026-08-02T19:00:00Z is Monday 2026-08-03 in Dhaka.
// A UTC-weekday implementation returns 2026-07-26T18:00Z — a FULL WEEK wrong.
expect(startOfDhakaWeek(new Date("2026-08-02T19:00:00Z"))).toEqual(
  new Date("2026-08-02T18:00:00.000Z"),
);
```

Recurred three times: vendor-dashboard occupancy %, analytics bucket truncation, analytics filter window.

### 3. Tests that stay green against a broken feature

The most common and most dangerous class. Three shapes:

| Shape                                        | Why it proves nothing                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| "the row I created appears in the list"      | A filter replaced by a no-op still returns it                            |
| `expect(sqlObject.values).toContain(x)`      | Order-blind; passes against `<>` instead of `=`, or swapped OFFSET/LIMIT |
| `expect(rendered).toContain("suspended_at")` | String match; passes if the fragment sits in a comment                   |

**What actually discriminates:** assert **exclusion**. Create two rows, make one match and one not, assert the non-matching one is **absent** (`.not.toContain`). Then prove it: temporarily break the filter, watch the test fail, revert.

**Guard-override theatre — check this on every admin controller spec.** All 10 specs under `apps/api/src/admin/` override both guards:

```ts
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(RolesGuard).useValue({ canActivate: () => true })
```

Deleting `@Roles("ADMIN","SUPER_ADMIN")` from any admin controller leaves **every one of them green**. Real authorization coverage lives only in e2e specs that boot the real `AppModule` with no `overrideGuard` and assert `403`. When a diff adds an admin endpoint, require that e2e assertion — a new controller spec is not coverage.

**The rule:** for any new check, state what would fail if it were deleted. If the answer is "nothing", the test is decoration.

### 4. Money: int32 overflow and BigInt serialization

`amount_minor` columns are Postgres `int` (int32). `SUM()` over them returns `bigint`, and `::int` does **not** truncate — it raises `integer out of range`.

int32 max = 2,147,483,647 minor units = **21,474,836 BDT (~2.15 crore)**. On an unfiltered lifetime sum that grows monotonically, one mid-size vendor reaches it and the endpoint 500s permanently for everyone.

The fix has **two halves — both required**:

```ts
// SQL: ::bigint, not ::int
COALESCE(SUM(le.amount_minor) FILTER (WHERE le.type = 'GROSS_PAYMENT'), 0)::bigint

// TS: convert before it leaves the service — a raw BigInt throws on JSON.stringify
totalRevenueMinor: Number(row.totalRevenueMinor)
```

Changing only the SQL turns a rare 500 into an immediate one.

**Check:** every money aggregate casts to `::bigint` with a JS-side `Number()`. No floats anywhere — money stays integer minor units end to end. Any percentage or ratio handles a zero denominator.

### 5. Enforcement gaps between modules — the seam class

Enforcement here is **service-layer and convention-dependent**: every write path must remember to call the check. Each task is individually correct; the gap lives in the seam, so task-scoped review structurally cannot see it. This has now recurred across **three separate methods**.

Concretely: `createBooking` checked `suspendedAt`, but `createOfflineBooking`, `createBlock`, and `RoomsService.create/update` did not — so a vendor suspended for fraud kept writing `CONFIRMED` bookings and ledger entries for the ~15 minutes their access token stayed valid (`JwtAccessStrategy` reads roles off the JWT claim and never re-reads the DB).

**Check — enumerate, don't spot-check.** When a diff adds or touches an enforcement rule, list **every** vendor- or user-facing write path and mark which enforce it:

| Path                                                                     | Enforces?                    |
| ------------------------------------------------------------------------ | ---------------------------- |
| `HotelsService.create` / `VehiclesService.create`                        | yes                          |
| `RoomsService.create` / `update`                                         | yes                          |
| `BookingsService.createBooking` / `createOfflineBooking` / `createBlock` | yes                          |
| `VehiclesService.update`                                                 | **no** — known gap           |
| hotel/room photo mutations                                               | **no** — known, symmetric    |
| `VendorLedgerService.create`                                             | **no** — no inventory effect |

An asymmetry that isn't deliberate is a bug. If a fix leaves one, it must be disclosed, not silently shipped.

**Also in this class — audit-log truthfulness.** The audit log is the system of record for disputes. Check that every state-changing admin action writes a row with the correct actor, target, and action, and that no action label is hardcoded where it can be reached by more than one role. A mislabelled row cannot be back-filled later — nothing records what it should have said.

## Quick Reference

| Look for                                  | Red flag                                                      | Verify by                                 |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `Prisma.sql` with `${}` on an enum column | no `::"Type"` cast                                            | grep the template; check `schema.prisma`  |
| Date bucketing / `from`/`to` filters      | no `AT TIME ZONE 'Asia/Dhaka'`, or filter and bucket disagree | fixture in 18:00Z–24:00Z                  |
| New filter / aggregation                  | only "my row appears" assertions                              | break it, watch a test fail               |
| New admin endpoint                        | only a controller spec                                        | require a real-`AppModule` e2e 403        |
| `SUM(...)` on money                       | `::int`, or no `Number()`                                     | seed a total above 2,147,483,647          |
| New enforcement rule                      | one call site changed                                         | enumerate every write path                |
| New audit row                             | hardcoded action label                                        | check it can't be reached by another role |

## Common Mistakes

- **Trusting the green suite.** Every defect above shipped green. Ask what would fail, not what passes.
- **Eyeballing Swagger decorators.** All six admin GET endpoints' query params were entirely absent from the generated document (no `@nestjs/swagger` CLI plugin is configured, so nothing is inferred). Dump the real OpenAPI JSON via `configureApp` — reading decorators found nothing.
- **Accepting a report's RED evidence on faith.** Judge from the test's own structure whether it would fail against the unfixed code.
- **Treating flaky e2e as noise.** `apps/api/test/jest-e2e.json` sets `testTimeout: 30000` because 22 suites each boot a full `AppModule` in `beforeAll`. If flakiness returns, that is the first thing to check — not a reason to re-run until green.
- **Reviewing only the diff.** Three of the five classes were found in _unchanged_ code that the diff made newly relevant.

## Structural Fix Worth Proposing

Class 5 recurs because enforcement is convention-dependent. A controller-layer suspension guard, or a database-level check, would make the gap structurally impossible rather than something each new write path must remember. Worth raising whenever the vendor surface grows.

## What This Checklist Measurably Adds

Tested head-to-head on `vendor-dashboard.service.ts`: two reviewers, identical prompts, one reading this checklist first.

Both found the missing enum cast and the naive-UTC `week` branch — **a careful reviewer finds those without help.** The checklist's actual delta was four defects the baseline missed:

- `getEarnings` parsing `from`/`to` as UTC — six hours off the Dhaka day. The baseline found the _adjacent_ `week` bug and stopped; class 2's "the filter window and the bucket boundaries must use the same timezone" is what carried the reviewer to the second one.
- `VendorType.BOTH` vendors silently losing their entire vehicle inventory to an `if (isHotel) { rooms } else { vehicles }` branch.
- `upcomingCheckIns` counting all-time with no date predicate, 15 lines above `todayCheckIns` which filters correctly.
- Nullable `vendorType` falling through to the vehicle branch, masking incomplete onboarding.

The with-skill reviewer also assessed test adequacy on **every** finding — naming which mock made each defect invisible — while the baseline did so only on the one it was most confident about. That habit is what this checklist actually transfers, and it is what produced the extra findings.

**So: don't expect this to catch what a careful reviewer would miss on one named file. Expect it to widen what gets examined at all.**
