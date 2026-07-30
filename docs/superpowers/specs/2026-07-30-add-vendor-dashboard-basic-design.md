# Vendor Dashboard (Basic) — Design

**ROADMAP:** Phase 1, item 1.9 (`add-vendor-dashboard-basic`)
**Status:** Design approved 2026-07-30
**Depends on:** `add-hotel-vehicle-booking-core` (Booking lifecycle), `add-payment-gateway-integration` (LedgerEntry, commissionRatePercent), `add-room-listing-enhancements` (Hotel/Room/Vehicle, photo/amenity model — read, not modified, by this module).

## Problem

A vendor (hotel or vehicle owner) currently has no way to see their own business at a glance. Booking data, payment ledger entries, and listing state all exist in the database, but every one of them requires a database query or an admin's help to inspect — there is no vendor-facing endpoint for "how much did I make this month," "what's booked next," or "which of my rooms/vehicles are active." Vendors also have no way to record income from a booking that happened outside the platform (a walk-in guest, a phone booking) — that income is real but invisible to both the vendor's own records inside the app and, more importantly, invisible to availability: nothing currently stops a room genuinely occupied by a walk-in guest from being sold again through the platform for the same dates.

## Scope

One vendor-facing dashboard: a summary view, a listings view, a bookings view, an earnings view, and a way to record both offline income/expense and offline (walk-in) bookings. This module explicitly does **not** touch photo/facility publishing or moderation — that system (already shipped in `add-room-listing-enhancements`: a listing's photos and amenities go public immediately once the vendor account is `VERIFIED`) is unchanged here. A separate content-moderation workflow was considered during design and deliberately deferred — see "Explicitly deferred."

## Principles

- **Two booking sources.** _Online_ bookings (via StayBangla + SSLCommerz) are fully automatic — they land in the dashboard with zero vendor action, exactly as `Booking`/`LedgerEntry` already work today. _Offline_ bookings (walk-in, phone, any channel outside the platform) are entered by the vendor manually (endpoint 6, below).
- **Listing publication is unchanged.** A `VERIFIED` vendor's rooms/vehicles go public immediately, with whatever photos/amenities the vendor has already set via the existing endpoints. This module reads that data (for the listings view) but does not add any new approval step in front of it.
- **One vendor, one property type.** A hotel vendor and a vehicle vendor are always distinct accounts (`User.vendorType`). Every endpoint below returns hotel-shaped or vehicle-shaped data for that one caller — never both, never cross-vendor.

## Endpoints

### 1. `GET /vendor/dashboard/summary`

Returns, for the calling vendor, computed in **Asia/Dhaka** time (not UTC — a booking or ledger entry timestamped just after UTC midnight must still count as "today" in the vendor's own timezone, or the summary undercounts by a day near every day-boundary):

| Field                                                                                  | Source                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `monthlyIncomeMinor`                                                                   | online (`LedgerEntry`, `type=VENDOR_OWED`) + offline (`VendorLedgerEntry`, `direction=INCOME`) for the current calendar month                                                                                      |
| `upcomingCheckIns`                                                                     | count of the caller's `Booking` rows with `status IN (CONFIRMED, CHECKED_IN)` and a future date range — counts online and offline (endpoint 6) bookings alike, since both share the same `status` values by design |
| `activeListings`                                                                       | count of the caller's active rooms (hotel vendor) or vehicles (vehicle vendor)                                                                                                                                     |
| `hotelOccupancyRatePct` (hotel vendor) or `vehicleUtilizationRatePct` (vehicle vendor) | room-nights (or vehicle-days) booked ÷ available, current month — see "Occupancy vs. utilization" below; only the field matching the caller's property type is present in the response                             |
| `todayCheckIns`, `todayCheckOuts`                                                      | counts, "today" in Asia/Dhaka                                                                                                                                                                                      |
| `verificationStatusAlert`                                                              | a plain string derived from `User.verifiedStatus` at request time (e.g. `"Your account is pending verification"`), `null` when `VERIFIED`                                                                          |

### Occupancy vs. utilization

Hotel occupancy (room-nights booked ÷ room-nights available) and vehicle utilization (days booked ÷ days available) are the same calculation shape but different domain concepts wearing the same name. Returning them as distinctly named fields — never a single generic `occupancyRatePct` — means the frontend can never accidentally mislabel one as the other, and the response for a vehicle vendor simply omits `hotelOccupancyRatePct` entirely rather than returning it as `null`.

### 2. `GET /vendor/listings`

Hotel vendor → the hotel plus every room; vehicle vendor → every vehicle. Per item: `isActive`, existing photo count (from `RoomPhoto`/`HotelPhoto`, unfiltered — every photo currently on a listing is already public, per the unchanged publication model above), this item's own earnings total and booking count for the current month.

### 3. `GET /vendor/bookings?status=&roomId=&vehicleId=&from=&to=`

Reads the existing `Booking` table filtered to `resourceOwnerId = caller`. All four query params are optional filters (status, a specific room or vehicle, a date range) — this is the only place a vendor sees individual booking records rather than aggregates, and it is how a vehicle vendor with several vehicles isolates one vehicle's history from the rest.

### 4. `GET /vendor/earnings?period=today|week|month&from=&to=`

Combines online (`LedgerEntry`) and offline (`VendorLedgerEntry`) into a total plus a per-listing (per-room or per-vehicle) breakdown. `period` is a named preset; `from`/`to` is an explicit custom range. The two are mutually exclusive — a request supplying both returns `400 Bad Request`, since there is no sensible way to combine "this month" with an arbitrary override without silently picking one and confusing the caller about which won.

### 5. Manual ledger entries (offline income/expense that isn't a booking)

- `POST /vendor/ledger-entries` — `{ roomId | vehicleId (exactly one, required), direction: INCOME | EXPENSE, category: MAINTENANCE | SALARY | UTILITY | OTHER, amountMinor, note?, entryDate }`. No commission is ever computed on these rows — this money never touched StayBangla's payment flow, so there is nothing for the platform to take a cut of. `vendorId` is derived server-side from the authenticated caller, never read from the request body. The server validates that exactly one of `roomId`/`vehicleId` is present and that it belongs to the caller.
  - **`category: WALK_IN_BOOKING` is rejected here** (`400`, pointing the caller at endpoint 6 below) — see "Why walk-in income is not a plain ledger entry."
- `GET /vendor/ledger-entries` — the caller's own entries, newest first.
- `DELETE /vendor/ledger-entries/:id` — corrects a mistaken entry. Soft delete (see "Soft delete, not hard delete" below), owner-only.

### 6. Offline (walk-in) bookings — blocks availability

- `POST /vendor/bookings/offline` — `{ roomId | vehicleId (exactly one), checkIn, checkOut, guestName?, amountMinor, note? }`. Creates a row in the existing `Booking` table with the new `source = OFFLINE` (see "Schema" below), `status = CONFIRMED`, and the given date range — this is what actually removes those dates from public availability, using the exact same `NOT EXISTS`-over-`bookings` availability query `searchAvailableRooms`/`searchAvailable` already run today (verified: that query filters on `status`, not on any online/offline distinction, so it requires no change at all to correctly block an offline booking's dates). In the same transaction, creates a linked `VendorLedgerEntry` (`category: WALK_IN_BOOKING`, `direction: INCOME`, `bookingId` set) so endpoint 4's earnings totals are correct without the vendor entering the same income twice.
- `DELETE /vendor/bookings/offline/:id` — vendor cancels a walk-in booking early (no-show, mistake). Sets the `Booking` row to `CANCELLED`, immediately freeing those dates for the next search. The linked `VendorLedgerEntry` is **not** auto-deleted — cancelling the occupancy doesn't retroactively mean the money was never real; the vendor adjusts or deletes that ledger entry separately via endpoint 5 if needed.

### Why walk-in income is not a plain ledger entry

An earlier draft of this design treated a walk-in booking as nothing more than a `VendorLedgerEntry` with `category: WALK_IN_BOOKING` — a financial record only, with no effect on availability. That's incomplete: a walk-in guest is physically occupying a room for real dates, and the platform's own availability search has no way to know that unless a `Booking` row exists for those dates. Without one, a traveler could book the same room online for overlapping dates — a real double-booking, not a hypothetical one. Endpoint 6 exists specifically to close that gap; endpoint 5 no longer accepts this category at all, so there is exactly one path that can create walk-in income, and it's the one that also protects availability.

### Double-booking prevention for the new write path

`POST /vendor/bookings/offline` inserts into the same `bookings` table the online (SSLCommerz) booking path already writes to, through a second, independent code path. That means the same overlap-prevention this table already relies on (the `EXCLUDE USING gist` constraint from `add-hotel-vehicle-booking-core`, keyed on `room_id`/`vehicle_id` + `date_range` for active-status rows) must cover this new insert too — and it already does, by construction, since a Postgres exclusion constraint applies to every row regardless of which code path inserted it. No new constraint is needed; this is called out explicitly so the implementer doesn't assume a separate check is required, and instead relies on the existing constraint the same way `createBooking` already does (catch the constraint-violation error, translate it to `409 Conflict`).

## Schema

```prisma
enum LedgerDirection {
  INCOME
  EXPENSE
}

enum VendorLedgerCategory {
  WALK_IN_BOOKING  // only ever created by POST /vendor/bookings/offline
  MAINTENANCE
  SALARY
  UTILITY
  OTHER
}

enum BookingSource {
  ONLINE
  OFFLINE
}

model VendorLedgerEntry {
  id          String               @id @default(uuid())
  vendorId    String               @map("vendor_id")
  roomId      String?              @map("room_id")
  vehicleId   String?              @map("vehicle_id")
  bookingId   String?              @map("booking_id")   // set only when auto-created by POST /vendor/bookings/offline
  direction   LedgerDirection
  category    VendorLedgerCategory
  amountMinor Int                  @map("amount_minor")
  note        String?
  entryDate   DateTime             @map("entry_date")
  deletedAt   DateTime?            @map("deleted_at")   // soft delete
  createdAt   DateTime             @default(now()) @map("created_at")

  vendor  User     @relation(fields: [vendorId], references: [id])
  booking Booking? @relation(fields: [bookingId], references: [id])

  @@index([vendorId, entryDate])
  @@index([roomId])
  @@index([vehicleId])
  @@map("vendor_ledger_entries")
}
```

Raw-SQL migration addition (Prisma cannot express an XOR check natively — same pattern already used for the `bookings_bookable_consistency_check` constraint in the booking-core migration):

```sql
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_room_xor_vehicle_check"
  CHECK (("room_id" IS NOT NULL) != ("vehicle_id" IS NOT NULL));
```

**Existing `Booking` model gains one field:** `source BookingSource @default(ONLINE) @map("source")`. Every existing row backfills to `ONLINE` (correct — every booking that exists today came through the online flow). `POST /vendor/bookings/offline` is the only endpoint in the codebase that ever creates a row with `source = OFFLINE`. This is additive: `searchAvailableRooms`, `searchAvailable`, and every other existing read of `Booking` continue to filter on `status` exactly as they do today, with zero behavior change — `source` is metadata for display/filtering (endpoint 3's response, and a future distinction if ever needed), not a new gate on any existing query.

### Why a new table, not reusing `LedgerEntry`

The existing `LedgerEntry` (from `add-payment-gateway-integration`) always ties to a real `bookingId` from the SSLCommerz-confirmed flow and always carries `ratePercentApplied` — neither applies to a manual entry that never had a commission computed. Forcing offline data into that shape would mean either fabricating a fake `GROSS_PAYMENT`/`PLATFORM_FEE` pair with a meaningless rate, or adding a nullable commission field that bleeds into the payment module's audit trail for entries that were never actually run through commission logic at all.

## Open design decisions

### One route per endpoint group, not one per property type

Considered: fully separate routes per vendor type (e.g. `/vendor/hotel/dashboard/summary` vs. `/vendor/vehicle/dashboard/summary`), duplicated across all six endpoints above.

**Rejected.** Every endpoint stays a single route shared by both hotel and vehicle vendors. The handler reads the caller's `vendorType` and shapes the response accordingly (e.g. endpoint 1 returns `hotelOccupancyRatePct` for a hotel vendor and `vehicleUtilizationRatePct` for a vehicle vendor from the same call). A fully duplicated route set would mean twelve endpoints instead of six, with near-identical auth, ownership-check, and query logic copy-pasted twice for a difference that's really just a handful of response fields and which foreign key (`roomId` vs. `vehicleId`) is used — a branch inside one handler, not a reason to fork the whole route tree.

### No `PATCH` on ledger entries — delete-and-recreate instead

Editing a manual entry is delete (soft) then create-new, not update-in-place. A correction is always a new, independently-dated event — this keeps "what did the vendor actually enter, and when" unambiguous without needing an edit-history table.

### Soft delete, not hard delete

`VendorLedgerEntry` rows feed directly into earnings totals (endpoint 4). A hard delete would erase the record of a vendor's correction with no trace — if a vendor later disputes their own earnings history, there'd be no way to reconstruct what was deleted or why. `DELETE /vendor/ledger-entries/:id` sets `deletedAt` and every aggregation query excludes rows where `deletedAt IS NOT NULL`; the row itself is retained.

### `category`/`direction` are independent, no DB-level pairing constraint

`WALK_IN_BOOKING` is not constrained to `direction: INCOME` at the database level, even though every current write path only ever creates it that way. Left permissive rather than over-constrained now, in case a legitimate future case (e.g. recording a walk-in refund as an `EXPENSE` against the same category) comes up — noted here rather than silently assumed either way.

## Testing strategy

- Unit tests for the summary/earnings aggregation logic: online-only, offline-only, and combined totals; Asia/Dhaka day-boundary correctness (a booking/entry timestamped at 23:30 UTC must count as the next day in Dhaka, since Dhaka is UTC+6); `period`+`from`/`to` mutual-exclusion rejection.
- Unit tests for `VendorLedgerEntry` validation: exactly-one-of-`roomId`/`vehicleId` enforcement, ownership check, `WALK_IN_BOOKING` rejection on the plain-entry endpoint.
- E2e test proving `POST /vendor/bookings/offline` actually removes the booked dates from `GET /rooms/available` (or the vehicle equivalent) — this is the test that proves endpoint 6 does what endpoint 5 alone could not.
- E2e test proving an online booking attempt for the same room/dates as an existing offline booking is rejected with `409`, exercising the shared exclusion constraint from the new write path, not just the old one.
- Ownership tests across every endpoint: vendor A cannot read/filter/delete vendor B's listings, bookings, or ledger entries.

## Explicitly deferred (not scope-creep, tracked for later)

| Concern                                                                        | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Photo/facility moderation (per-item admin approval before going public)        | A distinct product/policy change to the existing, already-shipped publication model (`add-room-listing-enhancements`: `VERIFIED` vendor's content goes public immediately) — reversing that model is a decision on its own, not a dashboard feature, and was never part of this module's brainstormed scope. Candidate for a future `add-listing-moderation` module or folded into `add-admin-panel-basic` (ROADMAP 1.10) if the business need is confirmed. |
| Editing existing ledger entries in place                                       | Superseded by the delete-and-recreate decision above.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Multi-property-type vendors (a single account owning both hotels and vehicles) | `User.vendorType` supports `BOTH` in the schema, but no current vendor exercises it and no endpoint above is blocked by assuming one property type per vendor; revisit if `BOTH` sees real usage.                                                                                                                                                                                                                                                            |
| Bulk offline-income CSV import                                                 | Not requested; the single-entry `POST /vendor/ledger-entries` path is sufficient for now.                                                                                                                                                                                                                                                                                                                                                                    |
| Payout/settlement view, per-listing time-series analytics                      | `add-earnings-analytics-dashboard` (ROADMAP 2.3) — this module's aggregates are read-on-request, not a reporting/warehouse layer.                                                                                                                                                                                                                                                                                                                            |
| Push/email notifications for `verificationStatusAlert`                         | `add-reviews-notifications` (ROADMAP 2.4) territory if ever needed; the summary endpoint's on-request derivation is sufficient for v1.                                                                                                                                                                                                                                                                                                                       |
