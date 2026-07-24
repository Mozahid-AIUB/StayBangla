# Hotel/Vehicle Booking Core — Design

**Status:** Approved for planning
**Scope:** Backend + database only (`apps/api`). No frontend/UI in this change.
**Depends on:** `add-auth-otp-rbac` (Phase 1, merged) — reuses User/Role/CASL foundation.

## Problem

StayBangla needs a booking engine that lets a VERIFIED vendor list hotel rooms and vehicles, and lets a traveler search, hold, pay for, and complete a booking — with zero possibility of two travelers double-booking the same room/vehicle for overlapping dates, even under concurrent load.

## Architecture

One generic, polymorphic `Booking` model serves both resource types, rather than separate `HotelBooking`/`VehicleBooking` tables. Lifecycle logic (hold → confirm → checkout, double-booking prevention) is written once and reused for every future bookable resource type (packages, etc. in later phases).

```
┌─────────────┐        ┌─────────────┐
│   Hotel     │        │    User     │
│ (ownerId)   │        │ (VENDOR)    │
└──────┬──────┘        └──────┬──────┘
       │ 1:N                  │ 1:N
       ▼                      ▼
┌─────────────┐        ┌─────────────┐
│    Room     │        │   Vehicle   │
│ (1 physical │        │ (1 physical │
│  unit each) │        │  unit each) │
└──────┬──────┘        └──────┬──────┘
       │                      │
       └──────────┬───────────┘
                   ▼
            ┌─────────────┐
            │   Booking   │  (bookableType: ROOM | VEHICLE, bookableId)
            │  dateRange  │  ← Postgres daterange, EXCLUDE USING gist
            └─────────────┘
```

### Why Room/Vehicle = one physical unit, not "type + quantity pool"

Double-booking prevention relies on a Postgres `EXCLUDE USING gist` constraint per bookable row: it guarantees no two active bookings can hold overlapping date ranges on the _same row_. This only works cleanly when one row = one physical unit. A "10 Double Rooms" hotel therefore has 10 separate `Room` rows (same `roomType: "DOUBLE"` tag, different `id`), not one row with a `quantity: 10` counter.

This intentionally differs from large hotel-chain PMS systems (which assign a physical room only at check-in, for staff flexibility). StayBangla is a booking _platform_ matching travelers to vendor inventory — not a hotel's internal front-desk system — so assigning a specific unit at booking time (like Airbnb-style vacation-rental platforms) is the correct fit for this domain and scale, and it lets the database constraint do the concurrency-safety work instead of application-level locking.

`roomType`/vehicle `type` remain simple string tags on each row, used for filtering/display/pricing grouping — they don't change the one-row-per-unit invariant.

## Data Model (Prisma, new models)

```prisma
enum BookableType { ROOM VEHICLE }
enum VehicleCategory { CNG JEEP BOAT }

model Hotel {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  city        String                                    // explicit field for search filtering, not parsed from address
  address     String
  description String?
  amenities   String[]
  starRating  Int?
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  owner User   @relation(fields: [ownerId], references: [id])
  rooms Room[]

  @@map("hotels")
}

model Room {
  id                String   @id @default(uuid())
  hotelId           String   @map("hotel_id")
  roomType          String   @map("room_type")       // e.g. "DOUBLE", "SUITE" — display tag only
  pricePerNightMinor Int     @map("price_per_night_minor")
  currency          String   @default("BDT")
  capacity          Int
  isActive          Boolean  @default(true) @map("is_active")   // soft-delete
  createdAt         DateTime @default(now()) @map("created_at")

  hotel    Hotel     @relation(fields: [hotelId], references: [id])
  bookings Booking[] @relation("RoomBookings")

  @@map("rooms")
}

model Vehicle {
  id           String          @id @default(uuid())
  ownerId      String          @map("owner_id")
  category     VehicleCategory
  city         String                                   // service-area city, for search filtering
  model        String?
  capacity     Int
  pricePerDayMinor Int         @map("price_per_day_minor")
  currency     String          @default("BDT")
  isActive     Boolean         @default(true) @map("is_active")
  createdAt    DateTime        @default(now()) @map("created_at")

  owner    User      @relation(fields: [ownerId], references: [id])
  bookings Booking[] @relation("VehicleBookings")

  @@map("vehicles")
}

enum BookingStatus {
  HELD
  CONFIRMED
  CHECKED_IN
  COMPLETED
  AUTO_CANCELLED
  CANCELLED
  REFUNDED
  BLOCKED   // vendor-created maintenance/blackout block, not a real customer booking
}

model Booking {
  id              String        @id @default(uuid())
  userId          String?       @map("user_id")           // null for vendor-created BLOCKED rows
  bookableType    BookableType  @map("bookable_type")
  roomId          String?       @map("room_id")
  vehicleId       String?       @map("vehicle_id")
  resourceOwnerId String        @map("resource_owner_id")  // denormalized from Room/Vehicle owner at creation time
  dateRange       Unsupported("daterange") @map("date_range")
  guestCount      Int?          @map("guest_count")
  totalAmountMinor Int          @map("total_amount_minor")
  currency        String        @default("BDT")
  status          BookingStatus @default(HELD)
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  user    User?    @relation(fields: [userId], references: [id])
  room    Room?    @relation("RoomBookings", fields: [roomId], references: [id])
  vehicle Vehicle? @relation("VehicleBookings", fields: [vehicleId], references: [id])

  @@map("bookings")
}
```

Raw-SQL additions to the generated migration (Prisma can't express these natively, same pattern as the auth module's CHECK constraint):

```sql
-- Exactly one of roomId/vehicleId set, matching bookableType
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookable_consistency_check"
  CHECK (
    (bookable_type = 'ROOM' AND room_id IS NOT NULL AND vehicle_id IS NULL) OR
    (bookable_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND room_id IS NULL)
  );

-- The core double-booking guard: no two ACTIVE bookings may overlap on the same room
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_no_overlap"
  EXCLUDE USING gist (
    room_id WITH =,
    date_range WITH &&
  ) WHERE (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED') AND room_id IS NOT NULL);

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_no_overlap"
  EXCLUDE USING gist (
    vehicle_id WITH =,
    date_range WITH &&
  ) WHERE (status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED') AND vehicle_id IS NOT NULL);
```

(Partial exclusion constraints — `CANCELLED`/`AUTO_CANCELLED`/`COMPLETED`/`REFUNDED` rows never block new bookings for the same dates.)

### Consistency with existing `@staybangla/shared-types` `BookingStatus`

Phase 0 already created `packages/shared-types/src/enums.ts`'s `BookingStatus` (`SELECTED, HELD, CONFIRMED, CHECKED_IN, COMPLETED, AUTO_CANCELLED, CANCELLED, REFUNDED`). This design's Prisma enum intentionally differs in two ways, both addressed as part of this change:

- **`SELECTED` is not a Prisma/DB value.** No `Booking` row is ever persisted before a hold exists — "selecting" a room is pure frontend UI state before the traveler calls `POST /bookings`. It stays in shared-types (frontend may use it for local UI state) but is correctly absent from the database enum.
- **`BLOCKED` is new** (vendor-created maintenance/blackout entries). This task's implementation must add `BLOCKED` to `packages/shared-types/src/enums.ts`'s `BookingStatus` too, so the frontend (later) can recognize it in any API response (e.g. an admin/vendor calendar view) — keeping the shared enum a superset that covers every value the API can actually return, plus the one frontend-only pre-persistence state.

### Implementation note: `daterange` is not a native Prisma type

`Unsupported("daterange")` tells Prisma the column exists with that Postgres type, but Prisma Client cannot construct or filter on it directly. `BookingsService` will need `$queryRaw`/`$executeRaw` (via `PrismaService`, already available) specifically for: (a) inserting a `Booking` row with its `date_range` value (built from `checkIn`/`checkOut` as `daterange($1, $2, '[)')` — half-open interval, matching how nights are counted), and (b) the availability-search query (`&&` overlap operator against existing active bookings). Every other `Booking` field is ordinary Prisma Client usage; only the range column needs raw SQL.

## Booking Lifecycle

```
POST /bookings ──► validate (dates sane, guestCount <= capacity, resource isActive,
                    resource owner is VERIFIED) ──► INSERT status=HELD
                    (EXCLUDE constraint atomically rejects overlap → 409 Conflict)
                    ──► enqueue BullMQ delayed job (delay=BOOKING_HOLD_MINUTES,
                        jobId=booking.id)

POST /bookings/:id/confirm-payment (idempotent)
   UPDATE bookings SET status='CONFIRMED' WHERE id=:id AND status='HELD'
   → 0 rows updated AND current status already CONFIRMED → return success (idempotent no-op)
   → 0 rows updated AND status is CANCELLED/AUTO_CANCELLED → 409 (too late, already expired)
   → cancel the pending BullMQ job

[BullMQ job fires after BOOKING_HOLD_MINUTES]
   UPDATE bookings SET status='AUTO_CANCELLED' WHERE id=:id AND status='HELD'
   → guarded by the same WHERE, so if confirm-payment already ran, this is a no-op

POST /bookings/:id/checkout (vendor, must own resource, idempotent)
   UPDATE bookings SET status='COMPLETED' WHERE id=:id AND status IN ('CONFIRMED','CHECKED_IN')
     AND resource_owner_id = :callerId

POST /bookings/:id/cancel (traveler, own booking only)
   UPDATE bookings SET status='CANCELLED' WHERE id=:id AND user_id=:callerId
     AND status IN ('HELD','CONFIRMED')
   (No real refund logic yet — payment is a stub. Flagged explicitly: this is a
   simplified placeholder. Real cancellation-fee/refund-policy logic is deferred
   to add-payment-gateway-integration, Phase 2.)

POST /vendor/blocks (vendor, own resource)
   INSERT bookings (status='BLOCKED', userId=NULL, ...) — same EXCLUDE constraint
   applies, so a blackout date also blocks customer bookings for that range.
```

Every status-changing operation is a single guarded `UPDATE ... WHERE status IN (...)` inside a DB transaction — this is what makes confirm-payment vs. the auto-cancel timer race-safe: whichever reaches Postgres first wins atomically; the other's `WHERE` clause matches zero rows and becomes a safe no-op.

## Endpoints

```
GET   /rooms/available?checkIn&checkOut&city         (public — city matches Hotel.city)
GET   /vehicles/available?date&city                  (public — city matches Vehicle.city)
POST  /hotels                                        (VERIFIED vendor)
POST  /hotels/:id/rooms                              (owner vendor)
PATCH /rooms/:id                                     (owner vendor; supports isActive soft-delete)
POST  /vehicles                                       (VERIFIED vendor)
PATCH /vehicles/:id                                   (owner vendor; soft-delete)

POST  /bookings                                       (traveler)           → HELD
POST  /bookings/:id/confirm-payment                   (idempotent)         → CONFIRMED
POST  /bookings/:id/checkout                          (owner vendor, idempotent) → COMPLETED
POST  /bookings/:id/cancel                            (own booking)        → CANCELLED
POST  /vendor/blocks                                  (owner vendor)       → BLOCKED
```

## RBAC / CASL

- Only `verifiedStatus === VERIFIED` vendors may create Hotel/Room/Vehicle.
- Vendor can update/soft-delete/checkout/block only resources where `ownerId === user.id` (CASL condition, extending the existing `CaslAbilityFactory`).
- Traveler can create bookings on any active+verified resource; can read/cancel only `booking.userId === user.id`.
- `resourceOwnerId` is denormalized onto `Booking` at creation time specifically so the checkout-ownership check is a plain field comparison, not a join — same technique already used nowhere else in this codebase but consistent with keeping CASL conditions on directly-accessible fields.

## Payment (stub)

`PaymentProviderPort` (abstract class — same pattern as `SmsProviderPort`/`EmailProviderPort` from the auth module) with `charge(bookingId, amountMinor, currency): Promise<{ success: boolean }>`. A `StubPaymentProviderService` always resolves `{ success: true }` and logs, mirroring the console SMS/email fakes. Real gateway integration (SSLCommerz) is out of scope — `add-payment-gateway-integration`, Phase 2.

## Explicitly deferred (not scope-creep, tracked for later modules)

| Concern                                         | Deferred to                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Real refund/cancellation-fee policy             | `add-payment-gateway-integration`                                                                                                       |
| Booking-event notifications (SMS/email)         | `add-reviews-notifications`                                                                                                             |
| Commission/payout calculation                   | `add-vendor-dashboard-basic`, `add-earnings-analytics-dashboard`                                                                        |
| Seasonal/weekday dynamic pricing                | Flat per-night/per-day rate is sufficient now; schema (`pricePerNightMinor` on `Room`) doesn't block adding a rate-calendar table later |
| Vendor-suspension effect on existing bookings   | `add-admin-panel-basic`                                                                                                                 |
| Self-booking (vendor booking their own listing) | Not blocked by default — no policy need identified yet; trivial to add a check later if fraud/review-manipulation becomes a concern     |

## Testing Strategy

TDD throughout, matching the auth module's discipline. The single most important test in this module: **concurrent booking race test** — fire two real (not mocked) HTTP requests at `POST /bookings` for the same room and overlapping dates via `Promise.all`, assert exactly one succeeds (201) and the other gets 409, against the real `staybangla_test` Postgres — this is the only way to actually prove the EXCLUDE constraint holds under concurrency, not just in sequential application logic.

Also required: idempotency tests (confirm-payment/checkout called twice), ownership tests (vendor A cannot checkout/block vendor B's resource), capacity/date validation tests, and an auto-cancel test (using a very short `BOOKING_HOLD_MINUTES` in `.env.test`, or directly invoking the BullMQ processor function, rather than waiting on real wall-clock time).

## Env additions

```
BOOKING_HOLD_MINUTES=15
```
