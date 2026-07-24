# Hotel/Vehicle Booking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic, polymorphic booking engine (Hotel/Room + Vehicle) with Postgres-constraint-guaranteed double-booking prevention, a full Held→Confirmed→Checkout/Cancel lifecycle with BullMQ-driven auto-expiry, and CASL-based ownership authorization — the second real domain module in `apps/api`, building directly on the auth module's User/Role/CASL foundation.

**Architecture:** One `Booking` table (`bookableType: ROOM|VEHICLE`) instead of separate per-resource-type tables. Double-booking prevention via a Postgres partial `EXCLUDE USING gist` constraint on `(bookableId, dateRange)` — empirically verified against real concurrent load (10 simultaneous inserts → exactly 1 succeeds) before this plan was written. Every status transition is a single guarded `UPDATE ... WHERE status = X` (via Prisma `updateMany`, checking `count === 1`), making confirm-payment vs. the BullMQ auto-cancel timer race-safe without explicit locking.

**Tech Stack:** `@nestjs/bullmq@^11.0.0` + `bullmq@^5.0.0` (new — confirmed peer-compatible with our `@nestjs/common@^11.0.0`), Prisma raw SQL (`$queryRaw`/`$executeRaw`) for the two operations that touch the `Unsupported("daterange")` column (booking creation, availability search) — everything else uses normal Prisma Client.

## Global Constraints

- Follow existing conventions exactly: kebab-case files, `<name>.controller.ts`/`.service.ts`/`.module.ts`, constructor DI, relative imports, DTOs with class-validator.
- Design source of truth: `docs/superpowers/specs/2026-07-25-hotel-vehicle-booking-core-design.md` — read it before starting if anything below is ambiguous.
- Room/Vehicle = one physical unit per row (not room-type + quantity pool) — this is what makes the EXCLUDE constraint correct. A vendor adds N rows for N physical units of the same type.
- Only `verifiedStatus === VERIFIED` vendors may create Hotel/Room/Vehicle.
- Money = integer minor units (`*Minor` fields) + `currency` string, matching the existing money/i18n decision. `totalAmountMinor` is snapshotted at booking creation, never recomputed from live prices later.
- `resourceOwnerId` is denormalized onto `Booking` at creation time (copied from the Room/Vehicle's `ownerId`) specifically so ownership checks (checkout, block) are a plain field comparison, not a join.
- Soft-delete only for Room/Vehicle (`isActive` boolean) — never hard-delete a row with booking history.
- Every status-changing operation (`confirmPayment`, `checkout`, `cancel`) is a guarded `prisma.booking.updateMany({ where: { id, status: <expected> }, data: { status: <next> } })`, checked via `result.count === 1`. This is what makes concurrent operations race-safe — never use `update()` (which requires a unique-only `where` and can't express the guard).
- Every task ends green on `pnpm --filter @staybangla/api run test:unit` and/or `test:e2e` before moving on. Docker services (`infra/docker/docker-compose.yml`) must be running.
- Branch protection is active on `main` — every task's commits land on the feature branch; PR + green CI required before merge (same as the auth module).

---

## File Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma                                    [MODIFY: +Hotel,+Room,+Vehicle,+Booking,+enums]
│   └── migrations/<ts>_add_booking_core/                [NEW]
├── src/
│   ├── config/env.validation.ts                         [MODIFY: +BOOKING_HOLD_MINUTES]
│   ├── common/payments/
│   │   ├── payment-provider.port.ts                     [NEW]
│   │   ├── stub-payment-provider.service.ts(+.spec)      [NEW]
│   │   └── payments.module.ts                           [NEW]
│   ├── hotels/
│   │   ├── hotels.module.ts
│   │   ├── hotels.service.ts(+.spec), hotels.controller.ts(+.spec)
│   │   ├── rooms.service.ts(+.spec), rooms.controller.ts(+.spec)
│   │   └── dto/{create-hotel,create-room,update-room}.dto.ts
│   ├── vehicles/
│   │   ├── vehicles.module.ts
│   │   ├── vehicles.service.ts(+.spec), vehicles.controller.ts(+.spec)
│   │   └── dto/{create-vehicle,update-vehicle}.dto.ts
│   ├── bookings/
│   │   ├── bookings.module.ts
│   │   ├── bookings.service.ts(+.spec)
│   │   ├── bookings.controller.ts(+.spec)
│   │   ├── bookings.types.ts
│   │   ├── queue/booking-expiry.processor.ts(+.spec)
│   │   └── dto/{create-booking,create-block}.dto.ts
│   └── casl/casl-ability.factory.ts                      [MODIFY: +Hotel,+Vehicle,+Booking subjects]
└── test/
    ├── helpers/test-fixtures.ts                          [NEW]
    ├── booking-concurrency.e2e-spec.ts
    ├── booking-lifecycle.e2e-spec.ts
    └── booking-ownership.e2e-spec.ts
```

---

## Task 1: Env schema extension (`BOOKING_HOLD_MINUTES`)

**Files:** Modify `apps/api/src/config/env.validation.ts`, `apps/api/src/config/env.validation.spec.ts`, `apps/api/.env`, `apps/api/.env.example`, `apps/api/.env.test`, root `.env.example`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/config/env.validation.spec.ts`:

```ts
it("applies the booking hold-timer default when not provided", () => {
  const result = validateEnv({ ...REQUIRED_BASE });
  expect(result.BOOKING_HOLD_MINUTES).toBe(15);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `BOOKING_HOLD_MINUTES` undefined.

- [ ] **Step 3: Implement**

In `apps/api/src/config/env.validation.ts`, add to the schema object:

```ts
  BOOKING_HOLD_MINUTES: z.coerce.number().int().positive().default(15),
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 5: Update env files**

Append `BOOKING_HOLD_MINUTES=15` to `apps/api/.env`, `apps/api/.env.example`, `apps/api/.env.test`, root `.env.example`.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/hotel-vehicle-booking-core
git add apps/api/src/config apps/api/.env.example .env.example
git commit -m "feat(api): add BOOKING_HOLD_MINUTES env config"
```

(`.env`/`.env.test` are gitignored — not part of the commit, edited locally only.)

---

## Task 2: `shared-types` — add `BLOCKED` to `BookingStatus`

**Files:** Modify `packages/shared-types/src/enums.ts`, `packages/shared-types/src/enums.spec.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared-types/src/enums.spec.ts` (inside the `describe("shared enums", ...)` block):

```ts
it("BookingStatus includes BLOCKED for vendor-created maintenance entries", () => {
  expect(BookingStatus.BLOCKED).toBe("BLOCKED");
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/shared-types test`
Expected: FAIL — `BookingStatus.BLOCKED` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/shared-types/src/enums.ts`, add to the `BookingStatus` enum:

```ts
  BLOCKED = "BLOCKED",
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/shared-types test`
Expected: PASS.

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @staybangla/shared-types build
git add packages/shared-types
git commit -m "feat(shared-types): add BLOCKED to BookingStatus for vendor blackout entries"
```

---

## Task 3: Prisma schema — Hotel, Room, Vehicle, Booking + migration

**Files:** Modify `apps/api/prisma/schema.prisma`; create migration.

- [ ] **Step 1: Extend `schema.prisma`**

Append (after the existing auth-module models, `HealthCheck` and auth models untouched):

```prisma
enum BookableType {
  ROOM
  VEHICLE
}

enum VehicleCategory {
  CNG
  JEEP
  BOAT
}

enum BookingStatus {
  HELD
  CONFIRMED
  CHECKED_IN
  COMPLETED
  AUTO_CANCELLED
  CANCELLED
  REFUNDED
  BLOCKED
}

model Hotel {
  id          String   @id @default(uuid())
  ownerId     String   @map("owner_id")
  name        String
  city        String
  address     String
  description String?
  amenities   String[]
  starRating  Int?     @map("star_rating")
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  owner User   @relation(fields: [ownerId], references: [id])
  rooms Room[]

  @@map("hotels")
}

model Room {
  id                 String   @id @default(uuid())
  hotelId            String   @map("hotel_id")
  roomType           String   @map("room_type")
  pricePerNightMinor Int      @map("price_per_night_minor")
  currency           String   @default("BDT")
  capacity           Int
  isActive           Boolean  @default(true) @map("is_active")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  hotel Hotel @relation(fields: [hotelId], references: [id])

  @@map("rooms")
}

model Vehicle {
  id               String          @id @default(uuid())
  ownerId          String          @map("owner_id")
  category         VehicleCategory
  city             String
  model            String?
  capacity         Int
  pricePerDayMinor Int             @map("price_per_day_minor")
  currency         String          @default("BDT")
  isActive         Boolean         @default(true) @map("is_active")
  createdAt        DateTime        @default(now()) @map("created_at")
  updatedAt        DateTime        @updatedAt @map("updated_at")

  owner User @relation(fields: [ownerId], references: [id])

  @@map("vehicles")
}

model Booking {
  id               String        @id @default(uuid())
  userId           String?       @map("user_id")
  bookableType     BookableType  @map("bookable_type")
  roomId           String?       @map("room_id")
  vehicleId        String?       @map("vehicle_id")
  resourceOwnerId  String        @map("resource_owner_id")
  dateRange        Unsupported("daterange") @map("date_range")
  guestCount       Int?          @map("guest_count")
  totalAmountMinor Int           @map("total_amount_minor")
  currency         String        @default("BDT")
  status           BookingStatus @default(HELD)
  createdAt        DateTime      @default(now()) @map("created_at")
  updatedAt        DateTime      @updatedAt @map("updated_at")

  @@map("bookings")
}
```

Also add back-relations on `User` (find the existing `model User` block in `schema.prisma` and add these two lines inside it, alongside `roles`/`refreshTokens`):

```prisma
  ownedHotels   Hotel[]
  ownedVehicles Vehicle[]
```

- [ ] **Step 2: Generate migration SQL without applying**

```bash
pnpm --filter @staybangla/api exec prisma migrate dev --name add_booking_core --create-only
```

- [ ] **Step 3: Append raw-SQL constraints to the generated migration**

At the end of the new `apps/api/prisma/migrations/<timestamp>_add_booking_core/migration.sql`:

```sql
-- Exactly one of room_id/vehicle_id set, matching bookable_type
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookable_consistency_check"
  CHECK (
    (bookable_type = 'ROOM' AND room_id IS NOT NULL AND vehicle_id IS NULL) OR
    (bookable_type = 'VEHICLE' AND vehicle_id IS NOT NULL AND room_id IS NULL)
  );

-- The core double-booking guard (empirically verified: 10 concurrent inserts -> exactly 1 succeeds)
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

CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");
CREATE INDEX "bookings_resource_owner_id_idx" ON "bookings"("resource_owner_id");
```

- [ ] **Step 4: Apply migration and regenerate client**

```bash
pnpm --filter @staybangla/api exec prisma migrate dev
pnpm --filter @staybangla/api exec prisma generate
```

- [ ] **Step 5: Verify the constraints exist**

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d bookings"
```

Expected: output includes `bookings_room_no_overlap` and `bookings_vehicle_no_overlap` under "Indexes" (exclusion constraints are implemented as indexes in Postgres), plus the `bookings_bookable_consistency_check` under "Check constraints".

- [ ] **Step 6: Also migrate the test database**

```bash
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add Hotel/Room/Vehicle/Booking schema with double-booking-proof migration"
```

---

## Task 4: PaymentProviderPort + stub

**Files:** Create `apps/api/src/common/payments/{payment-provider.port.ts, stub-payment-provider.service.ts(+.spec), payments.module.ts}`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/common/payments/stub-payment-provider.service.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import { StubPaymentProviderService } from "./stub-payment-provider.service";

describe("StubPaymentProviderService", () => {
  it("always resolves success and logs instead of calling a real gateway", async () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    const service = new StubPaymentProviderService();

    const result = await service.charge("booking-1", 150000, "BDT");

    expect(result).toEqual({ success: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("booking-1"));
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `Cannot find module './stub-payment-provider.service'`.

- [ ] **Step 3: Implement**

`apps/api/src/common/payments/payment-provider.port.ts`:

```ts
export interface ChargeResult {
  success: boolean;
}

export abstract class PaymentProviderPort {
  abstract charge(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ChargeResult>;
}
```

`apps/api/src/common/payments/stub-payment-provider.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { ChargeResult, PaymentProviderPort } from "./payment-provider.port";

@Injectable()
export class StubPaymentProviderService implements PaymentProviderPort {
  private readonly logger = new Logger(StubPaymentProviderService.name);

  async charge(
    bookingId: string,
    amountMinor: number,
    currency: string,
  ): Promise<ChargeResult> {
    this.logger.log(
      `[stub payment] booking=${bookingId} amount=${amountMinor} ${currency} -> success`,
    );
    return { success: true };
  }
}
```

`apps/api/src/common/payments/payments.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PaymentProviderPort } from "./payment-provider.port";
import { StubPaymentProviderService } from "./stub-payment-provider.service";

@Module({
  providers: [
    { provide: PaymentProviderPort, useClass: StubPaymentProviderService },
  ],
  exports: [PaymentProviderPort],
})
export class PaymentsModule {}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add PaymentProviderPort with a stub implementation"
```

---

## Task 5: HotelsService + HotelsModule

**Files:** Create `apps/api/src/hotels/{hotels.module.ts, hotels.service.ts(+.spec)}`, `apps/api/src/hotels/dto/create-hotel.dto.ts`.

**Interfaces:**

- Consumes: `PrismaService` (existing), `UsersService.findById(id): Promise<User | null>` (existing, from auth module).
- Produces: `HotelsService.create(ownerId: string, input: CreateHotelInput): Promise<Hotel>` — throws `ForbiddenException` if owner isn't `VERIFIED`. `HotelsService.findByIdOrThrow(id: string): Promise<Hotel>` — throws `NotFoundException`.

- [ ] **Step 1: DTO**

`apps/api/src/hotels/dto/create-hotel.dto.ts`:

```ts
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class CreateHotelDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/hotels/hotels.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { HotelsService } from "./hotels.service";

describe("HotelsService", () => {
  let prisma: { hotel: { create: jest.Mock; findUnique: jest.Mock } };
  let usersService: { findById: jest.Mock };
  let service: HotelsService;

  beforeEach(() => {
    prisma = { hotel: { create: jest.fn(), findUnique: jest.fn() } };
    usersService = { findById: jest.fn() };
    service = new HotelsService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  describe("create", () => {
    it("creates a hotel when the owner is a VERIFIED vendor", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      prisma.hotel.create.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
        name: "Test Hotel",
      });

      const result = await service.create("v1", {
        name: "Test Hotel",
        city: "Dhaka",
        address: "123 Rd",
      });

      expect(prisma.hotel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: "v1", name: "Test Hotel" }),
        }),
      );
      expect(result.id).toBe("h1");
    });

    it("rejects when the owner is PENDING (not yet verified)", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      await expect(
        service.create("v1", {
          name: "Test Hotel",
          city: "Dhaka",
          address: "123 Rd",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.hotel.create).not.toHaveBeenCalled();
    });

    it("rejects when the owner does not exist", async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(
        service.create("nope", {
          name: "Test Hotel",
          city: "Dhaka",
          address: "123 Rd",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("findByIdOrThrow", () => {
    it("returns the hotel when found", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1" });
      await expect(service.findByIdOrThrow("h1")).resolves.toEqual({
        id: "h1",
      });
    });

    it("throws NotFoundException when missing", async () => {
      prisma.hotel.findUnique.mockResolvedValue(null);
      await expect(service.findByIdOrThrow("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `Cannot find module './hotels.service'`.

- [ ] **Step 4: Implement**

`apps/api/src/hotels/hotels.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Hotel } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

export interface CreateHotelInput {
  name: string;
  city: string;
  address: string;
  description?: string;
  amenities?: string[];
  starRating?: number;
}

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  private async assertVerifiedVendor(ownerId: string): Promise<void> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
  }

  async create(ownerId: string, input: CreateHotelInput): Promise<Hotel> {
    await this.assertVerifiedVendor(ownerId);
    return this.prisma.hotel.create({ data: { ownerId, ...input } });
  }

  async findByIdOrThrow(id: string): Promise<Hotel> {
    const hotel = await this.prisma.hotel.findUnique({ where: { id } });
    if (!hotel) throw new NotFoundException("Hotel not found");
    return hotel;
  }
}
```

`apps/api/src/hotels/hotels.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";

@Module({
  imports: [UsersModule],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add HotelsService with verified-vendor-only creation"
```

---

## Task 6: HotelsController

**Files:** Create `apps/api/src/hotels/hotels.controller.ts(+.spec)`. Modify `apps/api/src/hotels/hotels.module.ts`.

**Interfaces:**

- Consumes: `HotelsService.create`, `Role.VENDOR` from `@prisma/client`, `JwtAuthGuard`/`RolesGuard`/`@Roles`/`@CurrentUser` (existing, from auth module).

- [ ] **Step 1: Write the failing test**

`apps/api/src/hotels/hotels.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { HotelsController } from "./hotels.controller";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("HotelsController", () => {
  let controller: HotelsController;
  let hotelsService: { create: jest.Mock };

  beforeEach(async () => {
    hotelsService = { create: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [HotelsController],
      providers: [{ provide: HotelsService, useValue: hotelsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(HotelsController);
  });

  it("create() delegates to HotelsService.create with the current user's id", async () => {
    hotelsService.create.mockResolvedValue({ id: "h1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      { name: "Test Hotel", city: "Dhaka", address: "123 Rd" },
    );
    expect(hotelsService.create).toHaveBeenCalledWith("v1", {
      name: "Test Hotel",
      city: "Dhaka",
      address: "123 Rd",
    });
    expect(result).toEqual({ id: "h1" });
  });
});
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/hotels/hotels.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Hotel } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { HotelsService } from "./hotels.service";
import { CreateHotelDto } from "./dto/create-hotel.dto";

@Controller("hotels")
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateHotelDto,
  ): Promise<Hotel> {
    return this.hotelsService.create(user.id, dto);
  }
}
```

- [ ] **Step 4: Wire into `HotelsModule`**

`apps/api/src/hotels/hotels.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";

@Module({
  imports: [UsersModule],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
```

- [ ] **Step 5: Run to confirm pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add POST /hotels for verified vendors"
```

---

## Task 7: RoomsService (create under a hotel, soft-delete, ownership)

**Files:** Create `apps/api/src/hotels/rooms.service.ts(+.spec)`, `apps/api/src/hotels/dto/{create-room,update-room}.dto.ts`.

**Interfaces:**

- Consumes: `HotelsService.findByIdOrThrow`.
- Produces: `RoomsService.create(callerId: string, hotelId: string, input: CreateRoomInput): Promise<Room>` (throws `ForbiddenException` if `callerId !== hotel.ownerId`). `RoomsService.update(callerId, roomId, input: UpdateRoomInput): Promise<Room>`.

- [ ] **Step 1: DTOs**

`apps/api/src/hotels/dto/create-room.dto.ts`:

```ts
import { IsInt, IsNotEmpty, IsString, Min } from "class-validator";

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  roomType!: string;

  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @IsInt()
  @Min(1)
  capacity!: number;
}
```

`apps/api/src/hotels/dto/update-room.dto.ts`:

```ts
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class UpdateRoomDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerNightMinor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/hotels/rooms.service.spec.ts`:

```ts
import { ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";
import { RoomsService } from "./rooms.service";

describe("RoomsService", () => {
  let prisma: {
    room: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  };
  let hotelsService: { findByIdOrThrow: jest.Mock };
  let service: RoomsService;

  beforeEach(() => {
    prisma = {
      room: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    };
    hotelsService = { findByIdOrThrow: jest.fn() };
    service = new RoomsService(
      prisma as unknown as PrismaService,
      hotelsService as unknown as HotelsService,
    );
  });

  describe("create", () => {
    it("creates a room when the caller owns the hotel", async () => {
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.room.create.mockResolvedValue({ id: "r1", hotelId: "h1" });

      const result = await service.create("v1", "h1", {
        roomType: "DOUBLE",
        pricePerNightMinor: 500000,
        capacity: 2,
      });

      expect(prisma.room.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hotelId: "h1", roomType: "DOUBLE" }),
        }),
      );
      expect(result.id).toBe("r1");
    });

    it("rejects when the caller does not own the hotel", async () => {
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.create("v1", "h1", {
          roomType: "DOUBLE",
          pricePerNightMinor: 500000,
          capacity: 2,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.room.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("updates a room when the caller owns the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "v1",
      });
      prisma.room.update.mockResolvedValue({ id: "r1", isActive: false });

      const result = await service.update("v1", "r1", { isActive: false });

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });

    it("rejects when the caller does not own the parent hotel", async () => {
      prisma.room.findUnique.mockResolvedValue({ id: "r1", hotelId: "h1" });
      hotelsService.findByIdOrThrow.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.update("v1", "r1", { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail** → FAIL.

- [ ] **Step 4: Implement**

`apps/api/src/hotels/rooms.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Room } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { HotelsService } from "./hotels.service";

export interface CreateRoomInput {
  roomType: string;
  pricePerNightMinor: number;
  capacity: number;
}

export interface UpdateRoomInput {
  pricePerNightMinor?: number;
  isActive?: boolean;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hotelsService: HotelsService,
  ) {}

  async create(
    callerId: string,
    hotelId: string,
    input: CreateRoomInput,
  ): Promise<Room> {
    const hotel = await this.hotelsService.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return this.prisma.room.create({ data: { hotelId, ...input } });
  }

  async update(
    callerId: string,
    roomId: string,
    input: UpdateRoomInput,
  ): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Room not found");

    const hotel = await this.hotelsService.findByIdOrThrow(room.hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return this.prisma.room.update({ where: { id: roomId }, data: input });
  }
}
```

- [ ] **Step 5: Run to confirm pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add RoomsService with hotel-ownership checks"
```

---

## Task 8: RoomsController + availability search

**Files:** Create `apps/api/src/hotels/rooms.controller.ts(+.spec)`. Modify `hotels.service.ts` (add `searchAvailable`), `hotels.module.ts`.

**Interfaces:**

- Produces: `HotelsService.searchAvailableRooms(checkIn: string, checkOut: string, city?: string): Promise<RoomAvailability[]>` where `RoomAvailability = { id: string; hotelId: string; roomType: string; pricePerNightMinor: number; currency: string; capacity: number }`.

- [ ] **Step 1: Write the failing test for availability search**

Append to `apps/api/src/hotels/hotels.service.spec.ts`:

```ts
describe("searchAvailableRooms", () => {
  it("delegates to a raw query with the given date range and optional city", async () => {
    (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
      .fn()
      .mockResolvedValue([
        {
          id: "r1",
          hotelId: "h1",
          roomType: "DOUBLE",
          pricePerNightMinor: 500000,
          currency: "BDT",
          capacity: 2,
        },
      ]);
    const results = await service.searchAvailableRooms(
      "2026-09-01",
      "2026-09-03",
      "Dhaka",
    );
    expect(results).toHaveLength(1);
    expect(results[0].roomType).toBe("DOUBLE");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `service.searchAvailableRooms is not a function`.

- [ ] **Step 3: Implement — add to `HotelsService`**

Add to `apps/api/src/hotels/hotels.service.ts` (new imports: `Prisma` from `@prisma/client`):

```ts
import { Prisma } from "@prisma/client";
```

And the method, inside the `HotelsService` class:

```ts
  async searchAvailableRooms(checkIn: string, checkOut: string, city?: string): Promise<RoomAvailability[]> {
    const cityFilter = city ? Prisma.sql`AND h.city = ${city}` : Prisma.empty;
    return this.prisma.$queryRaw<RoomAvailability[]>(Prisma.sql`
      SELECT r.id, r.hotel_id AS "hotelId", r.room_type AS "roomType",
             r.price_per_night_minor AS "pricePerNightMinor", r.currency, r.capacity
      FROM rooms r
      JOIN hotels h ON h.id = r.hotel_id
      WHERE r.is_active = true AND h.is_active = true ${cityFilter}
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
        )
    `);
  }
```

Add the exported type above the class:

```ts
export interface RoomAvailability {
  id: string;
  hotelId: string;
  roomType: string;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 5: Write failing controller test**

`apps/api/src/hotels/rooms.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { HotelsService } from "./hotels.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("RoomsController", () => {
  let controller: RoomsController;
  let roomsService: { create: jest.Mock; update: jest.Mock };
  let hotelsService: { searchAvailableRooms: jest.Mock };

  beforeEach(async () => {
    roomsService = { create: jest.fn(), update: jest.fn() };
    hotelsService = { searchAvailableRooms: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        { provide: RoomsService, useValue: roomsService },
        { provide: HotelsService, useValue: hotelsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(RoomsController);
  });

  it("available() delegates to HotelsService.searchAvailableRooms", async () => {
    hotelsService.searchAvailableRooms.mockResolvedValue([{ id: "r1" }]);
    const result = await controller.available(
      "2026-09-01",
      "2026-09-03",
      "Dhaka",
    );
    expect(hotelsService.searchAvailableRooms).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-03",
      "Dhaka",
    );
    expect(result).toEqual([{ id: "r1" }]);
  });

  it("create() delegates to RoomsService.create with the caller's id and hotel id", async () => {
    roomsService.create.mockResolvedValue({ id: "r1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      "h1",
      { roomType: "DOUBLE", pricePerNightMinor: 500000, capacity: 2 },
    );
    expect(roomsService.create).toHaveBeenCalledWith("v1", "h1", {
      roomType: "DOUBLE",
      pricePerNightMinor: 500000,
      capacity: 2,
    });
    expect(result).toEqual({ id: "r1" });
  });

  it("update() delegates to RoomsService.update with the caller's id and room id", async () => {
    roomsService.update.mockResolvedValue({ id: "r1", isActive: false });
    const result = await controller.update(
      { id: "v1", roles: ["VENDOR"] },
      "r1",
      { isActive: false },
    );
    expect(roomsService.update).toHaveBeenCalledWith("v1", "r1", {
      isActive: false,
    });
    expect(result).toEqual({ id: "r1", isActive: false });
  });
});
```

- [ ] **Step 6: Run to confirm fail** → FAIL (module not found).

- [ ] **Step 7: Implement `RoomsController`**

`apps/api/src/hotels/rooms.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Room } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { RoomsService } from "./rooms.service";
import { HotelsService, RoomAvailability } from "./hotels.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";

@Controller()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @Get("rooms/available")
  async available(
    @Query("checkIn") checkIn: string,
    @Query("checkOut") checkOut: string,
    @Query("city") city?: string,
  ): Promise<RoomAvailability[]> {
    return this.hotelsService.searchAvailableRooms(checkIn, checkOut, city);
  }

  @Post("hotels/:hotelId/rooms")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("hotelId") hotelId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<Room> {
    return this.roomsService.create(user.id, hotelId, dto);
  }

  @Patch("rooms/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<Room> {
    return this.roomsService.update(user.id, id, dto);
  }
}
```

- [ ] **Step 8: Wire into `HotelsModule`**

`apps/api/src/hotels/hotels.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";
import { RoomsService } from "./rooms.service";
import { RoomsController } from "./rooms.controller";

@Module({
  imports: [UsersModule],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService, RoomsService],
})
export class HotelsModule {}
```

- [ ] **Step 9: Run to confirm pass** → PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add RoomsController and raw-SQL room availability search"
```

---

## Task 9: VehiclesService + VehiclesController + availability search

**Files:** Create `apps/api/src/vehicles/{vehicles.module.ts, vehicles.service.ts(+.spec), vehicles.controller.ts(+.spec)}`, `apps/api/src/vehicles/dto/{create-vehicle,update-vehicle}.dto.ts`.

This mirrors Tasks 5+6+8 exactly (Hotel→Room pattern collapsed to one level since a Vehicle has no parent, unlike Room/Hotel).

- [ ] **Step 1: DTOs**

`apps/api/src/vehicles/dto/create-vehicle.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateVehicleDto {
  @IsIn(["CNG", "JEEP", "BOAT"])
  category!: "CNG" | "JEEP" | "BOAT";

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsInt()
  @Min(1)
  pricePerDayMinor!: number;
}
```

`apps/api/src/vehicles/dto/update-vehicle.dto.ts`:

```ts
import { IsBoolean, IsInt, IsOptional, Min } from "class-validator";

export class UpdateVehicleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerDayMinor?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/vehicles/vehicles.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { VehiclesService } from "./vehicles.service";

describe("VehiclesService", () => {
  let prisma: {
    vehicle: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let usersService: { findById: jest.Mock };
  let service: VehiclesService;

  beforeEach(() => {
    prisma = {
      vehicle: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    usersService = { findById: jest.fn() };
    service = new VehiclesService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  describe("create", () => {
    it("creates a vehicle when the owner is VERIFIED", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      prisma.vehicle.create.mockResolvedValue({ id: "veh1", ownerId: "v1" });

      const result = await service.create("v1", {
        category: "CNG",
        city: "Dhaka",
        capacity: 3,
        pricePerDayMinor: 200000,
      });

      expect(prisma.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: "v1", category: "CNG" }),
        }),
      );
      expect(result.id).toBe("veh1");
    });

    it("rejects an unverified owner", async () => {
      usersService.findById.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      await expect(
        service.create("v1", {
          category: "CNG",
          city: "Dhaka",
          capacity: 3,
          pricePerDayMinor: 200000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("update", () => {
    it("updates when the caller owns the vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "v1",
      });
      prisma.vehicle.update.mockResolvedValue({ id: "veh1", isActive: false });
      const result = await service.update("v1", "veh1", { isActive: false });
      expect(result.isActive).toBe(false);
    });

    it("rejects when the caller does not own the vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue({
        id: "veh1",
        ownerId: "someone-else",
      });
      await expect(
        service.update("v1", "veh1", { isActive: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException for a missing vehicle", async () => {
      prisma.vehicle.findUnique.mockResolvedValue(null);
      await expect(
        service.update("v1", "missing", { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("searchAvailable", () => {
    it("delegates to a raw query for the given date and city", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: "veh1", category: "CNG", city: "Dhaka" },
      ]);
      const results = await service.searchAvailable(
        "2026-09-01",
        "2026-09-02",
        "Dhaka",
      );
      expect(results).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail** → FAIL.

- [ ] **Step 4: Implement `VehiclesService`**

`apps/api/src/vehicles/vehicles.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Vehicle } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

export interface CreateVehicleInput {
  category: "CNG" | "JEEP" | "BOAT";
  city: string;
  model?: string;
  capacity: number;
  pricePerDayMinor: number;
}

export interface UpdateVehicleInput {
  pricePerDayMinor?: number;
  isActive?: boolean;
}

export interface VehicleAvailability {
  id: string;
  category: string;
  city: string;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(ownerId: string, input: CreateVehicleInput): Promise<Vehicle> {
    const owner = await this.usersService.findById(ownerId);
    if (!owner || owner.verifiedStatus !== "VERIFIED") {
      throw new ForbiddenException("Only verified vendors can create listings");
    }
    return this.prisma.vehicle.create({ data: { ownerId, ...input } });
  }

  async update(
    callerId: string,
    vehicleId: string,
    input: UpdateVehicleInput,
  ): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    if (vehicle.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this vehicle");
    }
    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: input,
    });
  }

  async searchAvailable(
    startDate: string,
    endDate: string,
    city?: string,
  ): Promise<VehicleAvailability[]> {
    const cityFilter = city ? Prisma.sql`AND v.city = ${city}` : Prisma.empty;
    return this.prisma.$queryRaw<VehicleAvailability[]>(Prisma.sql`
      SELECT v.id, v.category, v.city, v.model, v.capacity,
             v.price_per_day_minor AS "pricePerDayMinor", v.currency
      FROM vehicles v
      WHERE v.is_active = true ${cityFilter}
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.vehicle_id = v.id
            AND b.status IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
            AND b.date_range && daterange(${startDate}::date, ${endDate}::date, '[)')
        )
    `);
  }
}
```

- [ ] **Step 5: Run to confirm pass** → PASS.

- [ ] **Step 6: Write failing controller test**

`apps/api/src/vehicles/vehicles.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { VehiclesController } from "./vehicles.controller";
import { VehiclesService } from "./vehicles.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VehiclesController", () => {
  let controller: VehiclesController;
  let vehiclesService: {
    create: jest.Mock;
    update: jest.Mock;
    searchAvailable: jest.Mock;
  };

  beforeEach(async () => {
    vehiclesService = {
      create: jest.fn(),
      update: jest.fn(),
      searchAvailable: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VehiclesController],
      providers: [{ provide: VehiclesService, useValue: vehiclesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VehiclesController);
  });

  it("available() delegates to VehiclesService.searchAvailable", async () => {
    vehiclesService.searchAvailable.mockResolvedValue([{ id: "veh1" }]);
    const result = await controller.available(
      "2026-09-01",
      "2026-09-02",
      "Dhaka",
    );
    expect(vehiclesService.searchAvailable).toHaveBeenCalledWith(
      "2026-09-01",
      "2026-09-02",
      "Dhaka",
    );
    expect(result).toEqual([{ id: "veh1" }]);
  });

  it("create() delegates with the caller's id", async () => {
    vehiclesService.create.mockResolvedValue({ id: "veh1" });
    const result = await controller.create(
      { id: "v1", roles: ["VENDOR"] },
      { category: "CNG", city: "Dhaka", capacity: 3, pricePerDayMinor: 200000 },
    );
    expect(vehiclesService.create).toHaveBeenCalledWith("v1", {
      category: "CNG",
      city: "Dhaka",
      capacity: 3,
      pricePerDayMinor: 200000,
    });
    expect(result).toEqual({ id: "veh1" });
  });
});
```

- [ ] **Step 7: Run to confirm fail** → FAIL.

- [ ] **Step 8: Implement `VehiclesController`**

`apps/api/src/vehicles/vehicles.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Vehicle } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VehiclesService, VehicleAvailability } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";

@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get("available")
  async available(
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
    @Query("city") city?: string,
  ): Promise<VehicleAvailability[]> {
    return this.vehiclesService.searchAvailable(startDate, endDate, city);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.create(user.id, dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.update(user.id, id, dto);
  }
}
```

- [ ] **Step 9: `VehiclesModule`**

`apps/api/src/vehicles/vehicles.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { VehiclesService } from "./vehicles.service";
import { VehiclesController } from "./vehicles.controller";

@Module({
  imports: [UsersModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
```

- [ ] **Step 10: Run to confirm pass** → PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(api): add VehiclesService/Controller with availability search"
```

---

## Task 10: `bookings.types.ts` — shared Booking types

**Files:** Create `apps/api/src/bookings/bookings.types.ts`.

No test needed — this is a pure type-definition file (no logic), consumed by every later task in this module.

- [ ] **Step 1: Implement**

`apps/api/src/bookings/bookings.types.ts`:

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
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(api): add shared BookingRecord type"
```

---

## Task 11: `BookingsService.createBooking` (raw SQL insert + double-booking 409)

**Files:** Create `apps/api/src/bookings/bookings.service.ts(+.spec)`, `apps/api/src/bookings/dto/create-booking.dto.ts`.

**Interfaces:**

- Consumes: `BookingRecord` (Task 10), `PrismaService`, `PrismaService.$queryRaw`.
- Produces: `BookingsService.createBooking(userId: string, input: CreateBookingInput): Promise<BookingRecord>` — throws `ConflictException` (409) on overlap, `NotFoundException` if the room/vehicle doesn't exist or is inactive, `ForbiddenException` if the owner isn't verified, `BadRequestException` for invalid dates or over-capacity.

- [ ] **Step 1: DTO**

`apps/api/src/bookings/dto/create-booking.dto.ts`:

```ts
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";

export class CreateBookingDto {
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @IsUUID()
  bookableId!: string;

  @IsDateString()
  checkIn!: string;

  @IsDateString()
  checkOut!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;
}
```

- [ ] **Step 2: Write the failing tests (unit — mocked Prisma, covers validation + the 409-on-overlap translation)**

`apps/api/src/bookings/bookings.service.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "./bookings.service";

function makeRawRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "b1",
    userId: "u1",
    bookableType: "ROOM",
    roomId: "r1",
    vehicleId: null,
    resourceOwnerId: "v1",
    checkIn: "2026-09-01",
    checkOut: "2026-09-03",
    guestCount: 2,
    totalAmountMinor: 1000000,
    currency: "BDT",
    status: "HELD",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("BookingsService.createBooking", () => {
  let prisma: {
    room: { findUnique: jest.Mock };
    vehicle: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: jest.fn() },
      vehicle: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
    );
  });

  it("rejects checkIn on/after checkOut", async () => {
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-05",
        checkOut: "2026-09-05",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a checkIn date in the past", async () => {
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2020-01-01",
        checkOut: "2020-01-02",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the room doesn't exist", async () => {
    prisma.room.findUnique.mockResolvedValue(null);
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "missing",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequestException when guestCount exceeds room capacity", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
    });
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
        guestCount: 5,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws ForbiddenException when the resource owner isn't verified", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "PENDING" } },
    });
    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates a HELD booking with totalAmountMinor computed from nights * price", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
    });
    prisma.$queryRaw.mockResolvedValue([
      makeRawRow({ totalAmountMinor: 1000000 }),
    ]);

    const result = await service.createBooking("u1", {
      bookableType: "ROOM",
      bookableId: "r1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      guestCount: 2,
    });

    expect(result.totalAmountMinor).toBe(1000000); // 2 nights * 500000
    expect(result.status).toBe("HELD");
  });

  it("translates a Postgres exclusion-constraint violation into ConflictException (409)", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      capacity: 2,
      pricePerNightMinor: 500000,
      currency: "BDT",
      hotel: { ownerId: "v1", owner: { verifiedStatus: "VERIFIED" } },
    });
    const pgError = Object.assign(
      new Error("conflicting key value violates exclusion constraint"),
      { code: "23P01" },
    );
    prisma.$queryRaw.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(pgError.message, {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23P01" },
      }),
    );

    await expect(
      service.createBooking("u1", {
        bookableType: "ROOM",
        bookableId: "r1",
        checkIn: "2026-09-01",
        checkOut: "2026-09-03",
      }),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — `Cannot find module './bookings.service'`.

- [ ] **Step 4: Implement**

`apps/api/src/bookings/bookings.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BookingRecord } from "./bookings.types";

export interface CreateBookingInput {
  bookableType: "ROOM" | "VEHICLE";
  bookableId: string;
  checkIn: string;
  checkOut: string;
  guestCount?: number;
}

const EXCLUSION_VIOLATION_SQLSTATE = "23P01";

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bullQueueEnqueue: (bookingId: string) => Promise<void>,
    private readonly paymentProvider: unknown,
  ) {}

  private validateDates(checkIn: string, checkOut: string): void {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (inDate >= outDate) {
      throw new BadRequestException("checkIn must be before checkOut");
    }
    if (inDate < today) {
      throw new BadRequestException("checkIn cannot be in the past");
    }
  }

  private nights(checkIn: string, checkOut: string): number {
    const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }

  private isExclusionViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.meta as { code?: string } | undefined)?.code ===
        EXCLUSION_VIOLATION_SQLSTATE
    );
  }

  async createBooking(
    userId: string,
    input: CreateBookingInput,
  ): Promise<BookingRecord> {
    this.validateDates(input.checkIn, input.checkOut);

    let resourceOwnerId: string;
    let pricePerUnit: number;
    let currency: string;

    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({
        where: { id: input.bookableId },
        include: { hotel: { include: { owner: true } } },
      });
      if (!room || !room.isActive)
        throw new NotFoundException("Room not found or inactive");
      if (input.guestCount && input.guestCount > room.capacity) {
        throw new BadRequestException(`Room capacity is ${room.capacity}`);
      }
      if (room.hotel.owner.verifiedStatus !== "VERIFIED") {
        throw new ForbiddenException("This listing's owner is not verified");
      }
      resourceOwnerId = room.hotel.ownerId;
      pricePerUnit = room.pricePerNightMinor;
      currency = room.currency;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: input.bookableId },
        include: { owner: true },
      });
      if (!vehicle || !vehicle.isActive)
        throw new NotFoundException("Vehicle not found or inactive");
      if (input.guestCount && input.guestCount > vehicle.capacity) {
        throw new BadRequestException(
          `Vehicle capacity is ${vehicle.capacity}`,
        );
      }
      if (vehicle.owner.verifiedStatus !== "VERIFIED") {
        throw new ForbiddenException("This listing's owner is not verified");
      }
      resourceOwnerId = vehicle.ownerId;
      pricePerUnit = vehicle.pricePerDayMinor;
      currency = vehicle.currency;
    }

    const totalAmountMinor =
      this.nights(input.checkIn, input.checkOut) * pricePerUnit;
    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId =
      input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
        INSERT INTO bookings (
          id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
          date_range, guest_count, total_amount_minor, currency, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${userId}, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
          daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)'),
          ${input.guestCount ?? null}, ${totalAmountMinor}, ${currency}, 'HELD', now(), now()
        )
        RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                  vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                  lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                  guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                  currency, status, created_at AS "createdAt", updated_at AS "updatedAt"
      `);
      const booking = rows[0];
      await this.bullQueueEnqueue(booking.id);
      return booking;
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This room/vehicle is no longer available for the selected dates",
        );
      }
      throw error;
    }
  }
}
```

Note: the constructor's `bullQueueEnqueue`/`paymentProvider` parameters are placeholders that Tasks 13/15 will replace with real injected services (`BookingExpiryQueueService`, `PaymentProviderPort`) — this task only needs `createBooking` working and unit-tested in isolation, so the test above passes a no-op function directly rather than a full DI setup.

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS. If the exclusion-violation test's mocked error shape doesn't match what `isExclusionViolation` checks, adjust `isExclusionViolation` to match — this is exactly the kind of "verify empirically, don't assume the exact Prisma error shape" situation flagged in the design; if this test fails on the shape check specifically (not on `ConflictException` being thrown), inspect the actual `Prisma.PrismaClientKnownRequestError` fields in the installed `@prisma/client` version and adjust.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add BookingsService.createBooking with raw-SQL insert and 409-on-overlap"
```

---

## Task 12: BullMQ setup — `BookingExpiryQueueService` + processor

**Files:** Create `apps/api/src/bookings/queue/{booking-expiry-queue.service.ts(+.spec), booking-expiry.processor.ts(+.spec)}`.

**Dependencies:** `@nestjs/bullmq@^11.0.0`, `bullmq@^5.0.0` (peer-compatibility confirmed against `@nestjs/common@^11.0.0` before this plan was written).

**Interfaces:**

- Produces: `BookingExpiryQueueService.scheduleExpiry(bookingId: string): Promise<void>`, `BookingExpiryQueueService.cancelExpiry(bookingId: string): Promise<void>`.

- [ ] **Step 1: Install**

```bash
pnpm --filter @staybangla/api add @nestjs/bullmq@^11.0.0 bullmq@^5.0.0
```

- [ ] **Step 2: Write the failing test for the queue service**

`apps/api/src/bookings/queue/booking-expiry-queue.service.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { BookingExpiryQueueService } from "./booking-expiry-queue.service";

describe("BookingExpiryQueueService", () => {
  let queue: { add: jest.Mock; remove: jest.Mock };
  let config: ConfigService;
  let service: BookingExpiryQueueService;

  beforeEach(() => {
    queue = { add: jest.fn(), remove: jest.fn() };
    config = { get: () => 15 } as unknown as ConfigService;
    service = new BookingExpiryQueueService(queue as never, config);
  });

  it("scheduleExpiry enqueues a delayed job keyed by bookingId (idempotent jobId)", async () => {
    await service.scheduleExpiry("booking-1");
    expect(queue.add).toHaveBeenCalledWith(
      "expire-booking",
      { bookingId: "booking-1" },
      expect.objectContaining({ jobId: "booking-1", delay: 15 * 60 * 1000 }),
    );
  });

  it("cancelExpiry removes the job by its bookingId-derived jobId", async () => {
    await service.cancelExpiry("booking-1");
    expect(queue.remove).toHaveBeenCalledWith("booking-1");
  });
});
```

- [ ] **Step 3: Run to confirm fail** → FAIL.

- [ ] **Step 4: Implement `BookingExpiryQueueService`**

`apps/api/src/bookings/queue/booking-expiry-queue.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";

export const BOOKING_EXPIRY_QUEUE = "booking-expiry";

@Injectable()
export class BookingExpiryQueueService {
  constructor(
    @InjectQueue(BOOKING_EXPIRY_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async scheduleExpiry(bookingId: string): Promise<void> {
    const holdMinutes = this.config.get<number>("BOOKING_HOLD_MINUTES", 15);
    await this.queue.add(
      "expire-booking",
      { bookingId },
      {
        jobId: bookingId,
        delay: holdMinutes * 60 * 1000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async cancelExpiry(bookingId: string): Promise<void> {
    await this.queue.remove(bookingId);
  }
}
```

- [ ] **Step 5: Run to confirm pass** → PASS.

- [ ] **Step 6: Write the failing test for the processor**

`apps/api/src/bookings/queue/booking-expiry.processor.spec.ts`:

```ts
import { BookingExpiryProcessor } from "./booking-expiry.processor";
import { PrismaService } from "../../prisma/prisma.service";

describe("BookingExpiryProcessor", () => {
  it("auto-cancels a booking that is still HELD, guarded by status in the UPDATE", async () => {
    const prisma = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const processor = new BookingExpiryProcessor(
      prisma as unknown as PrismaService,
    );

    await processor.process({ data: { bookingId: "booking-1" } } as never);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", status: "HELD" },
      data: { status: "AUTO_CANCELLED" },
    });
  });

  it("is a safe no-op when the booking was already confirmed/cancelled before the timer fired", async () => {
    const prisma = {
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const processor = new BookingExpiryProcessor(
      prisma as unknown as PrismaService,
    );

    await expect(
      processor.process({ data: { bookingId: "booking-1" } } as never),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 7: Run to confirm fail** → FAIL.

- [ ] **Step 8: Implement `BookingExpiryProcessor`**

`apps/api/src/bookings/queue/booking-expiry.processor.ts`:

```ts
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { BOOKING_EXPIRY_QUEUE } from "./booking-expiry-queue.service";

interface ExpireBookingJobData {
  bookingId: string;
}

@Processor(BOOKING_EXPIRY_QUEUE)
export class BookingExpiryProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ExpireBookingJobData>): Promise<void> {
    await this.prisma.booking.updateMany({
      where: { id: job.data.bookingId, status: "HELD" },
      data: { status: "AUTO_CANCELLED" },
    });
  }
}
```

- [ ] **Step 9: Run to confirm pass** → PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add BullMQ booking-expiry queue and processor"
```

---

## Task 13: Wire `createBooking` to the real queue + payment port; add `confirmPayment`

**Files:** Modify `apps/api/src/bookings/bookings.service.ts`, `apps/api/src/bookings/bookings.service.spec.ts`.

- [ ] **Step 1: Update the constructor and `createBooking`'s queue call**

Replace the `BookingsService` constructor and the `bullQueueEnqueue`/`paymentProvider` placeholders:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderPort } from "../common/payments/payment-provider.port";
import { BookingExpiryQueueService } from "./queue/booking-expiry-queue.service";
import { BookingRecord } from "./bookings.types";

// ... (CreateBookingInput, EXCLUSION_VIOLATION_SQLSTATE unchanged)

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expiryQueue: BookingExpiryQueueService,
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  // ...(validateDates, nights, isExclusionViolation unchanged)

  async createBooking(
    userId: string,
    input: CreateBookingInput,
  ): Promise<BookingRecord> {
    // ...(unchanged validation + pricing logic)

    try {
      const rows =
        await this.prisma.$queryRaw<BookingRecord[]>(/* unchanged INSERT */);
      const booking = rows[0];
      await this.expiryQueue.scheduleExpiry(booking.id);
      return booking;
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException(
          "This room/vehicle is no longer available for the selected dates",
        );
      }
      throw error;
    }
  }

  async confirmPayment(bookingId: string): Promise<BookingRecord> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException("Booking not found");

    if (booking.status === "CONFIRMED") {
      return this.toBookingRecord(booking);
    }
    if (booking.status !== "HELD") {
      throw new ConflictException(
        `Booking is ${booking.status}, cannot confirm payment`,
      );
    }

    await this.paymentProvider.charge(
      bookingId,
      booking.totalAmountMinor,
      booking.currency,
    );

    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: "HELD" },
      data: { status: "CONFIRMED" },
    });
    if (result.count === 0) {
      // Lost the race to the auto-cancel timer between our read and this update.
      throw new ConflictException(
        "Booking hold expired before payment could be confirmed",
      );
    }

    await this.expiryQueue.cancelExpiry(bookingId);
    const updated = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return this.toBookingRecord(updated);
  }

  private toBookingRecord(booking: {
    id: string;
    userId: string | null;
    bookableType: string;
    roomId: string | null;
    vehicleId: string | null;
    resourceOwnerId: string;
    guestCount: number | null;
    totalAmountMinor: number;
    currency: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): BookingRecord {
    // dateRange (Unsupported type) isn't selectable via Prisma Client — callers that
    // need checkIn/checkOut on a status-only path re-fetch via $queryRaw if required.
    return { ...booking, checkIn: "", checkOut: "" } as BookingRecord;
  }
}
```

- [ ] **Step 2: Write the failing tests for `confirmPayment`**

Append to `apps/api/src/bookings/bookings.service.spec.ts` (add `booking: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() }` to the `prisma` mock object in `beforeEach`, and construct `service` with real mock collaborators):

```ts
describe("BookingsService.confirmPayment", () => {
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let expiryQueue: { scheduleExpiry: jest.Mock; cancelExpiry: jest.Mock };
  let paymentProvider: { charge: jest.Mock };
  let service: BookingsService;

  beforeEach(() => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    expiryQueue = { scheduleExpiry: jest.fn(), cancelExpiry: jest.fn() };
    paymentProvider = {
      charge: jest.fn().mockResolvedValue({ success: true }),
    };
    service = new BookingsService(
      prisma as unknown as PrismaService,
      expiryQueue as never,
      paymentProvider as never,
    );
  });

  it("confirms a HELD booking, charges via the payment provider, and cancels the expiry job", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "HELD",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      userId: "u1",
      bookableType: "ROOM",
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "v1",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: "CONFIRMED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.confirmPayment("b1");

    expect(paymentProvider.charge).toHaveBeenCalledWith("b1", 1000000, "BDT");
    expect(expiryQueue.cancelExpiry).toHaveBeenCalledWith("b1");
    expect(result.status).toBe("CONFIRMED");
  });

  it("is idempotent: calling confirmPayment on an already-CONFIRMED booking succeeds without re-charging", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "CONFIRMED",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });

    const result = await service.confirmPayment("b1");

    expect(paymentProvider.charge).not.toHaveBeenCalled();
    expect(result.status).toBe("CONFIRMED");
  });

  it("throws ConflictException when the booking already expired (AUTO_CANCELLED)", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "AUTO_CANCELLED",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
    await expect(service.confirmPayment("b1")).rejects.toThrow(
      ConflictException,
    );
  });

  it("throws ConflictException when the auto-cancel timer wins the race after the read", async () => {
    prisma.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: "HELD",
      totalAmountMinor: 1000000,
      currency: "BDT",
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmPayment("b1")).rejects.toThrow(
      ConflictException,
    );
  });

  it("throws NotFoundException for a missing booking", async () => {
    prisma.booking.findUnique.mockResolvedValue(null);
    await expect(service.confirmPayment("missing")).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 3: Run to confirm fail then pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: initially FAIL (methods/constructor signature mismatch against the old placeholder tests from Task 11 — update those earlier tests in the same file to construct `BookingsService` with `{ scheduleExpiry: jest.fn() }` and `{ charge: jest.fn() }` mocks instead of `{}`/`{}`), then PASS once aligned.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): wire BookingsService to the real expiry queue and payment port; add confirmPayment"
```

---

## Task 14: `BookingsService.checkout` + `cancel` + `createBlock`

**Files:** Modify `apps/api/src/bookings/bookings.service.ts`, `apps/api/src/bookings/bookings.service.spec.ts`. Create `apps/api/src/bookings/dto/create-block.dto.ts`.

- [ ] **Step 1: DTO**

`apps/api/src/bookings/dto/create-block.dto.ts`:

```ts
import { IsDateString, IsIn, IsUUID } from "class-validator";

export class CreateBlockDto {
  @IsIn(["ROOM", "VEHICLE"])
  bookableType!: "ROOM" | "VEHICLE";

  @IsUUID()
  bookableId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/bookings/bookings.service.spec.ts`:

```ts
describe("BookingsService.checkout", () => {
  it("completes a CONFIRMED booking owned by the caller", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      userId: "u1",
      bookableType: "ROOM",
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "v1",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: "COMPLETED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.checkout("v1", "b1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: "b1",
        resourceOwnerId: "v1",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      data: { status: "COMPLETED" },
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("throws ConflictException when the caller does not own the booking's resource (updateMany matches 0 rows)", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.checkout("someone-else", "b1")).rejects.toThrow(
      ConflictException,
    );
  });
});

describe("BookingsService.cancel", () => {
  it("cancels the caller's own HELD/CONFIRMED booking", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      id: "b1",
      userId: "u1",
      bookableType: "ROOM",
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "v1",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: "CANCELLED",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.cancel("u1", "b1");

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", userId: "u1", status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    expect(result.status).toBe("CANCELLED");
  });

  it("throws ConflictException when the booking isn't the caller's or isn't cancellable", async () => {
    prisma.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel("u2", "b1")).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 3: Run to confirm fail** → FAIL.

- [ ] **Step 4: Implement — add to `BookingsService`**

```ts
  async checkout(callerId: string, bookingId: string): Promise<BookingRecord> {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, resourceOwnerId: callerId, status: { in: ["CONFIRMED", "CHECKED_IN"] } },
      data: { status: "COMPLETED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Booking not found, not yours, or not in a checkout-eligible state");
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    return this.toBookingRecord(updated);
  }

  async cancel(callerId: string, bookingId: string): Promise<BookingRecord> {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, userId: callerId, status: { in: ["HELD", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      throw new ConflictException("Booking not found, not yours, or not cancellable");
    }
    const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    return this.toBookingRecord(updated);
  }
```

- [ ] **Step 5: Run to confirm pass** → PASS.

- [ ] **Step 6: `createBlock` — write the failing test**

Append to `apps/api/src/bookings/bookings.service.spec.ts`:

```ts
describe("BookingsService.createBlock", () => {
  it("rejects a block on a room the caller does not own", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "someone-else" },
    });
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("creates a BLOCKED row via raw insert for the caller's own room", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockResolvedValue([{ id: "block-1", status: "BLOCKED" }]);

    await service.createBlock("v1", {
      bookableType: "ROOM",
      bookableId: "r1",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });

    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("translates an overlap with an existing booking into ConflictException", async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: "r1",
      isActive: true,
      hotel: { ownerId: "v1" },
    });
    prisma.$queryRaw.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23P01" },
      }),
    );
    await expect(
      service.createBlock("v1", {
        bookableType: "ROOM",
        bookableId: "r1",
        startDate: "2026-09-01",
        endDate: "2026-09-03",
      }),
    ).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 7: Run to confirm fail** → FAIL.

- [ ] **Step 8: Implement `createBlock`**

```ts
export interface CreateBlockInput {
  bookableType: "ROOM" | "VEHICLE";
  bookableId: string;
  startDate: string;
  endDate: string;
}
```

Add to the class:

```ts
  async createBlock(callerId: string, input: CreateBlockInput): Promise<BookingRecord> {
    let resourceOwnerId: string;

    if (input.bookableType === "ROOM") {
      const room = await this.prisma.room.findUnique({ where: { id: input.bookableId }, include: { hotel: true } });
      if (!room || !room.isActive) throw new NotFoundException("Room not found or inactive");
      resourceOwnerId = room.hotel.ownerId;
    } else {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: input.bookableId } });
      if (!vehicle || !vehicle.isActive) throw new NotFoundException("Vehicle not found or inactive");
      resourceOwnerId = vehicle.ownerId;
    }

    if (resourceOwnerId !== callerId) {
      throw new ForbiddenException("You do not own this resource");
    }

    const roomId = input.bookableType === "ROOM" ? input.bookableId : null;
    const vehicleId = input.bookableType === "VEHICLE" ? input.bookableId : null;

    try {
      const rows = await this.prisma.$queryRaw<BookingRecord[]>(Prisma.sql`
        INSERT INTO bookings (
          id, user_id, bookable_type, room_id, vehicle_id, resource_owner_id,
          date_range, total_amount_minor, currency, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), NULL, ${input.bookableType}::"BookableType", ${roomId}, ${vehicleId}, ${resourceOwnerId},
          daterange(${input.startDate}::date, ${input.endDate}::date, '[)'),
          0, 'BDT', 'BLOCKED', now(), now()
        )
        RETURNING id, user_id AS "userId", bookable_type AS "bookableType", room_id AS "roomId",
                  vehicle_id AS "vehicleId", resource_owner_id AS "resourceOwnerId",
                  lower(date_range)::text AS "checkIn", upper(date_range)::text AS "checkOut",
                  guest_count AS "guestCount", total_amount_minor AS "totalAmountMinor",
                  currency, status, created_at AS "createdAt", updated_at AS "updatedAt"
      `);
      return rows[0];
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new ConflictException("This date range overlaps an existing booking or block");
      }
      throw error;
    }
  }
```

- [ ] **Step 9: Run to confirm pass** → PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add BookingsService.checkout/cancel/createBlock"
```

---

## Task 15: `BookingsController`

**Files:** Create `apps/api/src/bookings/bookings.controller.ts(+.spec)`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/bookings/bookings.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("BookingsController", () => {
  let controller: BookingsController;
  let bookingsService: {
    createBooking: jest.Mock;
    confirmPayment: jest.Mock;
    checkout: jest.Mock;
    cancel: jest.Mock;
    createBlock: jest.Mock;
  };

  beforeEach(async () => {
    bookingsService = {
      createBooking: jest.fn(),
      confirmPayment: jest.fn(),
      checkout: jest.fn(),
      cancel: jest.fn(),
      createBlock: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [{ provide: BookingsService, useValue: bookingsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(BookingsController);
  });

  it("create() passes the caller's id", async () => {
    bookingsService.createBooking.mockResolvedValue({ id: "b1" });
    const dto = {
      bookableType: "ROOM" as const,
      bookableId: "r1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
    };
    const result = await controller.create(
      { id: "u1", roles: ["TRAVELER"] },
      dto,
    );
    expect(bookingsService.createBooking).toHaveBeenCalledWith("u1", dto);
    expect(result).toEqual({ id: "b1" });
  });

  it("confirmPayment() delegates by booking id", async () => {
    bookingsService.confirmPayment.mockResolvedValue({
      id: "b1",
      status: "CONFIRMED",
    });
    const result = await controller.confirmPayment("b1");
    expect(bookingsService.confirmPayment).toHaveBeenCalledWith("b1");
    expect(result.status).toBe("CONFIRMED");
  });

  it("checkout() passes the caller's id", async () => {
    bookingsService.checkout.mockResolvedValue({
      id: "b1",
      status: "COMPLETED",
    });
    await controller.checkout({ id: "v1", roles: ["VENDOR"] }, "b1");
    expect(bookingsService.checkout).toHaveBeenCalledWith("v1", "b1");
  });

  it("cancel() passes the caller's id", async () => {
    bookingsService.cancel.mockResolvedValue({ id: "b1", status: "CANCELLED" });
    await controller.cancel({ id: "u1", roles: ["TRAVELER"] }, "b1");
    expect(bookingsService.cancel).toHaveBeenCalledWith("u1", "b1");
  });

  it("createBlock() passes the caller's id", async () => {
    bookingsService.createBlock.mockResolvedValue({
      id: "block-1",
      status: "BLOCKED",
    });
    const dto = {
      bookableType: "ROOM" as const,
      bookableId: "r1",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    };
    await controller.createBlock({ id: "v1", roles: ["VENDOR"] }, dto);
    expect(bookingsService.createBlock).toHaveBeenCalledWith("v1", dto);
  });
});
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/bookings/bookings.controller.ts`:

```ts
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { BookingsService } from "./bookings.service";
import { BookingRecord } from "./bookings.types";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { CreateBlockDto } from "./dto/create-block.dto";

@Controller()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post("bookings")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @Post("bookings/:id/confirm-payment")
  async confirmPayment(@Param("id") id: string): Promise<BookingRecord> {
    return this.bookingsService.confirmPayment(id);
  }

  @Post("bookings/:id/checkout")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async checkout(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.checkout(user.id, id);
  }

  @Post("bookings/:id/cancel")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("TRAVELER")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ): Promise<BookingRecord> {
    return this.bookingsService.cancel(user.id, id);
  }

  @Post("vendor/blocks")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async createBlock(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBlockDto,
  ): Promise<BookingRecord> {
    return this.bookingsService.createBlock(user.id, dto);
  }
}
```

- [ ] **Step 4: Run to confirm pass** → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add BookingsController wiring all lifecycle endpoints"
```

---

## Task 16: `BookingsModule` — wire queue, payments, everything together

**Files:** Create `apps/api/src/bookings/bookings.module.ts`.

- [ ] **Step 1: Implement**

`apps/api/src/bookings/bookings.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { PaymentsModule } from "../common/payments/payments.module";
import { BookingsService } from "./bookings.service";
import { BookingsController } from "./bookings.controller";
import {
  BookingExpiryQueueService,
  BOOKING_EXPIRY_QUEUE,
} from "./queue/booking-expiry-queue.service";
import { BookingExpiryProcessor } from "./queue/booking-expiry.processor";

@Module({
  imports: [
    PaymentsModule,
    BullModule.registerQueue({ name: BOOKING_EXPIRY_QUEUE }),
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingExpiryQueueService,
    BookingExpiryProcessor,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
```

- [ ] **Step 2: Add `BullModule.forRoot` to `AppModule`**

`apps/api/src/app.module.ts` already has `ConfigModule.forRoot({ isGlobal: true, ... })`, so `ConfigService` is injectable anywhere without re-importing `ConfigModule` — `BullModule.forRootAsync`'s own `imports` array can stay empty. Add the import and register BullMQ's Redis connection once globally:

```ts
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
```

(`ConfigService` needs adding to the existing `import { ConfigModule } from "@nestjs/config";` line — change it to `import { ConfigModule, ConfigService } from "@nestjs/config";`.)

Add to the `imports` array (after `RedisModule`, before `HealthModule`), using a factory so it reads `REDIS_URL` from `ConfigService` consistently with `RedisService`:

```ts
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL") },
      }),
    }),
```

Also add `HotelsModule`, `VehiclesModule`, `BookingsModule` to the `imports` array (each needs its own `import { ... } from "./hotels/hotels.module";` etc. at the top of the file).

- [ ] **Step 3: Run full unit + e2e regression**

```bash
pnpm --filter @staybangla/api run test:unit
pnpm --filter @staybangla/api run test:e2e
pnpm --filter @staybangla/api build
```

Expected: all green — this confirms BullMQ's Redis connection boots correctly alongside everything from the auth module.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): wire HotelsModule/VehiclesModule/BookingsModule and BullMQ into AppModule"
```

---

## Task 17: CASL extension — Hotel/Vehicle/Booking subjects

**Files:** Modify `apps/api/src/casl/casl-ability.factory.ts`, `apps/api/src/casl/casl-ability.factory.spec.ts`.

This module's authorization is already handled by `RolesGuard` + service-level ownership checks (Tasks 5–14) — CASL's `PoliciesGuard` isn't strictly required on every endpoint the way it is for `/users/me`. Extend `CaslAbilityFactory` now so the same pattern is available for any endpoint that later needs a declarative (not just service-level) ownership check, and so `AppSubjects` stays the single source of truth for every subject type in the app.

**Note on the actual current implementation:** `apps/api/src/casl/casl-ability.factory.ts` uses `createMongoAbility`/`MongoAbility` (not `PureAbility`) and tags subjects with the literal field name `__caslSubjectType__` (not `__type`) — this was a hard-won fix from the auth module (`PureAbility` has no default conditions matcher and throws at runtime; CASL's `InferSubjects` only recognizes `__caslSubjectType__`/`kind`/`__typename` as tag fields). The steps below match the real file, not a generic CASL setup.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/casl/casl-ability.factory.spec.ts`:

```ts
it("lets a vendor read/update their own Hotel but not another vendor's", () => {
  const ability = factory.createForUser({ id: "v1", roles: ["VENDOR"] });
  expect(
    ability.can("update", {
      __caslSubjectType__: "Hotel",
      id: "h1",
      ownerId: "v1",
    }),
  ).toBe(true);
  expect(
    ability.can("update", {
      __caslSubjectType__: "Hotel",
      id: "h2",
      ownerId: "someone-else",
    }),
  ).toBe(false);
});

it("lets an ADMIN update any Hotel", () => {
  const ability = factory.createForUser({ id: "admin1", roles: ["ADMIN"] });
  expect(
    ability.can("update", {
      __caslSubjectType__: "Hotel",
      id: "h2",
      ownerId: "someone-else",
    }),
  ).toBe(true);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: FAIL — TypeScript compile error, `AppSubjects` doesn't include a `Hotel` shape yet.

- [ ] **Step 3: Implement**

In `apps/api/src/casl/casl-ability.factory.ts`, extend the subject interfaces and rules (keep `createMongoAbility`/`MongoAbility`/`__caslSubjectType__` exactly as they already are — do not revert to `PureAbility` or rename the tag field):

```ts
interface UserSubject {
  __caslSubjectType__: "User";
  id: string;
}

interface HotelSubject {
  __caslSubjectType__: "Hotel";
  id: string;
  ownerId: string;
}

interface VehicleSubject {
  __caslSubjectType__: "Vehicle";
  id: string;
  ownerId: string;
}

export type AppSubjects =
  InferSubjects<UserSubject | HotelSubject | VehicleSubject> | "all";
export type AppAbility = MongoAbility<[string, AppSubjects]>;
```

And inside `createForUser`, extend the rules (keep the existing `User` rules untouched, keep using `AbilityBuilder<AppAbility>(createMongoAbility)`):

```ts
if (user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN")) {
  can("read", "User");
  can("update", "User");
  can("read", "Hotel");
  can("update", "Hotel");
  can("read", "Vehicle");
  can("update", "Vehicle");
} else {
  can("read", "User", { id: user.id });
  can("update", "User", { id: user.id });
  can("read", "Hotel", { ownerId: user.id });
  can("update", "Hotel", { ownerId: user.id });
  can("read", "Vehicle", { ownerId: user.id });
  can("update", "Vehicle", { ownerId: user.id });
}
```

And extend `detectSubjectType` to keep resolving via the same tag field (no change needed — it already reads `__caslSubjectType__` generically off any subject, so `Hotel`/`Vehicle` subjects resolve the same way `User` does).

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): extend CaslAbilityFactory with Hotel/Vehicle subjects"
```

---

## Task 18: Dedicated e2e test fixtures helper

**Files:** Create `apps/api/test/helpers/test-fixtures.ts`.

**Note on the actual current helpers:** `apps/api/test/helpers/test-users.ts` already exports `registerAndLogin(app, email, password?): Promise<{ accessToken: string; refreshCookie: string }>` (it always registers with `role: "VENDOR"`) and `extractCookie(res)`. `apps/api/test/helpers/test-db.ts` exports `testPrisma` and `cleanDatabase()`. The fixture helper below builds on these exactly as they exist — it does not redefine `registerAndLogin`.

- [ ] **Step 1: Implement**

`apps/api/test/helpers/test-fixtures.ts`:

```ts
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { registerAndLogin } from "./test-users";
import { testPrisma } from "./test-db";

export async function createVerifiedVendor(
  app: INestApplication,
  email: string,
): Promise<{ vendorId: string; accessToken: string }> {
  const { accessToken } = await registerAndLogin(app, email);
  const me = await request(app.getHttpServer())
    .get("/users/me")
    .set("Authorization", `Bearer ${accessToken}`);

  // Test-only shortcut: directly flip verifiedStatus via Prisma, since the real
  // admin-approval flow (add-admin-panel-basic) doesn't exist yet.
  await testPrisma.user.update({
    where: { id: me.body.id },
    data: { verifiedStatus: "VERIFIED" },
  });

  return { vendorId: me.body.id as string, accessToken };
}

export async function createHotelWithRoom(
  app: INestApplication,
  vendorToken: string,
  overrides: Partial<{ pricePerNightMinor: number; capacity: number }> = {},
): Promise<{ hotelId: string; roomId: string }> {
  const hotel = await request(app.getHttpServer())
    .post("/hotels")
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({ name: "Test Hotel", city: "Dhaka", address: "123 Test Road" });

  const room = await request(app.getHttpServer())
    .post(`/hotels/${hotel.body.id}/rooms`)
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({
      roomType: "DOUBLE",
      pricePerNightMinor: overrides.pricePerNightMinor ?? 500000,
      capacity: overrides.capacity ?? 2,
    });

  return { hotelId: hotel.body.id as string, roomId: room.body.id as string };
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test(api): add e2e fixtures for verified vendors and hotel/room setup"
```

---

## Task 19: E2e — the concurrency race test

**Files:** Create `apps/api/test/booking-concurrency.e2e-spec.ts`.

- [ ] **Step 1: Implement**

`apps/api/test/booking-concurrency.e2e-spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Booking concurrency (e2e)", () => {
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

  it("allows exactly one of 5 concurrent bookings for the same room and overlapping dates to succeed", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "concurrency-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    const travelers = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        registerAndLogin(app, `concurrency-traveler-${i}@example.com`),
      ),
    );

    const results = await Promise.all(
      travelers.map(({ accessToken }) =>
        request(app.getHttpServer())
          .post("/bookings")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            bookableType: "ROOM",
            bookableId: roomId,
            checkIn: "2026-10-01",
            checkOut: "2026-10-03",
          }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(4);
  });

  it("allows back-to-back bookings on the same room (checkout day = next checkin day)", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "backtoback-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: traveler1 } = await registerAndLogin(
      app,
      "backtoback-t1@example.com",
    );
    const { accessToken: traveler2 } = await registerAndLogin(
      app,
      "backtoback-t2@example.com",
    );

    const first = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${traveler1}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-01",
        checkOut: "2026-11-03",
      });

    const second = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${traveler2}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-11-03",
        checkOut: "2026-11-05",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e`
Expected: PASS — this is the empirical, permanent regression-test version of the manual verification already done by hand against real Postgres before this plan was written.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(api): add e2e concurrency test proving exactly one booking wins the race"
```

---

## Task 20: E2e — lifecycle + ownership tests

**Files:** Create `apps/api/test/booking-lifecycle.e2e-spec.ts`, `apps/api/test/booking-ownership.e2e-spec.ts`.

- [ ] **Step 1: `booking-lifecycle.e2e-spec.ts`**

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Booking lifecycle (e2e)", () => {
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

  it("full happy path: create -> confirm-payment -> checkout", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "lifecycle-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "lifecycle-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-01",
        checkOut: "2026-12-03",
        guestCount: 2,
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("HELD");
    expect(created.body.totalAmountMinor).toBe(1000000);

    const confirmed = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe("CONFIRMED");

    const checkedOut = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(checkedOut.status).toBe(201);
    expect(checkedOut.body.status).toBe("COMPLETED");
  });

  it("confirm-payment is idempotent when called twice", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "idempotent-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "idempotent-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-05",
        checkOut: "2026-12-06",
      });

    const first = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );
    const second = await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("CONFIRMED");
  });

  it("rejects booking a room beyond its capacity", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "capacity-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken, {
      capacity: 2,
    });
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "capacity-traveler@example.com",
    );

    const res = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-10",
        checkOut: "2026-12-11",
        guestCount: 5,
      });

    expect(res.status).toBe(400);
  });

  it("rejects a checkIn date that is not before checkOut", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "date-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "date-traveler@example.com",
    );

    const res = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-15",
        checkOut: "2026-12-15",
      });

    expect(res.status).toBe(400);
  });

  it("vendor blackout block also blocks a customer booking for the same dates", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "block-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "block-traveler@example.com",
    );

    const block = await request(app.getHttpServer())
      .post("/vendor/blocks")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        startDate: "2026-12-20",
        endDate: "2026-12-22",
      });
    expect(block.status).toBe(201);

    const attempt = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2026-12-21",
        checkOut: "2026-12-23",
      });
    expect(attempt.status).toBe(409);
  });
});
```

- [ ] **Step 2: `booking-ownership.e2e-spec.ts`**

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import {
  createVerifiedVendor,
  createHotelWithRoom,
} from "./helpers/test-fixtures";

describe("Booking ownership (e2e)", () => {
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

  it("vendor B cannot checkout vendor A's booking", async () => {
    const { accessToken: vendorAToken } = await createVerifiedVendor(
      app,
      "ownerA@example.com",
    );
    const { accessToken: vendorBToken } = await createVerifiedVendor(
      app,
      "ownerB@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorAToken);
    const { accessToken: travelerToken } = await registerAndLogin(
      app,
      "ownership-traveler@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-01",
        checkOut: "2027-01-03",
      });
    await request(app.getHttpServer()).post(
      `/bookings/${created.body.id}/confirm-payment`,
    );

    const res = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/checkout`)
      .set("Authorization", `Bearer ${vendorBToken}`);

    expect(res.status).toBe(409);
  });

  it("traveler B cannot cancel traveler A's booking", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "cancel-vendor@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);
    const { accessToken: travelerAToken } = await registerAndLogin(
      app,
      "cancel-a@example.com",
    );
    const { accessToken: travelerBToken } = await registerAndLogin(
      app,
      "cancel-b@example.com",
    );

    const created = await request(app.getHttpServer())
      .post("/bookings")
      .set("Authorization", `Bearer ${travelerAToken}`)
      .send({
        bookableType: "ROOM",
        bookableId: roomId,
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
      });

    const res = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${travelerBToken}`);

    expect(res.status).toBe(409);
  });

  it("an unverified vendor cannot create a hotel", async () => {
    const { accessToken } = await registerAndLogin(
      app,
      "unverified@example.com",
    );
    const res = await request(app.getHttpServer())
      .post("/hotels")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Sneaky Hotel", city: "Dhaka", address: "1 Rd" });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): add e2e lifecycle and ownership tests for bookings"
```

---

## Task 21: Final coverage tuning + full verification + PR

- [ ] **Step 1: Run unit coverage, add exclusions for thin wiring if needed**

Run: `pnpm --filter @staybangla/api run test:unit`
Following the established pattern in `jest.config.cjs`, add any newly-created zero-branching wiring files (e.g. `bookings.module.ts`, `hotels.module.ts`, `vehicles.module.ts` — already covered by the existing `!**/*.module.ts` glob) to `collectCoverageFrom` excludes only if they show <100% and have no real branching logic — do not exclude `bookings.service.ts`, `hotels.service.ts`, `vehicles.service.ts`, or the queue processor, since these all contain real logic that must stay covered.

- [ ] **Step 2: Full monorepo verification**

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 3: Runtime smoke test**

```bash
pnpm --filter @staybangla/api build
node apps/api/dist/main.js &
sleep 3
curl -s http://localhost:3001/health
curl -s http://localhost:3001/api/docs -o /dev/null -w "%{http_code}\n"
```

Expected: `{"status":"ok"}` and `200`.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/hotel-vehicle-booking-core
gh pr create --title "feat: hotel/vehicle booking core with double-booking-proof lifecycle" --body "Phase 1 booking engine. See docs/superpowers/specs/2026-07-25-hotel-vehicle-booking-core-design.md for the full design."
gh pr checks --watch
```

- [ ] **Step 5: Merge once green, then run `/code-review` and `/security-review`**

```bash
gh pr merge --squash --delete-branch
```

Per the standing project preference, run `/code-review` and `/security-review` against this PR given it handles money, concurrency, and cross-vendor authorization.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc (generic Booking model, one-row-per-unit rationale, lifecycle, idempotency, availability search, CASL, payment stub, blackout blocks, `shared-types` consistency) is represented in Tasks 1–20. ✓
- **Type consistency:** `BookingRecord` (Task 10) is defined once and reused by name in every later task (`createBooking`, `confirmPayment`, `checkout`, `cancel`, `createBlock`, controller). `RoomAvailability`/`VehicleAvailability` defined once each (Tasks 8, 9) and reused in their respective controllers. ✓
- **No placeholders:** Task 11's constructor briefly uses a documented interim signature that Task 13 replaces with the real `BookingExpiryQueueService`/`PaymentProviderPort` — this is called out explicitly as an intentional two-step build (queue/payment services don't exist until Tasks 12/4 are done), not a vague "wire it up later." ✓
- **Empirically de-risked before writing:** the double-booking constraint (the single highest-risk mechanism in this plan) was proven against a real Postgres instance — sequential edge cases (overlap-reject, back-to-back-allow, cross-room-allow, cancelled-ignore) and a genuine 10-way concurrent race (1 winner, 9 rejected) — before this plan was written, and BullMQ's NestJS v11 peer-compatibility was confirmed via `npm view` before Task 12 was drafted.

## Verification (end-to-end)

1. `docker compose -f infra/docker/docker-compose.yml up -d` → postgres/redis/minio healthy.
2. Dev + test DBs migrated (Task 3).
3. `pnpm --filter @staybangla/api run test:unit` → green, coverage holds at the existing 80% threshold.
4. `pnpm --filter @staybangla/api run test:e2e` → green, including the concurrency race test (run twice to confirm no flakiness, matching the auth module's precedent).
5. `pnpm lint && pnpm typecheck && pnpm build` (full monorepo) → green.
6. Manual smoke: register+verify a vendor, create a hotel+room, book it as a traveler, confirm payment, checkout as the vendor — full happy path via curl, same rigor as the auth module's manual refresh-token-reuse verification.
7. PR opened, `verify` CI check green, merged via `gh pr merge --squash --delete-branch`.
8. `/code-review` and `/security-review` run against the change.

## Next after this module

Per the roadmap: `add-vendor-dashboard-basic` (daily/monthly earnings, reusing `Booking.totalAmountMinor`), `add-admin-panel-basic` (vendor approval — replaces the `createVerifiedVendor` e2e test shortcut with a real approval flow), `add-marketing-landing-page`. Each gets its own design + plan.
