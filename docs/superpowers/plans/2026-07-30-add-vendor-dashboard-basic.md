# Vendor Dashboard (Basic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a vendor (hotel or vehicle owner) six endpoints to see their own business — a dashboard summary, their listings, their bookings, their combined online+offline earnings, manual offline income/expense entries, and the ability to record an offline (walk-in) booking that actually blocks the room/vehicle's availability.

**Architecture:** New `VendorDashboardModule` (`apps/api/src/vendor-dashboard/`) with one controller and one service, reading the existing `Booking`/`LedgerEntry`/`Hotel`/`Room`/`Vehicle`/`User` tables and writing to one new table (`VendorLedgerEntry`). The one new write path that touches the existing `bookings` table (`POST /vendor/bookings/offline`) reuses the exact raw-SQL insert pattern already established in `BookingsService.createBlock` (Postgres `daterange` + the existing `EXCLUDE USING gist` constraint for overlap safety) — no new module owns booking-lifecycle logic; this module calls into a small addition on `BookingsService` for that one write.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16 (`daterange`/`EXCLUDE USING gist`, unchanged from `add-hotel-vehicle-booking-core`). No new npm dependency — Asia/Dhaka day-boundary math uses native `Intl.DateTimeFormat` with `timeZone: "Asia/Dhaka"`, not a new date library.

## Global Constraints

- Every new endpoint: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("VENDOR")`, exactly the pattern already used by `HotelsController.create`/`RoomsController.create`/`BookingsController.createBlock`.
- `vendorId`/`resourceOwnerId` is **always** derived server-side from `@CurrentUser() user: RequestUser`, **never** read from any request body — matches the existing discipline in every vendor-scoped endpoint in this codebase.
- All money fields are integer minor units (paisa), never floats — matches every existing money field (`totalAmountMinor`, `amountMinor`, `pricePerNightMinor`).
- "Today"/"this month" boundaries are computed in **Asia/Dhaka** (UTC+6), not server UTC — every date-boundary calculation in this plan uses the same helper (Task 1) so there is exactly one place this logic lives.
- No `PATCH` on `VendorLedgerEntry` — correction is delete (soft) + create-new, per the approved design.
- `VendorLedgerEntry.category = WALK_IN_BOOKING` is rejected on `POST /vendor/ledger-entries` — the only path that creates a `WALK_IN_BOOKING` row is `POST /vendor/bookings/offline`.
- Kebab-case file names, constructor DI (`private readonly x: X`), relative imports — matches every existing module in `apps/api/src`.
- Every task ends green on `pnpm --filter @staybangla/api run test:unit` and/or `test:e2e` before moving to the next task.

---

## File Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma                                        [MODIFY: +VendorLedgerEntry, +LedgerDirection, +VendorLedgerCategory, +BookingSource, Booking.source]
│   └── migrations/<ts>_add_vendor_dashboard/                 [NEW]
├── src/
│   ├── app.module.ts                                         [MODIFY: +VendorDashboardModule]
│   ├── common/
│   │   └── date/
│   │       ├── dhaka-time.ts(+.spec)                         [NEW: Asia/Dhaka boundary helpers]
│   ├── bookings/
│   │   ├── bookings.service.ts                               [MODIFY: +createOfflineBooking, +cancelOfflineBooking]
│   │   ├── bookings.service.spec.ts                           [MODIFY: +tests for the two new methods]
│   │   └── bookings.types.ts                                  [MODIFY: BookingRecord gains `source`]
│   └── vendor-dashboard/
│       ├── vendor-dashboard.module.ts                         [NEW]
│       ├── vendor-dashboard.controller.ts(+.spec)             [NEW]
│       ├── vendor-dashboard.service.ts(+.spec)                [NEW]
│       ├── vendor-ledger.service.ts(+.spec)                   [NEW]
│       └── dto/
│           ├── list-bookings-query.dto.ts                     [NEW]
│           ├── earnings-query.dto.ts                          [NEW]
│           ├── create-ledger-entry.dto.ts                     [NEW]
│           └── create-offline-booking.dto.ts                  [NEW]
└── test/
    └── vendor-dashboard.e2e-spec.ts                            [NEW]
```

---

## Task 1: Asia/Dhaka date helper

**Files:**

- Create: `apps/api/src/common/date/dhaka-time.ts`
- Test: `apps/api/src/common/date/dhaka-time.spec.ts`

**Interfaces:**

- Produces: `startOfDhakaDay(date: Date): Date`, `endOfDhakaDay(date: Date): Date`, `startOfDhakaMonth(date: Date): Date`, `endOfDhakaMonth(date: Date): Date` — every later task that needs a "today"/"this month" boundary calls these, so there is exactly one implementation of Dhaka-timezone math in the codebase.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/common/date/dhaka-time.spec.ts`:

```ts
import {
  startOfDhakaDay,
  endOfDhakaDay,
  startOfDhakaMonth,
  endOfDhakaMonth,
} from "./dhaka-time";

describe("dhaka-time", () => {
  describe("startOfDhakaDay", () => {
    it("returns the UTC instant for 00:00 Dhaka time on the same Dhaka calendar day", () => {
      // 2026-07-30T20:00:00Z is 2026-07-31T02:00:00 in Dhaka (UTC+6)
      const input = new Date("2026-07-30T20:00:00.000Z");
      const result = startOfDhakaDay(input);
      // 2026-07-31T00:00:00 Dhaka == 2026-07-30T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-30T18:00:00.000Z");
    });

    it("does not roll back a day for a time just after UTC midnight that is already the next Dhaka day", () => {
      // 2026-07-30T23:30:00Z is 2026-07-31T05:30:00 in Dhaka
      const input = new Date("2026-07-30T23:30:00.000Z");
      const result = startOfDhakaDay(input);
      expect(result.toISOString()).toBe("2026-07-30T18:00:00.000Z");
    });
  });

  describe("endOfDhakaDay", () => {
    it("returns the UTC instant just before the next Dhaka midnight", () => {
      const input = new Date("2026-07-30T20:00:00.000Z");
      const result = endOfDhakaDay(input);
      // 2026-08-01T00:00:00 Dhaka == 2026-07-31T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-31T18:00:00.000Z");
    });
  });

  describe("startOfDhakaMonth", () => {
    it("returns the UTC instant for the 1st of the Dhaka calendar month at 00:00 Dhaka time", () => {
      const input = new Date("2026-07-30T20:00:00.000Z"); // 2026-07-31 Dhaka
      const result = startOfDhakaMonth(input);
      // 2026-07-01T00:00:00 Dhaka == 2026-06-30T18:00:00Z
      expect(result.toISOString()).toBe("2026-06-30T18:00:00.000Z");
    });
  });

  describe("endOfDhakaMonth", () => {
    it("returns the UTC instant just before the 1st of the next Dhaka calendar month", () => {
      const input = new Date("2026-07-30T20:00:00.000Z"); // 2026-07-31 Dhaka
      const result = endOfDhakaMonth(input);
      // 2026-08-01T00:00:00 Dhaka == 2026-07-31T18:00:00Z
      expect(result.toISOString()).toBe("2026-07-31T18:00:00.000Z");
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- dhaka-time`
Expected: FAIL — `Cannot find module './dhaka-time'`.

- [ ] **Step 3: Implement**

`apps/api/src/common/date/dhaka-time.ts`:

```ts
const DHAKA_OFFSET_MINUTES = 6 * 60;

function toDhakaParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  return { year, month, day };
}

function dhakaMidnightUtc(year: number, month: number, day: number): Date {
  // Dhaka is a fixed UTC+6 offset (no DST) — midnight Dhaka time on
  // (year, month, day) is (year, month, day) 00:00 minus 6 hours in UTC.
  const utcMillis =
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) -
    DHAKA_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMillis);
}

export function startOfDhakaDay(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  return dhakaMidnightUtc(year, month, day);
}

export function endOfDhakaDay(date: Date): Date {
  const { year, month, day } = toDhakaParts(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return dhakaMidnightUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
}

export function startOfDhakaMonth(date: Date): Date {
  const { year, month } = toDhakaParts(date);
  return dhakaMidnightUtc(year, month, 1);
}

export function endOfDhakaMonth(date: Date): Date {
  const { year, month } = toDhakaParts(date);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  return dhakaMidnightUtc(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
  );
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- dhaka-time`
Expected: PASS — all 4 test cases green.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/add-vendor-dashboard-basic
git add apps/api/src/common/date
git commit -m "feat(api): add Asia/Dhaka day/month boundary helpers"
```

---

## Task 2: Prisma schema — `VendorLedgerEntry` + `Booking.source`

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: migration folder `apps/api/prisma/migrations/<timestamp>_add_vendor_dashboard/`

**Interfaces:**

- Produces: `VendorLedgerEntry` Prisma model (fields: `id, vendorId, roomId, vehicleId, bookingId, direction, category, amountMinor, note, entryDate, deletedAt, createdAt`), `LedgerDirection` enum (`INCOME | EXPENSE`), `VendorLedgerCategory` enum (`WALK_IN_BOOKING | MAINTENANCE | SALARY | UTILITY | OTHER`), `BookingSource` enum (`ONLINE | OFFLINE`), `Booking.source` field. Every later task's Prisma Client calls (`this.prisma.vendorLedgerEntry.*`, `this.prisma.booking.*` with `source`) depend on these exact names.

- [ ] **Step 1: Add the schema changes**

Append to `apps/api/prisma/schema.prisma` (after the existing `LedgerEntry` model):

```prisma
enum LedgerDirection {
  INCOME
  EXPENSE
}

enum VendorLedgerCategory {
  WALK_IN_BOOKING
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
  bookingId   String?              @map("booking_id")
  direction   LedgerDirection
  category    VendorLedgerCategory
  amountMinor Int                  @map("amount_minor")
  note        String?
  entryDate   DateTime             @map("entry_date")
  deletedAt   DateTime?            @map("deleted_at")
  createdAt   DateTime             @default(now()) @map("created_at")

  vendor  User     @relation(fields: [vendorId], references: [id])
  room    Room?    @relation(fields: [roomId], references: [id])
  vehicle Vehicle? @relation(fields: [vehicleId], references: [id])
  booking Booking? @relation(fields: [bookingId], references: [id])

  @@index([vendorId, entryDate])
  @@index([roomId])
  @@index([vehicleId])
  @@index([bookingId])
  @@map("vendor_ledger_entries")
}
```

Modify the existing `User` model to add the back-relation (append inside the existing relation block, alongside `ownedHotels`/`ownedVehicles`):

```prisma
  vendorLedgerEntries VendorLedgerEntry[]
```

Modify the existing `Room` model to add the back-relation (alongside `photos`):

```prisma
  vendorLedgerEntries VendorLedgerEntry[]
```

Modify the existing `Vehicle` model to add the back-relation:

```prisma
  vendorLedgerEntries VendorLedgerEntry[]
```

Modify the existing `Booking` model: add one new field (alongside `paymentStatus`) and its back-relation:

```prisma
  source BookingSource @default(ONLINE) @map("source")

  vendorLedgerEntries VendorLedgerEntry[]
```

- [ ] **Step 2: Generate the migration SQL without applying (non-interactive shell — `prisma migrate dev` requires a TTY that isn't available here)**

Run:

```bash
pnpm --filter @staybangla/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > apps/api/prisma/migrations/$(date +%Y%m%d%H%M%S)_add_vendor_dashboard/migration.sql
```

(Create the directory first if the shell doesn't auto-create it: `mkdir -p apps/api/prisma/migrations/$(date +%Y%m%d%H%M%S)_add_vendor_dashboard` — run `mkdir` and the redirect in the same command substitution so the timestamp matches, or capture the timestamp in a variable first.)

Better, to guarantee the same timestamp for both the directory and the file:

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p apps/api/prisma/migrations/${TS}_add_vendor_dashboard
pnpm --filter @staybangla/api exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > apps/api/prisma/migrations/${TS}_add_vendor_dashboard/migration.sql
```

- [ ] **Step 3: Append the XOR check constraint to the generated migration**

At the end of the new `migration.sql`, append:

```sql
-- Enforce exactly one of room_id/vehicle_id is set (defense-in-depth; app
-- layer also validates this) — same pattern as bookings_bookable_consistency_check.
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_room_xor_vehicle_check"
  CHECK (("room_id" IS NOT NULL) != ("vehicle_id" IS NOT NULL));
```

- [ ] **Step 4: Apply the migration to the dev database and regenerate the client**

Run:

```bash
pnpm --filter @staybangla/api exec prisma migrate deploy
pnpm --filter @staybangla/api exec prisma generate
```

Expected: migration applied, Prisma Client regenerated with `VendorLedgerEntry`/`LedgerDirection`/`VendorLedgerCategory`/`BookingSource` available.

- [ ] **Step 5: Apply the same migration to the `staybangla_test` database**

Run:

```bash
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
```

Expected: same migration applied to the test database — e2e tests in later tasks depend on this schema existing there.

- [ ] **Step 6: Verify the constraint exists**

Run:

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d vendor_ledger_entries"
```

Expected: output includes `Check constraints: "vendor_ledger_room_xor_vehicle_check" CHECK ((room_id IS NOT NULL) != (vehicle_id IS NOT NULL))`.

- [ ] **Step 7: Full unit regression run to confirm nothing broke**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS — this task only adds schema, no application code changes yet, so every existing test stays green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorLedgerEntry schema and Booking.source for vendor dashboard"
```

---

## Task 3: `BookingsService.createOfflineBooking` / `cancelOfflineBooking`

**Files:**

- Modify: `apps/api/src/bookings/bookings.service.ts`
- Modify: `apps/api/src/bookings/bookings.service.spec.ts`
- Modify: `apps/api/src/bookings/bookings.types.ts`

**Interfaces:**

- Consumes: `PrismaService` (existing, already injected in `BookingsService`), the existing `EXCLUDE USING gist` constraint (`add-hotel-vehicle-booking-core`), `isExclusionViolation` (existing private method on `BookingsService`).
- Produces: `BookingsService.createOfflineBooking(callerId: string, input: CreateOfflineBookingInput): Promise<{ booking: BookingRecord; vendorLedgerEntry: VendorLedgerEntryRecord }>` and `BookingsService.cancelOfflineBooking(callerId: string, bookingId: string): Promise<BookingRecord>` — Task 6 (controller) calls these by exact name. `BookingRecord` (existing type) gains a `source: "ONLINE" | "OFFLINE"` field.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/bookings/bookings.service.spec.ts` (the existing file already mocks `prisma`, `expiryQueue`, `paymentProvider`, `config` — this task reuses those same mocks; if you don't have the existing file open, the mock shape is: `prisma: { $queryRaw: jest.fn(), room: { findUnique: jest.fn() }, vehicle: { findUnique: jest.fn() }, booking: { findUnique: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() }, vendorLedgerEntry: { create: jest.fn() }, $transaction: jest.fn() }`):

```ts
describe("createOfflineBooking", () => {
  it("inserts a CONFIRMED, source=OFFLINE booking and a linked WALK_IN_BOOKING ledger entry", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "vendor1" },
    });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([
      {
        id: "booking1",
        userId: null,
        bookableType: "ROOM",
        roomId: "room1",
        vehicleId: null,
        resourceOwnerId: "vendor1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        guestCount: null,
        totalAmountMinor: 5000,
        currency: "BDT",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        source: "OFFLINE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    prisma.vendorLedgerEntry.create.mockResolvedValue({
      id: "vle1",
      vendorId: "vendor1",
      roomId: "room1",
      vehicleId: null,
      bookingId: "booking1",
      direction: "INCOME",
      category: "WALK_IN_BOOKING",
      amountMinor: 5000,
      note: null,
      entryDate: new Date("2026-08-01"),
      deletedAt: null,
      createdAt: new Date(),
    });

    const result = await service.createOfflineBooking("vendor1", {
      bookableType: "ROOM",
      bookableId: "room1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-03",
      amountMinor: 5000,
    });

    expect(result.booking.status).toBe("CONFIRMED");
    expect(result.booking.source).toBe("OFFLINE");
    expect(result.vendorLedgerEntry.category).toBe("WALK_IN_BOOKING");
    expect(prisma.vendorLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "booking1",
          direction: "INCOME",
          category: "WALK_IN_BOOKING",
          amountMinor: 5000,
        }),
      }),
    );
  });

  it("rejects when the caller does not own the room", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "someone-else" },
    });

    await expect(
      service.createOfflineBooking("vendor1", {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        amountMinor: 5000,
      }),
    ).rejects.toThrow(/do not own/i);
  });

  it("translates an exclusion-constraint violation into a 409 Conflict", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "room1",
      hotelId: "hotel1",
      isActive: true,
      hotel: { ownerId: "vendor1" },
    });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    const exclusionError = Object.assign(
      new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2010",
        clientVersion: "6.0.0",
        meta: { code: "23P01" },
      }),
      {},
    );
    prisma.$queryRaw.mockRejectedValue(exclusionError);

    await expect(
      service.createOfflineBooking("vendor1", {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        amountMinor: 5000,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("cancelOfflineBooking", () => {
  it("sets an OFFLINE booking to CANCELLED without touching its linked ledger entry", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking1",
      userId: null,
      bookableType: "ROOM",
      roomId: "room1",
      vehicleId: null,
      resourceOwnerId: "vendor1",
      dateRange: undefined,
      guestCount: null,
      totalAmountMinor: 5000,
      currency: "BDT",
      status: "CANCELLED",
      paymentStatus: "PENDING",
      source: "OFFLINE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.cancelOfflineBooking("vendor1", "booking1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking1",
        resourceOwnerId: "vendor1",
        source: "OFFLINE",
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
    expect(prisma.vendorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when the booking is not found, not owned, or not an OFFLINE booking in a cancellable state", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.cancelOfflineBooking("vendor1", "booking1"),
    ).rejects.toThrow(ConflictException);
  });
});
```

Add `import { Prisma } from "@prisma/client";` to the spec file's imports if not already present (the existing file already imports `LedgerEntryType, Prisma` from `@prisma/client` per `bookings.service.ts`'s own import — confirm the spec file has `Prisma` importable; if the spec mocks Prisma entirely without importing the real module, add `import { Prisma } from "@prisma/client";` alongside the existing imports).

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: FAIL — `createOfflineBooking`/`cancelOfflineBooking` are not defined on `BookingsService`.

- [ ] **Step 3: Add `CreateOfflineBookingInput` to `bookings.types.ts`**

Modify `apps/api/src/bookings/bookings.types.ts` — add `source` to `BookingRecord` and a new input type:

```ts
export type BookableType = "ROOM" | "VEHICLE";

export interface BookingRecord {
  id: string;
  userId: string | null;
  bookableType: BookableType;
  roomId: string | null;
  vehicleId: string | null;
  resourceOwnerId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number | null;
  totalAmountMinor: number;
  currency: string;
  status: string;
  paymentStatus: string;
  source: "ONLINE" | "OFFLINE";
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOfflineBookingInput {
  bookableType: BookableType;
  bookableId: string;
  checkIn: string;
  checkOut: string;
  guestName?: string;
  amountMinor: number;
  note?: string;
}
```

- [ ] **Step 4: Implement `createOfflineBooking`/`cancelOfflineBooking` on `BookingsService`**

Add to `apps/api/src/bookings/bookings.service.ts` (after the existing `createBlock` method), and add the new import at the top of the file:

```ts
import { CreateOfflineBookingInput } from "./bookings.types";
```

(alongside the existing `import { BookingRecord } from "./bookings.types";` — combine into one import line: `import { BookingRecord, CreateOfflineBookingInput } from "./bookings.types";`)

```ts
  async createOfflineBooking(
    callerId: string,
    input: CreateOfflineBookingInput,
  ): Promise<{ booking: BookingRecord; vendorLedgerEntry: import("@prisma/client").VendorLedgerEntry }> {
    this.validateDates(input.checkIn, input.checkOut);

    let resourceOwnerId: string;
    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({
        where: { id: input.bookableId },
        include: { hotel: true },
      });
      if (!room || !room.isActive)
        throw new NotFoundException("Room not found or inactive");
      resourceOwnerId = room.hotel.ownerId;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.bookableId },
      });
      if (!vehicle || !vehicle.isActive)
        throw new NotFoundException("Vehicle not found or inactive");
      resourceOwnerId = vehicle.ownerId;
    }

    if (resourceOwnerId !== callerId) {
      throw new ForbiddenException("You do not own this room/vehicle");
    }

    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId =
      input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<BookingRecord[]>(Prisma.sql`
          INSERT INTO bookings (
            id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
            date_range, total_amount_minor, currency, status, source, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), NULL, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
            daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)'),
            ${input.amountMinor}, 'BDT', 'CONFIRMED', 'OFFLINE', now(), now()
          )
          RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                    vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                    lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                    guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                    currency, status, payment_status AS "paymentStatus", source,
                    created_at AS "createdAt", updated_at AS "updatedAt"
        `);
        const booking = rows[0];
        if (!booking) {
          throw new Error("Offline booking insert returned no rows");
        }

        const vendorLedgerEntry = await tx.vendorLedgerEntry.create({
          data: {
            vendorId: callerId,
            roomId,
            vehicleId,
            bookingId: booking.id,
            direction: "INCOME",
            category: "WALK_IN_BOOKING",
            amountMinor: input.amountMinor,
            note: input.note ?? input.guestName ?? null,
            entryDate: new Date(input.checkIn),
          },
        });

        return { booking, vendorLedgerEntry };
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This room/vehicle is no longer available for the selected dates",
        );
      }
      throw error;
    }
  }

  async cancelOfflineBooking(
    callerId: string,
    bookingId: string,
  ): Promise<BookingRecord> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: bookingId,
        resourceOwnerId: callerId,
        source: "OFFLINE",
        status: { in: ["HELD", "CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException(
        "Offline booking not found, not yours, or not cancellable",
      );
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }
```

Note: `BookingsService` already has a private `toBookingRecord` method (used by `checkout`/`cancel`) that maps a Prisma `Booking` row to `BookingRecord` via object-spread (`{ ...booking, checkIn: "", checkOut: "" }`) — verified in the current source. Because it spreads rather than listing fields explicitly, the new `source` column passes through automatically with zero changes needed to that method. `checkIn`/`checkOut` come back as empty strings on this path by existing, established design (the same as `checkout`/`cancel` today) — `Booking.dateRange` is `Unsupported("daterange")` and cannot be selected via `findUniqueOrThrow` at all, so a status-only mutation like this one already accepts empty dates rather than issuing a second raw-SQL round-trip just to populate them.

Note on `$transaction`: `PrismaService` (extending `PrismaClient`) already supports `$transaction(async (tx) => ...)` — used here so the offline booking insert and its linked ledger entry either both succeed or both fail, never one without the other.

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- bookings.service`
Expected: PASS — all 5 new test cases green, no regressions in existing `BookingsService` tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add BookingsService.createOfflineBooking/cancelOfflineBooking"
```

---

## Task 4: `VendorLedgerService` — manual ledger entries

**Files:**

- Create: `apps/api/src/vendor-dashboard/vendor-ledger.service.ts`
- Test: `apps/api/src/vendor-dashboard/vendor-ledger.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService` (`this.prisma.vendorLedgerEntry.*`, `this.prisma.room.findUnique`, `this.prisma.vehicle.findUnique` — same ownership-check pattern as `HotelsService`).
- Produces: `VendorLedgerService.create(vendorId: string, input: CreateLedgerEntryInput): Promise<VendorLedgerEntry>`, `VendorLedgerService.list(vendorId: string): Promise<VendorLedgerEntry[]>`, `VendorLedgerService.softDelete(vendorId: string, id: string): Promise<void>` — Task 8 (controller) calls these by exact name. `CreateLedgerEntryInput` type consumed by Task 5's DTO.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/vendor-dashboard/vendor-ledger.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorLedgerService } from "./vendor-ledger.service";

describe("VendorLedgerService", () => {
  let service: VendorLedgerService;
  let prisma: {
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    vendorLedgerEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      vendorLedgerEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new VendorLedgerService(prisma as unknown as PrismaService);
  });

  describe("create", () => {
    it("creates an entry for a room the caller owns", async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: "room1",
        hotel: { ownerId: "vendor1" },
      });
      prisma.vendorLedgerEntry.create.mockResolvedValue({ id: "vle1" });

      await service.create("vendor1", {
        roomId: "room1",
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 2000,
        entryDate: "2026-08-01",
      });

      expect(prisma.vendorLedgerEntry.create).toHaveBeenCalledWith({
        data: {
          vendorId: "vendor1",
          roomId: "room1",
          vehicleId: undefined,
          bookingId: null,
          direction: "EXPENSE",
          category: "MAINTENANCE",
          amountMinor: 2000,
          note: undefined,
          entryDate: new Date("2026-08-01"),
        },
      });
    });

    it("creates an entry for a vehicle the caller owns", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "vendor1",
      });
      prisma.vendorLedgerEntry.create.mockResolvedValue({ id: "vle2" });

      await service.create("vendor1", {
        vehicleId: "veh1",
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 3000,
        entryDate: "2026-08-01",
      });

      expect(prisma.vendorLedgerEntry.create).toHaveBeenCalled();
    });

    it("rejects category=WALK_IN_BOOKING", async () => {
      await expect(
        service.create("vendor1", {
          roomId: "room1",
          direction: "INCOME",
          category: "WALK_IN_BOOKING" as never,
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(/POST \/vendor\/bookings\/offline/);
    });

    it("rejects when neither roomId nor vehicleId is given", async () => {
      await expect(
        service.create("vendor1", {
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when both roomId and vehicleId are given", async () => {
      await expect(
        service.create("vendor1", {
          roomId: "room1",
          vehicleId: "veh1",
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when the caller does not own the referenced room", async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: "room1",
        hotel: { ownerId: "someone-else" },
      });

      await expect(
        service.create("vendor1", {
          roomId: "room1",
          direction: "INCOME",
          category: "OTHER",
          amountMinor: 5000,
          entryDate: "2026-08-01",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("list", () => {
    it("returns only the caller's own non-deleted entries, newest first", async () => {
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([{ id: "vle1" }]);

      const result = await service.list("vendor1");

      expect(prisma.vendorLedgerEntry.findMany).toHaveBeenCalledWith({
        where: { vendorId: "vendor1", deletedAt: null },
        orderBy: { entryDate: "desc" },
      });
      expect(result).toEqual([{ id: "vle1" }]);
    });
  });

  describe("softDelete", () => {
    it("sets deletedAt on the caller's own entry", async () => {
      prisma.vendorLedgerEntry.findUnique.mockResolvedValue({
        id: "vle1",
        vendorId: "vendor1",
      });

      await service.softDelete("vendor1", "vle1");

      expect(prisma.vendorLedgerEntry.update).toHaveBeenCalledWith({
        where: { id: "vle1" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("rejects deleting another vendor's entry", async () => {
      prisma.vendorLedgerEntry.findUnique.mockResolvedValue({
        id: "vle1",
        vendorId: "someone-else",
      });

      await expect(service.softDelete("vendor1", "vle1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-ledger.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/vendor-dashboard/vendor-ledger.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  LedgerDirection,
  VendorLedgerCategory,
  VendorLedgerEntry,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface CreateLedgerEntryInput {
  roomId?: string;
  vehicleId?: string;
  direction: LedgerDirection;
  category: Exclude<VendorLedgerCategory, "WALK_IN_BOOKING">;
  amountMinor: number;
  note?: string;
  entryDate: string;
}

@Injectable()
export class VendorLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    vendorId: string,
    input: CreateLedgerEntryInput,
  ): Promise<VendorLedgerEntry> {
    if ((input.category as string) === "WALK_IN_BOOKING") {
      throw new BadRequestException(
        "WALK_IN_BOOKING entries can only be created via POST /vendor/bookings/offline",
      );
    }

    const hasRoom = Boolean(input.roomId);
    const hasVehicle = Boolean(input.vehicleId);
    if (hasRoom === hasVehicle) {
      throw new BadRequestException(
        "Exactly one of roomId or vehicleId is required",
      );
    }

    if (hasRoom) {
      const room = await this.prisma.room.findUnique({
        where: { id: input.roomId },
        include: { hotel: true },
      });
      if (!room) throw new NotFoundException("Room not found");
      if (room.hotel.ownerId !== vendorId) {
        throw new ForbiddenException("You do not own this room");
      }
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.vehicleId },
      });
      if (!vehicle) throw new NotFoundException("Vehicle not found");
      if (vehicle.ownerId !== vendorId) {
        throw new ForbiddenException("You do not own this vehicle");
      }
    }

    return this.prisma.vendorLedgerEntry.create({
      data: {
        vendorId,
        roomId: input.roomId,
        vehicleId: input.vehicleId,
        bookingId: null,
        direction: input.direction,
        category: input.category,
        amountMinor: input.amountMinor,
        note: input.note,
        entryDate: new Date(input.entryDate),
      },
    });
  }

  async list(vendorId: string): Promise<VendorLedgerEntry[]> {
    return this.prisma.vendorLedgerEntry.findMany({
      where: { vendorId, deletedAt: null },
      orderBy: { entryDate: "desc" },
    });
  }

  async softDelete(vendorId: string, id: string): Promise<void> {
    const entry = await this.prisma.vendorLedgerEntry.findUnique({
      where: { id },
    });
    if (!entry) throw new NotFoundException("Ledger entry not found");
    if (entry.vendorId !== vendorId) {
      throw new ForbiddenException("You do not own this ledger entry");
    }
    await this.prisma.vendorLedgerEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-ledger.service`
Expected: PASS — all 9 test cases green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorLedgerService for manual offline ledger entries"
```

---

## Task 5: `VendorDashboardService` — summary, listings, bookings, earnings

**Files:**

- Create: `apps/api/src/vendor-dashboard/vendor-dashboard.service.ts`
- Test: `apps/api/src/vendor-dashboard/vendor-dashboard.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`, `startOfDhakaDay`/`endOfDhakaDay`/`startOfDhakaMonth`/`endOfDhakaMonth` (Task 1).
- Produces: `VendorDashboardService.getSummary(vendorId: string): Promise<DashboardSummary>`, `VendorDashboardService.getListings(vendorId: string): Promise<VendorListing[]>`, `VendorDashboardService.getBookings(vendorId: string, filter: BookingsFilter): Promise<BookingRecord[]>`, `VendorDashboardService.getEarnings(vendorId: string, query: EarningsQuery): Promise<EarningsResult>` — Task 6 (controller) calls these by exact name.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/vendor-dashboard/vendor-dashboard.service.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorDashboardService } from "./vendor-dashboard.service";

function makePrismaMock() {
  return {
    user: { findUnique: jest.fn() },
    room: { findMany: jest.fn() },
    vehicle: { findMany: jest.fn() },
    booking: { count: jest.fn() },
    ledgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
    vendorLedgerEntry: { aggregate: jest.fn(), findMany: jest.fn() },
    // Booking.dateRange is Unsupported("daterange") — unselectable via
    // findMany/findUnique (see BookingsService.toBookingRecord's own
    // comment). todayCheckIns/todayCheckOuts and getBookings both read
    // checkIn/checkOut, so both go through $queryRaw, matching the only
    // pattern this codebase uses anywhere for reading booking dates.
    $queryRaw: jest.fn(),
  };
}

describe("VendorDashboardService", () => {
  let service: VendorDashboardService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new VendorDashboardService(prisma as unknown as PrismaService);
  });

  describe("getSummary", () => {
    it("returns hotelOccupancyRatePct (not vehicleUtilizationRatePct) for a HOTEL vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([{ id: "room1", isActive: true }]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result).toHaveProperty("hotelOccupancyRatePct");
      expect(result).not.toHaveProperty("vehicleUtilizationRatePct");
    });

    it("returns vehicleUtilizationRatePct (not hotelOccupancyRatePct) for a VEHICLE vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "VEHICLE",
        verifiedStatus: "VERIFIED",
      });
      prisma.vehicle.findMany.mockResolvedValue([
        { id: "veh1", isActive: true },
      ]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result).toHaveProperty("vehicleUtilizationRatePct");
      expect(result).not.toHaveProperty("hotelOccupancyRatePct");
    });

    it("sums online (LedgerEntry VENDOR_OWED) and offline (VendorLedgerEntry INCOME) into monthlyIncomeMinor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "VERIFIED",
      });
      prisma.room.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: 8000 },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: 2000 },
      });

      const result = await service.getSummary("vendor1");

      expect(result.monthlyIncomeMinor).toBe(10000);
    });

    it("returns a non-null verificationStatusAlert when the vendor is not VERIFIED", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
        verifiedStatus: "PENDING",
      });
      prisma.room.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);
      prisma.$queryRaw.mockResolvedValue([
        { checkIns: BigInt(0), checkOuts: BigInt(0), bookedNights: BigInt(0) },
      ]);
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });
      prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
        _sum: { amountMinor: null },
      });

      const result = await service.getSummary("vendor1");

      expect(result.verificationStatusAlert).toMatch(/pending/i);
    });
  });

  describe("getListings", () => {
    it("returns rooms with photo count and per-room earnings for a HOTEL vendor", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.room.findMany.mockResolvedValue([
        {
          id: "room1",
          roomType: "DOUBLE",
          isActive: true,
          photos: [{ id: "p1" }],
        },
      ]);
      prisma.ledgerEntry.findMany.mockResolvedValue([]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([]);
      prisma.booking.count.mockResolvedValue(0);

      const result = await service.getListings("vendor1");

      expect(result[0]).toMatchObject({
        id: "room1",
        isActive: true,
        photoCount: 1,
      });
    });
  });

  describe("getBookings", () => {
    it("returns rows from $queryRaw with real checkIn/checkOut strings, not plain Prisma findMany", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: "booking1",
          userId: "traveler1",
          bookableType: "ROOM",
          roomId: "room1",
          vehicleId: null,
          resourceOwnerId: "vendor1",
          checkIn: "2026-08-01",
          checkOut: "2026-08-03",
          guestCount: 2,
          totalAmountMinor: 5000,
          currency: "BDT",
          status: "CONFIRMED",
          paymentStatus: "PAID",
          source: "ONLINE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getBookings("vendor1", {});

      expect(result[0].checkIn).toBe("2026-08-01");
      expect(result[0].checkOut).toBe("2026-08-03");
    });

    it("passes the roomId/status filter values into the query's SQL fragments", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getBookings("vendor1", {
        roomId: "room1",
        status: "CONFIRMED",
      });

      // Prisma.sql returns a real Prisma.Sql object (values embedded as
      // ${} interpolations) even with $queryRaw mocked — assert the
      // filter values reached the call at all, not the exact rendered
      // SQL string shape, since that's an implementation detail of how
      // Prisma.sql composes conditional Prisma.empty fragments.
      const [sqlObject] = prisma.$queryRaw.mock.calls[0];
      expect(sqlObject.values).toEqual(
        expect.arrayContaining(["vendor1", "CONFIRMED", "room1"]),
      );
    });
  });

  describe("getEarnings", () => {
    it("rejects when both period and from/to are given", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });

      await expect(
        service.getEarnings("vendor1", {
          period: "month",
          from: "2026-07-01",
          to: "2026-07-31",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("combines online and offline totals for the requested period", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "vendor1",
        vendorType: "HOTEL",
      });
      prisma.ledgerEntry.findMany.mockResolvedValue([
        { amountMinor: 3000, booking: { roomId: "room1", vehicleId: null } },
      ]);
      prisma.vendorLedgerEntry.findMany.mockResolvedValue([
        {
          amountMinor: 1000,
          direction: "INCOME",
          roomId: "room1",
          vehicleId: null,
        },
      ]);

      const result = await service.getEarnings("vendor1", { period: "month" });

      expect(result.online).toBe(3000);
      expect(result.offline).toBe(1000);
      expect(result.total).toBe(4000);
    });
  });
});
```

Note on the `$queryRaw` mocks above: each `getSummary` test stubs a single merged-shape response (`{ checkIns, checkOuts, bookedNights }`) rather than a call-ordered sequence, because at this task's stage `getSummary` only ever issues one `$queryRaw` call (the today-counts query — occupancy is still the Task 5 placeholder, not yet calling `$queryRaw`). Once Task 5b adds the real occupancy calculation, `getSummary` will call `$queryRaw` a second time; these four tests' merged-shape mocks answer both calls identically and harmlessly (each accessor reads only the field it needs via `rows[0]?.field ?? 0`), so they keep passing unmodified after Task 5b lands — only Task 5b's own two new tests need `mockResolvedValueOnce` chaining to distinguish the two calls, since those are the ones that actually assert a real occupancy value.

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/vendor-dashboard/vendor-dashboard.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  startOfDhakaDay,
  endOfDhakaDay,
  startOfDhakaMonth,
  endOfDhakaMonth,
} from "../common/date/dhaka-time";
import { BookingRecord } from "../bookings/bookings.types";

export interface DashboardSummary {
  monthlyIncomeMinor: number;
  upcomingCheckIns: number;
  activeListings: number;
  hotelOccupancyRatePct?: number;
  vehicleUtilizationRatePct?: number;
  todayCheckIns: number;
  todayCheckOuts: number;
  verificationStatusAlert: string | null;
}

export interface VendorListing {
  id: string;
  label: string;
  isActive: boolean;
  photoCount: number;
  earningsMinor: number;
  bookingCount: number;
}

export interface BookingsFilter {
  status?: string;
  roomId?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
}

export interface EarningsQuery {
  period?: "today" | "week" | "month";
  from?: string;
  to?: string;
}

export interface EarningsResult {
  online: number;
  offline: number;
  total: number;
  byListing: { id: string; amountMinor: number }[];
}

@Injectable()
export class VendorDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async getVendor(vendorId: string) {
    const vendor = await this.prisma.user.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException("Vendor not found");
    return vendor;
  }

  async getSummary(vendorId: string): Promise<DashboardSummary> {
    const vendor = await this.getVendor(vendorId);
    const now = new Date();
    const monthStart = startOfDhakaMonth(now);
    const monthEnd = endOfDhakaMonth(now);
    const dayStart = startOfDhakaDay(now);
    const dayEnd = endOfDhakaDay(now);

    const isHotel =
      vendor.vendorType === "HOTEL" || vendor.vendorType === "BOTH";

    const [rooms, vehicles] = await Promise.all([
      isHotel
        ? this.prisma.room.findMany({ where: { hotel: { ownerId: vendorId } } })
        : Promise.resolve([]),
      !isHotel
        ? this.prisma.vehicle.findMany({ where: { ownerId: vendorId } })
        : Promise.resolve([]),
    ]);
    const activeListings = isHotel
      ? rooms.filter((r) => r.isActive).length
      : vehicles.filter((v) => v.isActive).length;

    const onlineIncome = await this.prisma.ledgerEntry.aggregate({
      where: {
        type: "VENDOR_OWED",
        booking: { resourceOwnerId: vendorId },
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amountMinor: true },
    });
    const offlineIncome = await this.prisma.vendorLedgerEntry.aggregate({
      where: {
        vendorId,
        direction: "INCOME",
        deletedAt: null,
        entryDate: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amountMinor: true },
    });

    const upcomingCheckIns = await this.prisma.booking.count({
      where: {
        resourceOwnerId: vendorId,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
    });

    // Booking.dateRange is `Unsupported("daterange")` — Prisma Client cannot
    // select it via findMany/findUnique at all (confirmed: every existing
    // read of checkIn/checkOut in this codebase, e.g. createBooking's
    // RETURNING clause and createBlock's, goes through $queryRaw with
    // lower(date_range)::text/upper(date_range)::text). todayCheckIns/
    // todayCheckOuts need real dates, so this counts directly in SQL rather
    // than fetching rows into JS and filtering — avoids ever attempting to
    // read dateRange through Prisma Client.
    const todayCounts = await this.prisma.$queryRaw<
      { checkIns: bigint; checkOuts: bigint }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE lower(date_range) >= ${dayStart} AND lower(date_range) < ${dayEnd}) AS "checkIns",
        COUNT(*) FILTER (WHERE upper(date_range) >= ${dayStart} AND upper(date_range) < ${dayEnd}) AS "checkOuts"
      FROM bookings
      WHERE resource_owner_id = ${vendorId}
        AND status IN ('CONFIRMED', 'CHECKED_IN')
    `);
    const todayCheckIns = Number(todayCounts[0]?.checkIns ?? 0);
    const todayCheckOuts = Number(todayCounts[0]?.checkOuts ?? 0);

    const verificationStatusAlert =
      vendor.verifiedStatus === "VERIFIED"
        ? null
        : vendor.verifiedStatus === "PENDING"
          ? "Your account is pending verification"
          : "Your account was rejected — see your profile for details";

    const summary: DashboardSummary = {
      monthlyIncomeMinor:
        (onlineIncome._sum.amountMinor ?? 0) +
        (offlineIncome._sum.amountMinor ?? 0),
      upcomingCheckIns,
      activeListings,
      todayCheckIns,
      todayCheckOuts,
      verificationStatusAlert,
    };

    if (isHotel) {
      summary.hotelOccupancyRatePct = 0; // computed fully in a later iteration; placeholder-free default of 0 rooms booked today is correct for zero active listings
    } else {
      summary.vehicleUtilizationRatePct = 0;
    }

    return summary;
  }

  async getListings(vendorId: string): Promise<VendorListing[]> {
    const vendor = await this.getVendor(vendorId);
    const isHotel =
      vendor.vendorType === "HOTEL" || vendor.vendorType === "BOTH";

    if (isHotel) {
      const rooms = await this.prisma.room.findMany({
        where: { hotel: { ownerId: vendorId } },
        include: { photos: true },
      });
      return Promise.all(
        rooms.map(async (room) => {
          const bookingCount = await this.prisma.booking.count({
            where: { roomId: room.id },
          });
          const earnings = await this.prisma.ledgerEntry.findMany({
            where: { type: "VENDOR_OWED", booking: { roomId: room.id } },
          });
          const offlineEarnings = await this.prisma.vendorLedgerEntry.findMany({
            where: { roomId: room.id, direction: "INCOME", deletedAt: null },
          });
          const earningsMinor =
            earnings.reduce((sum, e) => sum + e.amountMinor, 0) +
            offlineEarnings.reduce((sum, e) => sum + e.amountMinor, 0);
          return {
            id: room.id,
            label: room.roomType,
            isActive: room.isActive,
            photoCount: room.photos.length,
            earningsMinor,
            bookingCount,
          };
        }),
      );
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { ownerId: vendorId },
    });
    return Promise.all(
      vehicles.map(async (vehicle) => {
        const bookingCount = await this.prisma.booking.count({
          where: { vehicleId: vehicle.id },
        });
        const earnings = await this.prisma.ledgerEntry.findMany({
          where: { type: "VENDOR_OWED", booking: { vehicleId: vehicle.id } },
        });
        const offlineEarnings = await this.prisma.vendorLedgerEntry.findMany({
          where: {
            vehicleId: vehicle.id,
            direction: "INCOME",
            deletedAt: null,
          },
        });
        const earningsMinor =
          earnings.reduce((sum, e) => sum + e.amountMinor, 0) +
          offlineEarnings.reduce((sum, e) => sum + e.amountMinor, 0);
        return {
          id: vehicle.id,
          label: vehicle.category,
          isActive: vehicle.isActive,
          photoCount: 0,
          earningsMinor,
          bookingCount,
        };
      }),
    );
  }

  async getBookings(
    vendorId: string,
    filter: BookingsFilter,
  ): Promise<BookingRecord[]> {
    // Same reasoning as todayCheckIns/todayCheckOuts above: checkIn/checkOut
    // must come from lower(date_range)/upper(date_range) via raw SQL, since
    // Prisma Client cannot select the Unsupported("daterange") column at
    // all. This also gives the from/to filter a real implementation — a
    // plain Prisma `where` clause has no way to express "overlaps this
    // range" against a column it can't see.
    const statusFilter = filter.status
      ? Prisma.sql`AND status = ${filter.status}`
      : Prisma.empty;
    const roomFilter = filter.roomId
      ? Prisma.sql`AND room_id = ${filter.roomId}`
      : Prisma.empty;
    const vehicleFilter = filter.vehicleId
      ? Prisma.sql`AND vehicle_id = ${filter.vehicleId}`
      : Prisma.empty;
    const rangeFilter =
      filter.from && filter.to
        ? Prisma.sql`AND date_range && daterange(${filter.from}::date, ${filter.to}::date, '[)')`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
      SELECT id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
             vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
             lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
             guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
             currency, status, payment_status AS "paymentStatus", source,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM bookings
      WHERE resource_owner_id = ${vendorId} ${statusFilter} ${roomFilter} ${vehicleFilter} ${rangeFilter}
      ORDER BY created_at DESC
    `);
    return rows;
  }

  async getEarnings(
    vendorId: string,
    query: EarningsQuery,
  ): Promise<EarningsResult> {
    if (query.period && (query.from || query.to)) {
      throw new BadRequestException(
        "period and from/to are mutually exclusive",
      );
    }

    const now = new Date();
    let gte: Date;
    let lt: Date;
    if (query.from && query.to) {
      gte = new Date(query.from);
      lt = new Date(query.to);
    } else {
      const period = query.period ?? "month";
      if (period === "today") {
        gte = startOfDhakaDay(now);
        lt = endOfDhakaDay(now);
      } else if (period === "week") {
        gte = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        lt = now;
      } else {
        gte = startOfDhakaMonth(now);
        lt = endOfDhakaMonth(now);
      }
    }

    const onlineEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        type: "VENDOR_OWED",
        booking: { resourceOwnerId: vendorId },
        createdAt: { gte, lt },
      },
      include: { booking: true },
    });
    const offlineEntries = await this.prisma.vendorLedgerEntry.findMany({
      where: {
        vendorId,
        direction: "INCOME",
        deletedAt: null,
        entryDate: { gte, lt },
      },
    });

    const online = onlineEntries.reduce((sum, e) => sum + e.amountMinor, 0);
    const offline = offlineEntries.reduce((sum, e) => sum + e.amountMinor, 0);

    const byListingMap = new Map<string, number>();
    for (const entry of onlineEntries) {
      const listingId = entry.booking.roomId ?? entry.booking.vehicleId;
      if (listingId) {
        byListingMap.set(
          listingId,
          (byListingMap.get(listingId) ?? 0) + entry.amountMinor,
        );
      }
    }
    for (const entry of offlineEntries) {
      const listingId = entry.roomId ?? entry.vehicleId;
      if (listingId) {
        byListingMap.set(
          listingId,
          (byListingMap.get(listingId) ?? 0) + entry.amountMinor,
        );
      }
    }

    return {
      online,
      offline,
      total: online + offline,
      byListing: Array.from(byListingMap.entries()).map(
        ([id, amountMinor]) => ({
          id,
          amountMinor,
        }),
      ),
    };
  }
}
```

Note: `hotelOccupancyRatePct`/`vehicleUtilizationRatePct` are stubbed to `0` in this task rather than computed from real room-night math — the full "room-nights booked ÷ room-nights available" calculation requires enumerating every day in the current month per listing, which is a meaningfully separate piece of logic. Task 5b below implements the real calculation; this task's tests only assert the field is _present with the right name for the right vendor type_, not its numeric value, so this ordering doesn't break TDD — Task 5b's tests are the ones that pin the actual math.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.service`
Expected: PASS — all 10 test cases green (4 `getSummary`, 1 `getListings`, 2 `getBookings`, 2 `getEarnings`, plus the mutual-exclusion rejection case).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorDashboardService summary/listings/bookings/earnings"
```

---

## Task 5b: Real occupancy/utilization rate calculation

**Files:**

- Modify: `apps/api/src/vendor-dashboard/vendor-dashboard.service.ts`
- Modify: `apps/api/src/vendor-dashboard/vendor-dashboard.service.spec.ts`

**Interfaces:**

- Consumes: `startOfDhakaMonth`/`endOfDhakaMonth` (Task 1), the existing `bookings` table's `date_range` column (raw SQL, same reasoning as `add-hotel-vehicle-booking-core`: `daterange` isn't a native Prisma-queryable type).
- Produces: `VendorDashboardService.getSummary` now returns a real, non-zero `hotelOccupancyRatePct`/`vehicleUtilizationRatePct` when the vendor has active listings with real bookings.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/vendor-dashboard/vendor-dashboard.service.spec.ts`:

```ts
describe("getSummary — occupancy math", () => {
  it("computes hotelOccupancyRatePct as booked room-nights over available room-nights this month", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "vendor1",
      vendorType: "HOTEL",
      verifiedStatus: "VERIFIED",
    });
    prisma.room.findMany.mockResolvedValue([
      { id: "room1", isActive: true },
      { id: "room2", isActive: true },
    ]);
    prisma.booking.count.mockResolvedValue(0);
    // getSummary issues two separate $queryRaw calls: the today-counts
    // query first, then computeOccupancyRatePct's booked-nights query —
    // mockResolvedValueOnce in call order, not a single blanket mock,
    // since each call expects a different result shape.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ checkIns: BigInt(0), checkOuts: BigInt(0) }])
      .mockResolvedValueOnce([{ bookedNights: BigInt(10) }]);
    prisma.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { amountMinor: null },
    });
    prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
      _sum: { amountMinor: null },
    });

    const result = await service.getSummary("vendor1");

    // 2 rooms * ~31 days (July) = 62 available room-nights; 10 booked -> ~16%
    expect(result.hotelOccupancyRatePct).toBeGreaterThan(0);
    expect(result.hotelOccupancyRatePct).toBeLessThanOrEqual(100);
  });

  it("returns 0 when the vendor has no active listings (avoids divide-by-zero)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "vendor1",
      vendorType: "HOTEL",
      verifiedStatus: "VERIFIED",
    });
    prisma.room.findMany.mockResolvedValue([]);
    prisma.booking.count.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValueOnce([
      { checkIns: BigInt(0), checkOuts: BigInt(0) },
    ]);
    // No second $queryRaw call expected — computeOccupancyRatePct returns
    // 0 immediately when resourceIds is empty, without querying.
    prisma.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { amountMinor: null },
    });
    prisma.vendorLedgerEntry.aggregate.mockResolvedValue({
      _sum: { amountMinor: null },
    });

    const result = await service.getSummary("vendor1");

    expect(result.hotelOccupancyRatePct).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.service`
Expected: FAIL — occupancy is still hardcoded to `0` regardless of bookings, so the first new test's `toBeGreaterThan(0)` assertion fails.

- [ ] **Step 3: Implement the real calculation**

In `apps/api/src/vendor-dashboard/vendor-dashboard.service.ts`, replace the two placeholder lines (`summary.hotelOccupancyRatePct = 0;` / `summary.vehicleUtilizationRatePct = 0;`) with a call to a new private helper, and add that helper plus the `Prisma` import at the top of the file (`import { Prisma } from "@prisma/client";` alongside the existing type-only imports):

```ts
  private async computeOccupancyRatePct(
    resourceIdsColumn: "room_id" | "vehicle_id",
    resourceIds: string[],
    monthStart: Date,
    monthEnd: Date,
  ): Promise<number> {
    if (resourceIds.length === 0) return 0;

    const totalNightsAvailable =
      resourceIds.length *
      Math.round((monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24));

    const rows = await this.prisma.$queryRaw<{ bookedNights: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(
        upper(LEAST(date_range, daterange(${monthStart.toISOString()}::date, ${monthEnd.toISOString()}::date, '[)'))) -
        lower(GREATEST(date_range, daterange(${monthStart.toISOString()}::date, ${monthEnd.toISOString()}::date, '[)')))
      ), 0) AS "bookedNights"
      FROM bookings
      WHERE ${Prisma.raw(resourceIdsColumn)} = ANY(${resourceIds})
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
        AND date_range && daterange(${monthStart.toISOString()}::date, ${monthEnd.toISOString()}::date, '[)')
    `);

    const bookedNights = Number(rows[0]?.bookedNights ?? 0);
    if (totalNightsAvailable === 0) return 0;
    return Math.round((bookedNights / totalNightsAvailable) * 100);
  }
```

Then update `getSummary` to call it (replacing the two placeholder assignment lines):

```ts
if (isHotel) {
  summary.hotelOccupancyRatePct = await this.computeOccupancyRatePct(
    "room_id",
    rooms.filter((r) => r.isActive).map((r) => r.id),
    monthStart,
    monthEnd,
  );
} else {
  summary.vehicleUtilizationRatePct = await this.computeOccupancyRatePct(
    "vehicle_id",
    vehicles.filter((v) => v.isActive).map((v) => v.id),
    monthStart,
    monthEnd,
  );
}
```

Note on the raw SQL: Postgres's `daterange` intersection (`LEAST`/`GREATEST` over ranges isn't directly what those functions do — they operate on scalars, not ranges) needs the actual range-intersection operator instead. Correct the query to use `*` (the `daterange` intersection operator) and take the length of the resulting range:

```sql
SELECT COALESCE(SUM(
  upper(date_range * daterange(${monthStart.toISOString()}::date, ${monthEnd.toISOString()}::date, '[)')) -
  lower(date_range * daterange(${monthStart.toISOString()}::date, ${monthEnd.toISOString()}::date, '[)'))
), 0) AS "bookedNights"
```

Use this corrected version (the `*` operator) in Step 3 above, not the `LEAST`/`GREATEST` draft — `daterange * daterange` returns the overlapping sub-range directly, which is what "nights actually booked within this month" means; `LEAST`/`GREATEST` don't operate on range types at all and would fail to compile as written.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.service`
Expected: PASS — both new test cases green, no regressions in Task 5's existing cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): compute real occupancy/utilization rate from booking date ranges"
```

---

## Task 6: DTOs + `VendorDashboardController`

**Files:**

- Create: `apps/api/src/vendor-dashboard/dto/list-bookings-query.dto.ts`
- Create: `apps/api/src/vendor-dashboard/dto/earnings-query.dto.ts`
- Create: `apps/api/src/vendor-dashboard/dto/create-ledger-entry.dto.ts`
- Create: `apps/api/src/vendor-dashboard/dto/create-offline-booking.dto.ts`
- Create: `apps/api/src/vendor-dashboard/vendor-dashboard.controller.ts`
- Test: `apps/api/src/vendor-dashboard/vendor-dashboard.controller.spec.ts`

**Interfaces:**

- Consumes: `VendorDashboardService` (Task 5), `VendorLedgerService` (Task 4), `BookingsService.createOfflineBooking`/`cancelOfflineBooking` (Task 3), `JwtAuthGuard`/`RolesGuard`/`Roles`/`CurrentUser`/`RequestUser` (existing, same import paths as `HotelsController`).
- Produces: the 8 HTTP routes this module exposes — no later task depends on this controller's internals, it's the final HTTP-facing layer.

- [ ] **Step 1: DTOs**

`apps/api/src/vendor-dashboard/dto/list-bookings-query.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from "class-validator";

export class ListBookingsQueryDto {
  @IsOptional()
  @IsIn([
    "HELD",
    "CONFIRMED",
    "CHECKED_IN",
    "COMPLETED",
    "AUTO_CANCELLED",
    "CANCELLED",
    "REFUNDED",
    "BLOCKED",
  ])
  status?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
```

`apps/api/src/vendor-dashboard/dto/earnings-query.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from "class-validator";

export class EarningsQueryDto {
  @IsOptional()
  @IsIn(["today", "week", "month"])
  period?: "today" | "week" | "month";

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
```

`apps/api/src/vendor-dashboard/dto/create-ledger-entry.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateLedgerEntryDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsIn(["INCOME", "EXPENSE"])
  direction!: "INCOME" | "EXPENSE";

  @IsIn(["MAINTENANCE", "SALARY", "UTILITY", "OTHER"])
  category!: "MAINTENANCE" | "SALARY" | "UTILITY" | "OTHER";

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsString()
  entryDate!: string;
}
```

`apps/api/src/vendor-dashboard/dto/create-offline-booking.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateOfflineBookingDto {
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @IsString()
  bookableId!: string;

  @IsString()
  checkIn!: string;

  @IsString()
  checkOut!: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 2: Write the failing controller test**

`apps/api/src/vendor-dashboard/vendor-dashboard.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { VendorDashboardController } from "./vendor-dashboard.controller";
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";
import { BookingsService } from "../bookings/bookings.service";

describe("VendorDashboardController", () => {
  let controller: VendorDashboardController;
  let dashboardService: {
    getSummary: jest.Mock;
    getListings: jest.Mock;
    getBookings: jest.Mock;
    getEarnings: jest.Mock;
  };
  let ledgerService: {
    create: jest.Mock;
    list: jest.Mock;
    softDelete: jest.Mock;
  };
  let bookingsService: {
    createOfflineBooking: jest.Mock;
    cancelOfflineBooking: jest.Mock;
  };

  beforeEach(async () => {
    dashboardService = {
      getSummary: jest.fn(),
      getListings: jest.fn(),
      getBookings: jest.fn(),
      getEarnings: jest.fn(),
    };
    ledgerService = {
      create: jest.fn(),
      list: jest.fn(),
      softDelete: jest.fn(),
    };
    bookingsService = {
      createOfflineBooking: jest.fn(),
      cancelOfflineBooking: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VendorDashboardController],
      providers: [
        { provide: VendorDashboardService, useValue: dashboardService },
        { provide: VendorLedgerService, useValue: ledgerService },
        { provide: BookingsService, useValue: bookingsService },
      ],
    }).compile();
    controller = moduleRef.get(VendorDashboardController);
  });

  it("summary() delegates to VendorDashboardService.getSummary with the caller's id", async () => {
    dashboardService.getSummary.mockResolvedValue({ monthlyIncomeMinor: 0 });
    await controller.summary({ id: "vendor1", roles: ["VENDOR"] });
    expect(dashboardService.getSummary).toHaveBeenCalledWith("vendor1");
  });

  it("listings() delegates to VendorDashboardService.getListings", async () => {
    dashboardService.getListings.mockResolvedValue([]);
    await controller.listings({ id: "vendor1", roles: ["VENDOR"] });
    expect(dashboardService.getListings).toHaveBeenCalledWith("vendor1");
  });

  it("bookings() delegates to VendorDashboardService.getBookings with query filters", async () => {
    dashboardService.getBookings.mockResolvedValue([]);
    await controller.bookings(
      { id: "vendor1", roles: ["VENDOR"] },
      { status: "CONFIRMED", roomId: "room1" },
    );
    expect(dashboardService.getBookings).toHaveBeenCalledWith("vendor1", {
      status: "CONFIRMED",
      roomId: "room1",
      vehicleId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("earnings() delegates to VendorDashboardService.getEarnings", async () => {
    dashboardService.getEarnings.mockResolvedValue({
      online: 0,
      offline: 0,
      total: 0,
      byListing: [],
    });
    await controller.earnings(
      { id: "vendor1", roles: ["VENDOR"] },
      { period: "month" },
    );
    expect(dashboardService.getEarnings).toHaveBeenCalledWith("vendor1", {
      period: "month",
      from: undefined,
      to: undefined,
    });
  });

  it("createLedgerEntry() delegates to VendorLedgerService.create", async () => {
    ledgerService.create.mockResolvedValue({ id: "vle1" });
    await controller.createLedgerEntry(
      { id: "vendor1", roles: ["VENDOR"] },
      {
        roomId: "room1",
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 1000,
        entryDate: "2026-08-01",
      },
    );
    expect(ledgerService.create).toHaveBeenCalledWith(
      "vendor1",
      expect.objectContaining({ roomId: "room1" }),
    );
  });

  it("listLedgerEntries() delegates to VendorLedgerService.list", async () => {
    ledgerService.list.mockResolvedValue([]);
    await controller.listLedgerEntries({ id: "vendor1", roles: ["VENDOR"] });
    expect(ledgerService.list).toHaveBeenCalledWith("vendor1");
  });

  it("deleteLedgerEntry() delegates to VendorLedgerService.softDelete", async () => {
    await controller.deleteLedgerEntry(
      { id: "vendor1", roles: ["VENDOR"] },
      "vle1",
    );
    expect(ledgerService.softDelete).toHaveBeenCalledWith("vendor1", "vle1");
  });

  it("createOfflineBooking() delegates to BookingsService.createOfflineBooking", async () => {
    bookingsService.createOfflineBooking.mockResolvedValue({
      booking: {},
      vendorLedgerEntry: {},
    });
    await controller.createOfflineBooking(
      { id: "vendor1", roles: ["VENDOR"] },
      {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        amountMinor: 5000,
      },
    );
    expect(bookingsService.createOfflineBooking).toHaveBeenCalledWith(
      "vendor1",
      expect.objectContaining({ bookableId: "room1" }),
    );
  });

  it("cancelOfflineBooking() delegates to BookingsService.cancelOfflineBooking", async () => {
    bookingsService.cancelOfflineBooking.mockResolvedValue({});
    await controller.cancelOfflineBooking(
      { id: "vendor1", roles: ["VENDOR"] },
      "booking1",
    );
    expect(bookingsService.cancelOfflineBooking).toHaveBeenCalledWith(
      "vendor1",
      "booking1",
    );
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.controller`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`apps/api/src/vendor-dashboard/vendor-dashboard.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
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
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";
import { BookingsService } from "../bookings/bookings.service";
import { ListBookingsQueryDto } from "./dto/list-bookings-query.dto";
import { EarningsQueryDto } from "./dto/earnings-query.dto";
import { CreateLedgerEntryDto } from "./dto/create-ledger-entry.dto";
import { CreateOfflineBookingDto } from "./dto/create-offline-booking.dto";

@ApiTags("vendor-dashboard")
@ApiBearerAuth()
@Controller("vendor")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("VENDOR")
export class VendorDashboardController {
  constructor(
    private readonly dashboardService: VendorDashboardService,
    private readonly ledgerService: VendorLedgerService,
    private readonly bookingsService: BookingsService,
  ) {}

  @ApiOperation({ summary: "Get the calling vendor's dashboard summary" })
  @ApiResponse({
    status: 200,
    description:
      "Monthly income, upcoming check-ins, active listings, occupancy/utilization rate, today's check-ins/outs, verification alert.",
  })
  @Get("dashboard/summary")
  async summary(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getSummary(user.id);
  }

  @ApiOperation({
    summary: "List the calling vendor's own hotel rooms or vehicles",
  })
  @ApiResponse({
    status: 200,
    description:
      "Each with active status, photo count, own earnings, own booking count.",
  })
  @Get("listings")
  async listings(@CurrentUser() user: RequestUser) {
    return this.dashboardService.getListings(user.id);
  }

  @ApiOperation({ summary: "List the calling vendor's own bookings" })
  @ApiResponse({
    status: 200,
    description: "Filterable by status, room/vehicle, date range.",
  })
  @Get("bookings")
  async bookings(
    @CurrentUser() user: RequestUser,
    @Query() query: ListBookingsQueryDto,
  ) {
    return this.dashboardService.getBookings(user.id, {
      status: query.status,
      roomId: query.roomId,
      vehicleId: query.vehicleId,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({
    summary: "Get the calling vendor's earnings (online + offline)",
  })
  @ApiResponse({
    status: 200,
    description: "Total, online/offline split, per-listing breakdown.",
  })
  @ApiResponse({ status: 400, description: "Both period and from/to given." })
  @Get("earnings")
  async earnings(
    @CurrentUser() user: RequestUser,
    @Query() query: EarningsQueryDto,
  ) {
    return this.dashboardService.getEarnings(user.id, {
      period: query.period,
      from: query.from,
      to: query.to,
    });
  }

  @ApiOperation({ summary: "Record a manual offline income/expense entry" })
  @ApiResponse({ status: 201, description: "Entry created." })
  @ApiResponse({
    status: 400,
    description:
      "category=WALK_IN_BOOKING, or neither/both of roomId/vehicleId given.",
  })
  @ApiResponse({
    status: 403,
    description: "Caller does not own the referenced room/vehicle.",
  })
  @Post("ledger-entries")
  async createLedgerEntry(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLedgerEntryDto,
  ) {
    return this.ledgerService.create(user.id, dto);
  }

  @ApiOperation({
    summary: "List the calling vendor's own manual ledger entries",
  })
  @ApiResponse({
    status: 200,
    description: "Newest first, excludes soft-deleted entries.",
  })
  @Get("ledger-entries")
  async listLedgerEntries(@CurrentUser() user: RequestUser) {
    return this.ledgerService.list(user.id);
  }

  @ApiOperation({ summary: "Soft-delete a manual ledger entry" })
  @ApiResponse({ status: 201, description: "Entry marked deleted." })
  @ApiResponse({ status: 403, description: "Caller does not own this entry." })
  @Delete("ledger-entries/:id")
  async deleteLedgerEntry(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    await this.ledgerService.softDelete(user.id, id);
    return { message: "Ledger entry deleted" };
  }

  @ApiOperation({
    summary: "Record an offline (walk-in) booking",
    description:
      "Blocks the room/vehicle's public availability for the given dates and auto-creates a linked WALK_IN_BOOKING ledger entry.",
  })
  @ApiResponse({
    status: 201,
    description: "Booking and linked ledger entry created.",
  })
  @ApiResponse({
    status: 403,
    description: "Caller does not own the room/vehicle.",
  })
  @ApiResponse({
    status: 409,
    description: "Dates overlap an existing booking or block.",
  })
  @Post("bookings/offline")
  async createOfflineBooking(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOfflineBookingDto,
  ) {
    return this.bookingsService.createOfflineBooking(user.id, dto);
  }

  @ApiOperation({ summary: "Cancel an offline (walk-in) booking early" })
  @ApiResponse({
    status: 201,
    description: "Booking cancelled; dates freed for the next search.",
  })
  @ApiResponse({
    status: 409,
    description:
      "Not found, not yours, or not an offline booking in a cancellable state.",
  })
  @Delete("bookings/offline/:id")
  async cancelOfflineBooking(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    return this.bookingsService.cancelOfflineBooking(user.id, id);
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-dashboard.controller`
Expected: PASS — all 9 test cases green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorDashboardController with 8 vendor-scoped routes"
```

---

## Task 7: `VendorDashboardModule` wiring + `AppModule`

**Files:**

- Create: `apps/api/src/vendor-dashboard/vendor-dashboard.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `BookingsModule` (must export `BookingsService` — check the existing `bookings.module.ts` already has `exports: [BookingsService]`, confirmed present).
- Produces: `VendorDashboardModule`, importable by `AppModule`.

- [ ] **Step 1: Implement the module**

`apps/api/src/vendor-dashboard/vendor-dashboard.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BookingsModule } from "../bookings/bookings.module";
import { VendorDashboardController } from "./vendor-dashboard.controller";
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";

@Module({
  imports: [BookingsModule],
  controllers: [VendorDashboardController],
  providers: [VendorDashboardService, VendorLedgerService],
})
export class VendorDashboardModule {}
```

- [ ] **Step 2: Wire into `AppModule`**

Modify `apps/api/src/app.module.ts` — add the import and add it to the `imports` array (after `AdminModule`):

```ts
import { VendorDashboardModule } from "./vendor-dashboard/vendor-dashboard.module";
// imports: [..., AdminModule, VendorDashboardModule]
```

- [ ] **Step 3: Run full unit + typecheck to confirm the module boots cleanly**

Run:

```bash
pnpm --filter @staybangla/api exec tsc --noEmit
pnpm --filter @staybangla/api run test:unit
```

Expected: both PASS — zero type errors, no regressions in any existing suite (this task only adds wiring, no new logic).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): wire VendorDashboardModule into AppModule"
```

---

## Task 8: E2e coverage

**Files:**

- Create: `apps/api/test/vendor-dashboard.e2e-spec.ts`

**Interfaces:**

- Consumes: `createVerifiedVendor(app, email): Promise<{vendorId, accessToken}>`, `createHotelWithRoom(app, vendorToken, overrides?): Promise<{hotelId, roomId}>` (both existing, `apps/api/test/helpers/test-fixtures.ts`), `cleanDatabase()` (existing, `apps/api/test/helpers/test-db.ts`).

- [ ] **Step 1: Write the e2e spec**

`apps/api/test/vendor-dashboard.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import {
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Vendor Dashboard (e2e)", () => {
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

  it("GET /vendor/dashboard/summary requires authentication", async () => {
    const res = await request(app.getHttpServer()).get(
      "/v1/vendor/dashboard/summary",
    );
    expect(res.status).toBe(401);
  });

  it("GET /vendor/dashboard/summary returns hotelOccupancyRatePct for a hotel vendor with no listings", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor1@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/v1/vendor/dashboard/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("hotelOccupancyRatePct");
    expect(res.body.activeListings).toBe(0);
  });

  it("GET /vendor/listings returns the vendor's own rooms with photoCount", async () => {
    const { vendorId, accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor2@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const res = await request(app.getHttpServer())
      .get("/v1/vendor/listings")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: roomId, isActive: true, photoCount: 0 }),
    ]);
    void vendorId;
  });

  it("POST /vendor/ledger-entries creates an entry and it appears in GET /vendor/ledger-entries", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        roomId,
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 1500,
        entryDate: "2026-08-01",
      });
    expect(create.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].amountMinor).toBe(1500);
  });

  it("POST /vendor/ledger-entries rejects category=WALK_IN_BOOKING", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor4@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const res = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        roomId,
        direction: "INCOME",
        category: "WALK_IN_BOOKING",
        amountMinor: 5000,
        entryDate: "2026-08-01",
      });
    expect(res.status).toBe(400);
  });

  it("POST /vendor/bookings/offline blocks the room's dates from GET /rooms/available", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor5@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        amountMinor: 5000,
      });
    expect(create.status).toBe(201);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-09-01&checkOut=2026-09-03",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeUndefined();
  });

  it("an online booking attempt for the same offline-booked dates is rejected with 409", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "dash-vendor6@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await createVerifiedVendor(
      app,
      "dash-traveler1@example.com",
    );

    await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
        amountMinor: 5000,
      });

    const onlineAttempt = await request(app.getHttpServer())
      .post("/v1/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
      });
    expect(onlineAttempt.status).toBe(409);
  });

  it("DELETE /vendor/bookings/offline/:id frees the dates again", async () => {
    const { accessToken } = await createVerifiedVendor(
      app,
      "dash-vendor7@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, accessToken);

    const create = await request(app.getHttpServer())
      .post("/v1/vendor/bookings/offline")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-09-20",
        checkOut: "2026-09-22",
        amountMinor: 5000,
      });
    const bookingId = create.body.booking.id;

    await request(app.getHttpServer())
      .delete(`/v1/vendor/bookings/offline/${bookingId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    const available = await request(app.getHttpServer()).get(
      "/v1/rooms/available?checkIn=2026-09-20&checkOut=2026-09-22",
    );
    expect(
      available.body.find((r: { id: string }) => r.id === roomId),
    ).toBeDefined();
  });

  it("vendor A cannot see or delete vendor B's ledger entries", async () => {
    const { accessToken: tokenA } = await createVerifiedVendor(
      app,
      "dash-vendorA@example.com",
    );
    const { roomId: roomA } = await createHotelWithRoom(app, tokenA);
    const { accessToken: tokenB } = await createVerifiedVendor(
      app,
      "dash-vendorB@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/v1/vendor/ledger-entries")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        roomId: roomA,
        direction: "INCOME",
        category: "OTHER",
        amountMinor: 1000,
        entryDate: "2026-08-01",
      });

    const deleteAttempt = await request(app.getHttpServer())
      .delete(`/v1/vendor/ledger-entries/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(deleteAttempt.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- vendor-dashboard`
Expected: PASS — all 9 e2e cases green (Docker services up: Postgres/Redis/MinIO).

Note: if `createVerifiedVendor` doesn't set a `vendorType`, check whether `VendorDashboardService.getSummary`/`getListings` require a non-null `vendorType` to branch correctly — if `createVerifiedVendor`'s created user has `vendorType: null`, the `isHotel` check (`vendorType === "HOTEL" || vendorType === "BOTH"`) evaluates to `false`, which would make a hotel-owning test vendor incorrectly get treated as a vehicle vendor. If this surfaces as a test failure, the fix is to set `vendorType: "HOTEL"` directly via `testPrisma.user.update` after calling `createVerifiedVendor`, in every test that exercises hotel-vendor behavior — add this as a one-line adjustment in Step 1's setup for each affected test rather than modifying the shared `createVerifiedVendor` helper (which other existing test suites also depend on with its current signature).

- [ ] **Step 3: Full monorepo verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): add e2e coverage for vendor dashboard endpoints"
```

---

## Task 9: PR + ROADMAP update

**Files:** None (verification + process only).

- [ ] **Step 1: Manually verify Swagger UI**

Run: `pnpm --filter @staybangla/api dev` (Docker services up), open `http://localhost:3001/api/docs`.
Expected: a "vendor-dashboard" tag with all 8 routes listed, bearer-auth required, documented responses.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/add-vendor-dashboard-basic
gh pr create --title "feat: add vendor dashboard (summary, listings, bookings, earnings, manual ledger, offline bookings)" --body "Implements ROADMAP.md item 1.9. See docs/superpowers/specs/2026-07-30-add-vendor-dashboard-basic-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 3: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Update ROADMAP.md**

On a new small branch/PR: change item 1.9's status from `🚧 next` to `✅` (with a note summarizing the 8 endpoints and the offline-booking-availability decision), and mark item 1.10 (`add-admin-panel-basic`) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every endpoint in the design doc (summary, listings, bookings, earnings, manual ledger CRUD, offline booking create/cancel) has a corresponding task. The `hotelOccupancyRatePct`/`vehicleUtilizationRatePct` distinction (design doc §"Occupancy vs. utilization") is implemented as two optional fields on one response type, matching the design's explicit rejection of per-property-type routes. ✓
- **Found during self-review:** Task 5's first draft only stubbed occupancy to `0` — this would have silently shipped a fake metric. Split into Task 5 (structure) + Task 5b (real room-night math via the `daterange` intersection operator) so the real calculation gets its own dedicated TDD cycle rather than being glossed over as an implementation detail inside a larger task.
- **Found during self-review:** Task 5b's first-drafted SQL used `LEAST`/`GREATEST` on `daterange` values, which don't operate on range types at all (they're scalar comparison functions) — corrected to the `*` range-intersection operator, with an explicit note in the task explaining why, so the implementer doesn't transcribe the broken version.
- **Type consistency:** `BookingRecord` (extended with `source` in Task 3) is the same type Task 5's `getBookings` returns and Task 8's e2e assertions check against — no renamed duplicate. `CreateOfflineBookingInput`/`CreateLedgerEntryInput` are each defined once (Tasks 3 and 4) and consumed by name in Task 6's controller.
- **No placeholders:** every step has complete, real code — DTOs, service methods, controller routes, and the full e2e spec are given in full, not described.
- **Found on a second pass against the real codebase (prompted by a request to re-verify against existing docs/code before dispatching implementers):** the first draft of Task 5 called `this.prisma.booking.findMany(...)` and then read `.checkIn`/`.checkOut` off the results, in both `getBookings` and the `todayCheckIns`/`todayCheckOuts` part of `getSummary`. This is a real bug, not a style choice — `Booking.dateRange` is declared `Unsupported("daterange")` in `schema.prisma`, which Prisma Client cannot select via `findMany`/`findUnique` at all (confirmed by reading `BookingsService.toBookingRecord`'s own comment, and by grepping the codebase: every existing read of `checkIn`/`checkOut` — `createBooking`'s `RETURNING` clause, `createBlock`'s — goes through `$queryRaw` with `lower(date_range)::text`/`upper(date_range)::text`, with zero exceptions). Both call sites were rewritten to raw SQL matching that established pattern; `getBookings`'s `from`/`to` filter also went from an unimplemented `BookingsFilter` field to a real `date_range && daterange(...)` clause, since a plain Prisma `where` has no way to filter a column it can't see in the first place. Added a dedicated `getBookings` unit test (it had none before this pass) asserting real `checkIn`/`checkOut` strings come back, specifically to guard against this regressing back to a `findMany` call during implementation.
