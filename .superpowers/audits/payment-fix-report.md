# Payment/analytics ledger unique-constraint test fix

Branch: `fix/auth-payment-audit-findings`
Starting HEAD: `588cfc3` (fix(api): make ledger writes atomic and enforce one ledger row per booking+type)
Fix commit: `b50ec95` (test(api): seed analytics ledger fixtures one row per booking+type)

## Independent confirmation of the one-row-per-`(booking, type)` claim

Did not take the dispatch's claim on faith — re-derived it directly:

- `grep -rn "ledgerEntry\.(create|createMany)" apps/api/src` → exactly one hit:
  `apps/api/src/bookings/bookings.service.ts:288`, inside `confirmIfValid`'s
  `$transaction`. That `createMany` writes exactly three rows per booking:
  `GROSS_PAYMENT`, `PLATFORM_FEE`, `VENDOR_OWED` — one of each, once.
- `apps/api/prisma/schema.prisma:119-123` — `LedgerEntryType` has exactly
  those three values. No refund/adjustment/correction type exists, so no
  production code path could legitimately write a second row of the same
  type for one booking even if it wanted to.
- Checked every other reference to `ledgerEntry.*` in `apps/api/src`
  (`vendor-dashboard.service.ts`, `admin-overview.service.ts`,
  `admin-analytics.service.ts`) — all are `findMany`/`aggregate`/`groupBy`
  reads, never writes.
- Checked raw SQL: the only two references to the `ledger_entries` table
  outside Prisma's generated queries (`vendor-dashboard.service.ts:320`,
  `admin-analytics.service.ts:176`) are a `SELECT`/subquery and a
  `LEFT JOIN` respectively — no raw `INSERT INTO ledger_entries` exists
  anywhere.
- Found (not flagged by the dispatch) `apps/api/src/vendor-dashboard/vendor-ledger.service.ts`,
  which has a `.create()` call that looked adjacent at first glance. Read it
  fully: it writes to `prisma.vendorLedgerEntry`, a completely different
  Prisma model backed by the `vendor_ledger_entries` table — unrelated to
  `ledger_entries`/`LedgerEntry` and untouched by the new constraint.

Conclusion: confirmed independently. Two `GROSS_PAYMENT` (or any other
single type) rows on one booking cannot occur in production. The
constraint (`UNIQUE (booking_id, type)`, migration
`20260805185846_ledger_entry_unique_booking_type`) is correct as written
and was not weakened.

## What changed per test

All four tests previously wrote same-type ledger rows directly onto a
single booking via `testPrisma.ledgerEntry.create()` (a test-only shortcut,
since no HTTP-facing payment-confirmation flow exists in this suite). That
shortcut violated the new constraint. The fix in every case: keep the same
fixture _values_, but give each same-type row its own booking, using
additional calls to `createHotelWithRoom` (distinct rooms, so the gist
`bookings_room_no_overlap` exclusion constraint — keyed on `room_id`, not
vendor or date — never collides even with identical/overlapping date
ranges).

1. **Overflow test** (`top-vendors ... exceeds int32 max`) — added a second
   room/hotel for the same vendor and a second booking. The two
   `GROSS_PAYMENT` rows of 1,500,000,000 each now sit on two distinct
   bookings for the same vendor instead of one booking. `topVendors` sums
   by `u.id` across all of a vendor's bookings, so the sum (3,000,000,000)
   and the "past int32 max" property are unchanged.

2. **Weekly test** (`revenue-trend?period=weekly`) — added three rooms/
   bookings (one per fixture, since all three rows are `GROSS_PAYMENT`).
   `createdAt` values (`2026-07-27T01:00Z`, `2026-07-30T10:00Z`,
   `2026-08-03T01:00Z`) are untouched — bucketing keys off the ledger row's
   `createdAt`, not the booking, so spreading across bookings does not
   change which Dhaka week each row lands in.

3. **Monthly test** (`revenue-trend?period=monthly`) — same shape: three
   rooms/bookings, one per fixture. `createdAt` values (`2026-09-02T01:00Z`,
   `2026-09-25T01:00Z`, `2026-10-05T01:00Z`) untouched.

4. **Dhaka-boundary filter test** (`revenue-trend?from=&to=`) — two rooms/
   bookings, one per fixture. `createdAt` values untouched:
   `includedInstant = 2026-07-29T19:00:00.000Z`,
   `excludedInstant = 2026-07-30T19:00:00.000Z`. Both remain inside the
   18:00Z–24:00Z window where the UTC and Dhaka calendar dates diverge — no
   fixture drifted. Only the `bookingId` each row references changed.

## Discrimination evidence (RED confirmed, then reverted)

For each test, deliberately broke the corresponding production code,
re-ran only that test, confirmed failure, then reverted and confirmed the
service file had zero diff (`git diff apps/api/src/admin/admin-analytics.service.ts`
empty) before re-running the full spec.

1. **Overflow test.** Changed
   `COALESCE(SUM(le.amount_minor) FILTER (...), 0)::bigint` to `::int` in
   `admin-analytics.service.ts`. Result:

   ```
   FAIL  × ... does not overflow when a vendor's summed GROSS_PAYMENT exceeds int32 max
   expect(received).toBe(expected)
   Expected: 200
   Received: 500
   ```

   Postgres raised "integer out of range" on the `SUM(...)::int` cast, the
   endpoint 500'd, and the test's `expect(res.status).toBe(200)` failed.
   Reverted; `git diff` on the service file was empty; test passed again.

2. **Weekly test.** Changed `bucketStartFor`'s weekly branch from
   `startOfDhakaWeek(date)` to `startOfDhakaDay(date)`. Result:

   ```
   FAIL  × ...period=weekly merges entries from different Dhaka days of the same Dhaka week...
   ```

   With daily bucketing, the July 27 and July 30 entries land in separate
   buckets instead of merging, so `weekOfJuly27.grossMinor` no longer
   equals 33000. Reverted; diff empty; test passed again.

3. **Monthly test.** Changed the monthly branch from `startOfDhakaMonth(date)`
   to `startOfDhakaDay(date)`. Result:

   ```
   FAIL  × ...period=monthly merges entries from different Dhaka days of the same Dhaka month
   ```

   The Sept 2 and Sept 25 entries no longer merge into one bucket, so
   `septBucket.grossMinor` no longer equals 15000. Reverted; diff empty;
   test passed again.

4. **Dhaka-boundary filter test.** Changed the `from`/`to` filter from
   `startOfDhakaDay(new Date(filter.from))` / `startOfDhakaDay(new Date(filter.to))`
   to naive `new Date(filter.from)` / `new Date(filter.to)`. Result:
   ```
   FAIL  × ...filters using Dhaka calendar-day boundaries, excluding a same-UTC-day entry...
   ```
   The naive UTC filter wrongly excludes the `includedInstant` row
   (2026-07-29T19:00Z, Dhaka 07-30 01:00, but before UTC midnight on
   07-30), so `totalGross` no longer equals 12345. Reverted; diff empty;
   test passed again.

All four reverts were confirmed via an empty `git diff` on
`admin-analytics.service.ts` before moving to the next mutation, and the
full 13-test spec was re-run green after all mutations were reverted.

## cleanDatabase() delete-order check

Checked explicitly (not assumed): `git diff apps/api/test/helpers/test-db.ts`
is empty — no change was needed. The extra fixtures add more rows to
tables (`booking`, `room`, `hotel`, `ledgerEntry`) that were already
covered by the existing delete order, and no new table or new FK edge was
introduced. `ledgerEntry` was already deleted before `booking`; `booking`
was already deleted before `room`/`vehicle`/`hotel`. No confusing FK
failure surfaced in this or any other spec.

## Test results

- `apps/api/test/admin-analytics.e2e-spec.ts`: **13/13 passed**.
- Unit suite (`pnpm --filter @staybangla/api run test:unit`):
  **389/389 passed**, 56/56 suites — matches stated baseline.
- `pnpm --filter @staybangla/api exec tsc --noEmit`: clean, no errors.
- Full e2e suite: run by the coordinator in parallel (session ID
  `bm1c3yew9` from this agent's own earlier run was superseded and not
  waited on, per coordinator instruction). Not independently confirmed by
  this report — see coordinator's own run for the 142/142 figure.

## Concerns

None. The constraint is correct and was not modified. All four tests keep
their original discriminating fixture values (timestamps, amounts) and
only change which booking each ledger row is attached to. No new
production code was touched except during the temporary, reverted
discrimination-check mutations.
