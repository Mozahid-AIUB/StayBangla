# Room Listing Enhancements + Vendor Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the booking platform enterprise-grade listing detail (fixed districts, room AC/bed-type/facility attributes, hotel photos) and a real vendor-approval workflow (admin approve/reject with audit trail), on top of the already-merged booking core.

**Architecture:** Extends four existing Prisma models (`User`, `Hotel`, `Room`, `Vehicle`) with new fields/enums and adds three new models (`VendorVerificationLog`, `HotelPhoto`, `RoomPhoto`). No new bookable resource type, no change to booking lifecycle or double-booking prevention. A new `StoragePort`/`MinioStorageService` (port/adapter, mirroring the existing `PaymentProviderPort`/`StubPaymentProviderService` pair) handles presigned-URL photo upload against the MinIO container that has run since Phase 0 but was never used by any code until now.

**Tech Stack:** `minio` npm SDK (new dependency), Prisma migrations with raw-SQL `ALTER COLUMN ... TYPE ... USING` casts (existing `TEXT` columns becoming enums) and partial unique indexes (one-primary-photo-per-resource), NestJS/class-validator DTOs following the exact conventions already established in `apps/api/src/hotels/`, `apps/api/src/vehicles/`.

## Global Constraints

- Follow existing conventions exactly: kebab-case files, `<name>.controller.ts`/`.service.ts`/`.module.ts`, constructor DI, relative imports, DTOs with class-validator.
- Design source of truth: `docs/superpowers/specs/2026-07-24-room-listing-enhancements-design.md` — read it before starting if anything below is ambiguous.
- `District`/`RoomType`/`BedType`/`FacilityCatalog` are all Postgres enums — Prisma's auto-generated migration for a `String → Enum` column change on an _existing_ column does NOT include a safe `USING` cast; the raw SQL must be hand-added to the generated migration, exactly as the booking-core migration's exclusion constraints were.
- Only `verifiedStatus === "VERIFIED"` vendors may create Hotel/Room/Vehicle — this existing rule is untouched; this module only adds who can flip a vendor's status and how.
- Guarded-`updateMany` discipline for every status transition (approve/reject/resubmit): `updateMany({ where: { id, verifiedStatus: <expected> }, data: { verifiedStatus: <next> } })`, checking `count === 1`/`0` — never a plain `update()`. This is the same race-safety pattern already used by `confirmPayment`/`checkout`/`cancel` in `BookingsService`.
- `objectKey` for photos is always server-generated (`hotels/{hotelId}/{uuid}.{ext}` / `rooms/{roomId}/{uuid}.{ext}`), never client-supplied — this is what prevents a vendor from writing outside their own resource's key prefix.
- A partial unique index enforces at most one `isPrimary=true` photo per hotel/room; the service layer must clear the old primary flag in the same transaction before setting a new one, or the second write hits the index and surfaces as a raw 500.
- Every task ends green on `pnpm --filter @staybangla/api run test:unit` and/or `test:e2e` before moving on. Docker services (`infra/docker/docker-compose.yml`) must be running (Postgres, Redis, **and MinIO** — this module is the first to actually depend on MinIO being up).
- Branch protection is active on `main` — every task's commits land on a feature branch; PR + green CI required before merge.

---

## File Structure

```
apps/api/
├── prisma/
│   ├── schema.prisma                                         [MODIFY: +District,+RoomType,+BedType,+FacilityCatalog enums; Hotel/Room/Vehicle field changes; +VendorVerificationLog,+HotelPhoto,+RoomPhoto]
│   └── migrations/<ts>_add_room_listing_enhancements/        [NEW]
├── .env, .env.example, .env.test                             [MODIFY: +MINIO_*, +PRESIGNED_URL_EXPIRY_SECONDS]
├── src/
│   ├── config/env.validation.ts                               [MODIFY]
│   ├── common/storage/
│   │   ├── storage.port.ts                                    [NEW]
│   │   ├── minio-storage.service.ts(+.spec)                   [NEW]
│   │   └── storage.module.ts                                  [NEW]
│   ├── hotels/
│   │   ├── dto/create-hotel.dto.ts                             [MODIFY]
│   │   ├── dto/create-room.dto.ts                              [MODIFY]
│   │   ├── dto/search-available-rooms.dto.ts                   [MODIFY]
│   │   ├── hotels.service.ts(+.spec)                           [MODIFY: +photo methods]
│   │   ├── hotels.controller.ts(+.spec)                        [MODIFY: +photo endpoints]
│   │   ├── rooms.service.ts(+.spec)                            [MODIFY: +photo methods]
│   │   ├── rooms.controller.ts(+.spec)                         [MODIFY: +photo endpoints]
│   │   └── hotels.module.ts                                    [MODIFY]
│   ├── vehicles/
│   │   ├── dto/create-vehicle.dto.ts                            [MODIFY]
│   │   └── dto/search-available-vehicles.dto.ts                 [MODIFY]
│   └── admin/
│       ├── admin.module.ts                                     [NEW]
│       ├── vendor-verification.service.ts(+.spec)              [NEW]
│       ├── vendor-verification.controller.ts(+.spec)           [NEW]
│       └── dto/reject-vendor.dto.ts                            [NEW]
└── test/
    ├── helpers/test-fixtures.ts                                 [MODIFY: fix inlined city/roomType, +photo/+admin helpers]
    ├── helpers/test-db.ts                                       [MODIFY: +new tables to cleanDatabase]
    ├── vendor-approval.e2e-spec.ts                              [NEW]
    └── room-listing-photos.e2e-spec.ts                          [NEW]
```

---

## Task 1: Env schema extension (MinIO + presigned-URL expiry)

**Files:** Modify `apps/api/src/config/env.validation.ts`, `apps/api/src/config/env.validation.spec.ts`, `apps/api/.env`, `apps/api/.env.example`, `apps/api/.env.test`, root `.env.example`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/config/env.validation.spec.ts` (inside the existing describe block, following the file's established pattern — check the file's actual `REQUIRED_BASE` object name before writing this, it must include all currently-required fields):

```ts
it("applies MinIO and presigned-URL defaults when not provided", () => {
  const result = validateEnv({
    ...REQUIRED_BASE,
    MINIO_ACCESS_KEY: "staybangla",
    MINIO_SECRET_KEY: "staybangla-secret",
  });
  expect(result.MINIO_ENDPOINT).toBe("127.0.0.1");
  expect(result.MINIO_PORT).toBe(9000);
  expect(result.MINIO_USE_SSL).toBe(false);
  expect(result.MINIO_BUCKET).toBe("staybangla-photos");
  expect(result.PRESIGNED_URL_EXPIRY_SECONDS).toBe(300);
});

it("throws when MINIO_ACCESS_KEY is missing", () => {
  const { MINIO_ACCESS_KEY: _omit, ...withoutKey } = {
    ...REQUIRED_BASE,
    MINIO_ACCESS_KEY: "x",
    MINIO_SECRET_KEY: "y",
  };
  expect(() => validateEnv(withoutKey)).toThrow(/MINIO_ACCESS_KEY/);
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation.spec.ts`
Expected: FAIL — `MINIO_ENDPOINT`/etc. undefined, no throw for missing key.

- [ ] **Step 3: Implement — extend the schema**

In `apps/api/src/config/env.validation.ts`, add inside `envSchema` (after `BOOKING_HOLD_MINUTES`):

```ts
  MINIO_ENDPOINT: z.string().default("127.0.0.1"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default("staybangla-photos"),
  PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- env.validation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update env files**

Append to `apps/api/.env`:

```
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=staybangla
MINIO_SECRET_KEY=staybangla-secret
MINIO_BUCKET=staybangla-photos
PRESIGNED_URL_EXPIRY_SECONDS=300
```

Append the same block (values as-is, they're dev-only defaults matching docker-compose, not secrets) to `apps/api/.env.example`, `apps/api/.env.test`, and root `.env.example`.

- [ ] **Step 6: Run full unit suite to confirm nothing else broke**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS, full suite green (this will fail to boot if any other test constructs env config without these new required fields — if so, check that file's mock env object and add the two required MinIO keys there too).

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/room-listing-enhancements
git add apps/api/src/config apps/api/.env.example .env.example
git commit -m "feat(api): add MinIO and presigned-URL env config"
```

---

## Task 2: Prisma schema — new enums, model changes, new models + migration

**Files:** Modify `apps/api/prisma/schema.prisma`; create migration.

- [ ] **Step 1: Add new enums to `schema.prisma`**

Append (after the existing `BookingStatus` enum, before `model Booking`):

```prisma
enum District {
  DHAKA
  CHATTOGRAM
  COXS_BAZAR
  RANGAMATI
  BANDARBAN
  KHAGRACHARI
  SYLHET
  SREEMANGAL
  SAINT_MARTIN
  KHULNA
  SUNDARBANS
  RAJSHAHI
  BARISHAL
  RANGPUR
  MYMENSINGH
  JESSORE
}

enum RoomType {
  SINGLE
  DOUBLE
  TWIN
  SUITE
  FAMILY
  DORMITORY
}

enum BedType {
  SINGLE
  TWIN
  DOUBLE
  QUEEN
  KING
  BUNK
}

enum FacilityCatalog {
  TRAVEL_DESK
  BATHTUB
  LAUNDRY_SERVICE
  WELCOME_DRINKS
  THEMED_NIGHTS
  ELEVATOR
  SMOKE_FREE
  SWIMMING_POOL
  PARKING
  GYM
  RESTAURANT
  ROOM_SERVICE
  WIFI
  AIR_CONDITIONING
  GENERATOR_BACKUP
  CCTV
}
```

- [ ] **Step 2: Modify `Hotel`, `Room`, `Vehicle` models**

In `model Hotel`, replace `city String` with `city District`, replace `amenities String[]` with `amenities FacilityCatalog[]`, and add two new fields plus a relation (insert after `starRating`):

```prisma
  checkInTime  String   @map("check_in_time")
  checkOutTime String   @map("check_out_time")
```

Add to the relations block (alongside `owner`, `rooms`):

```prisma
  photos HotelPhoto[]
```

In `model Room`, replace `roomType String @map("room_type")` with `roomType RoomType @map("room_type")`, and add three new fields (insert after `capacity`):

```prisma
  hasAC     Boolean  @map("has_ac")
  bedType   BedType  @map("bed_type")
  amenities String[]
```

Add to the relations block (alongside `hotel`, `bookings`):

```prisma
  photos RoomPhoto[]
```

In `model Vehicle`, replace `city String` with `city District`. No other Vehicle changes.

- [ ] **Step 3: Add `VendorVerificationLog`, `HotelPhoto`, `RoomPhoto` models**

Append after `model Vehicle` (before `model Booking`):

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

model HotelPhoto {
  id        String   @id @default(uuid())
  hotelId   String   @map("hotel_id")
  objectKey String   @map("object_key")
  isPrimary Boolean  @default(false) @map("is_primary")
  createdAt DateTime @default(now()) @map("created_at")

  hotel Hotel @relation(fields: [hotelId], references: [id], onDelete: Cascade)

  @@index([hotelId])
  @@map("hotel_photos")
}

model RoomPhoto {
  id        String   @id @default(uuid())
  roomId    String   @map("room_id")
  objectKey String   @map("object_key")
  isPrimary Boolean  @default(false) @map("is_primary")
  createdAt DateTime @default(now()) @map("created_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@index([roomId])
  @@map("room_photos")
}
```

- [ ] **Step 4: Add back-relations to `User`**

In `model User`, add to the relations block (alongside `roles`, `refreshTokens`, `ownedHotels`, `ownedVehicles`):

```prisma
  verificationLogsAsVendor VendorVerificationLog[] @relation("VendorVerificationTarget")
  verificationLogsAsAdmin  VendorVerificationLog[] @relation("VendorVerificationActor")
```

- [ ] **Step 5: Run `prisma validate`**

Run: `pnpm --filter @staybangla/api exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid".

- [ ] **Step 6: Generate migration SQL without applying**

```bash
pnpm --filter @staybangla/api exec prisma migrate dev --name add_room_listing_enhancements --create-only
```

Expected: creates `apps/api/prisma/migrations/<timestamp>_add_room_listing_enhancements/migration.sql`. Prisma will generate `DROP COLUMN`/`ADD COLUMN` for the `city`/`roomType`/`amenities` type changes by default (data-destructive) — this is what Step 7 must fix by hand before applying.

- [ ] **Step 7: Rewrite the destructive column-type changes as safe `USING`-cast `ALTER COLUMN` statements**

Open the generated `migration.sql`. Find the auto-generated statements for `hotels.city`, `hotels.amenities`, `rooms.room_type`, `vehicles.city` (they will likely appear as separate `DROP COLUMN` + `ADD COLUMN` pairs, or as `ALTER COLUMN ... TYPE` without a `USING` clause — read the actual generated file to see which). Replace them with:

```sql
ALTER TABLE "hotels" ALTER COLUMN "city" TYPE "District" USING ("city"::text::"District");
ALTER TABLE "hotels" ALTER COLUMN "amenities" TYPE "FacilityCatalog"[] USING (
  ARRAY(SELECT unnest("amenities")::text::"FacilityCatalog")
);
ALTER TABLE "rooms" ALTER COLUMN "room_type" TYPE "RoomType" USING ("room_type"::text::"RoomType");
ALTER TABLE "vehicles" ALTER COLUMN "city" TYPE "District" USING ("city"::text::"District");
```

There is no existing data in `staybangla`/`staybangla_test` yet (no vendor has shipped to production), so a cast failure here is not expected — but if `prisma migrate dev` fails with a cast error when applying (Step 9), it means some test/dev data has a `city`/`roomType` value that isn't a valid new enum member; truncate the affected table in the dev DB and retry rather than trying to "fix" the cast expression.

Ensure the `CREATE TYPE "District" AS ENUM (...)` / `"RoomType"` / `"BedType"` / `"FacilityCatalog"` statements (auto-generated by Prisma) appear **before** these `ALTER COLUMN` lines in the file — Prisma places `CREATE TYPE` statements near the top by default, so this should already be the case; just confirm by reading the file top-to-bottom.

- [ ] **Step 8: Append the new-column and new-table raw SQL, plus the primary-photo partial unique indexes**

At the end of `migration.sql`, add (Prisma will likely have already generated most of the `CREATE TABLE`/`ADD COLUMN` statements for `check_in_time`, `has_ac`, `bed_type`, `VendorVerificationLog`, `HotelPhoto`, `RoomPhoto` correctly, since those are pure additions, not type changes — verify they're present, and only add what's missing):

```sql
CREATE UNIQUE INDEX "hotel_photos_one_primary_per_hotel"
  ON "hotel_photos" ("hotel_id") WHERE ("is_primary" = true);
CREATE UNIQUE INDEX "room_photos_one_primary_per_room"
  ON "room_photos" ("room_id") WHERE ("is_primary" = true);
```

- [ ] **Step 9: Apply the migration and regenerate the client**

```bash
pnpm --filter @staybangla/api exec prisma migrate dev
pnpm --filter @staybangla/api exec prisma generate
```

Expected: applies cleanly. If a `USING` cast fails because of leftover dev data, truncate the specific table (`TRUNCATE "hotels" CASCADE;` etc.) in the dev DB via psql and retry — do not weaken the cast expression to "make the error go away."

- [ ] **Step 10: Verify the enum types and partial indexes exist**

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d hotels"
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U staybangla -d staybangla -c "\d hotel_photos"
```

Expected: `hotels.city` shows type `District`, `hotels.amenities` shows `FacilityCatalog[]`; `hotel_photos` indexes include `hotel_photos_one_primary_per_hotel` as a unique partial index.

- [ ] **Step 11: Migrate the test database**

```bash
pnpm --filter @staybangla/api exec dotenv -e .env.test -- prisma migrate deploy
```

- [ ] **Step 12: Typecheck to confirm the regenerated Prisma Client doesn't break existing application code**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Expected: FAILS — this is expected and correct. The regenerated Prisma types now require `District`/`RoomType`/`FacilityCatalog`/`hasAC`/`bedType`/`checkInTime`/`checkOutTime` wherever a `Hotel`/`Room`/`Vehicle` is created, and every DTO/service/test-fixture that used a plain `string` for `city`/`roomType`/`amenities` will now fail to compile. This is the exact list of call sites Tasks 3–9 fix. Do not attempt to fix them in this task — just confirm the compiler error list matches the "Existing files this module must also touch" list from the design doc (search-available DTOs, create DTOs, `hotels.service.ts`, `vehicles.service.ts`, `test-fixtures.ts`).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(api): add District/RoomType/BedType/FacilityCatalog enums, VendorVerificationLog/HotelPhoto/RoomPhoto models"
```

---

## Task 3: Fix existing DTOs and services broken by the enum migration

**Files:** Modify `apps/api/src/hotels/dto/create-hotel.dto.ts`, `apps/api/src/hotels/dto/create-room.dto.ts`, `apps/api/src/hotels/dto/search-available-rooms.dto.ts`, `apps/api/src/vehicles/dto/create-vehicle.dto.ts`, `apps/api/src/vehicles/dto/search-available-vehicles.dto.ts`, `apps/api/src/hotels/hotels.service.ts`, `apps/api/src/vehicles/vehicles.service.ts`.

This task exists purely to make the codebase compile again after Task 2's schema change — it adds the new Room attribute fields (`hasAC`, `bedType`, room-level `amenities`) at the same time since they touch the exact same DTOs.

**Interfaces:**

- Produces: `CreateHotelDto.city: District`, `CreateRoomDto.roomType: RoomType`, `CreateRoomDto.hasAC: boolean`, `CreateRoomDto.bedType: BedType`, `CreateRoomDto.amenities?: string[]`, `CreateVehicleDto.city: District`, `SearchAvailableRoomsDto.city?: District`, `SearchAvailableVehiclesDto.city?: District`.

- [ ] **Step 1: Write the failing test for `CreateHotelDto` validation**

`apps/api/src/hotels/dto/create-hotel.dto.spec.ts` (new file — this DTO had no dedicated spec before; add one now since it's gaining real enum-validation behavior worth testing):

```ts
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateHotelDto } from "./create-hotel.dto";

describe("CreateHotelDto", () => {
  it("accepts a valid District enum value for city", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid city value", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "Cox's Bazar",
      address: "Kolatoli Beach Road",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "city")).toBe(true);
  });

  it("accepts valid FacilityCatalog amenities", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
      amenities: ["WIFI", "SWIMMING_POOL"],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid amenity value", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
      amenities: ["Pool"],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "amenities")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- create-hotel.dto.spec.ts`
Expected: FAIL — `District`/`FacilityCatalog` not imported/used yet, `city`/`amenities` still validated as plain strings so the "rejects invalid" cases don't fail as expected.

- [ ] **Step 3: Implement `CreateHotelDto`**

Replace `apps/api/src/hotels/dto/create-hotel.dto.ts`:

```ts
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { District, FacilityCatalog } from "@prisma/client";

export class CreateHotelDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(District)
  city!: District;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(FacilityCatalog, { each: true })
  amenities?: FacilityCatalog[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @IsString()
  @IsNotEmpty()
  checkInTime!: string;

  @IsString()
  @IsNotEmpty()
  checkOutTime!: string;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- create-hotel.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `CreateRoomDto`**

`apps/api/src/hotels/dto/create-room.dto.spec.ts` (new):

```ts
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateRoomDto } from "./create-room.dto";

describe("CreateRoomDto", () => {
  const base = {
    roomType: "DOUBLE",
    pricePerNightMinor: 500000,
    capacity: 2,
    hasAC: true,
    bedType: "DOUBLE",
  };

  it("accepts a fully valid payload", async () => {
    const dto = plainToInstance(CreateRoomDto, base);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid roomType", async () => {
    const dto = plainToInstance(CreateRoomDto, {
      ...base,
      roomType: "MEGA_SUITE",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "roomType")).toBe(true);
  });

  it("rejects an invalid bedType", async () => {
    const dto = plainToInstance(CreateRoomDto, { ...base, bedType: "HAMMOCK" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "bedType")).toBe(true);
  });

  it("rejects a missing hasAC", async () => {
    const { hasAC: _omit, ...withoutAC } = base;
    const dto = plainToInstance(CreateRoomDto, withoutAC);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "hasAC")).toBe(true);
  });

  it("accepts optional amenities as a string array", async () => {
    const dto = plainToInstance(CreateRoomDto, {
      ...base,
      amenities: ["Balcony", "Sea View"],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run to confirm fail** → FAIL.

- [ ] **Step 7: Implement `CreateRoomDto`**

Replace `apps/api/src/hotels/dto/create-room.dto.ts`:

```ts
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { BedType, RoomType } from "@prisma/client";

export class CreateRoomDto {
  @IsEnum(RoomType)
  roomType!: RoomType;

  @IsInt()
  @Min(1)
  pricePerNightMinor!: number;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsBoolean()
  hasAC!: boolean;

  @IsEnum(BedType)
  bedType!: BedType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}
```

- [ ] **Step 8: Run to confirm pass** → PASS.

- [ ] **Step 9: `SearchAvailableRoomsDto`**

Read `apps/api/src/hotels/dto/search-available-rooms.dto.ts` first (from the prior module, uses `@IsDateString()`/`@IsOptional()`/`@IsString()` for `checkIn`/`checkOut`/`city`). Change only the `city` field:

```ts
import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { District } from "@prisma/client";

export class SearchAvailableRoomsDto {
  @IsDateString()
  checkIn!: string;

  @IsDateString()
  checkOut!: string;

  @IsOptional()
  @IsEnum(District)
  city?: District;
}
```

- [ ] **Step 10: `CreateVehicleDto` and `SearchAvailableVehiclesDto`**

In `apps/api/src/vehicles/dto/create-vehicle.dto.ts`, replace the `city` field:

```ts
  @IsEnum(District)
  city!: District;
```

(add `District` to the existing `@prisma/client` import, remove the now-unused `@IsString()` on `city` only — `category` keeps its existing `@IsIn([...])`.)

In `apps/api/src/vehicles/dto/search-available-vehicles.dto.ts`, same change as `SearchAvailableRoomsDto` above (replace `@IsOptional() @IsString() city?: string` with `@IsOptional() @IsEnum(District) city?: District`).

- [ ] **Step 11: Fix `HotelsService`**

In `apps/api/src/hotels/hotels.service.ts`, update `CreateHotelInput` and `RoomAvailability`:

```ts
import {
  Hotel,
  Prisma,
  District,
  FacilityCatalog,
  RoomType,
} from "@prisma/client";

export interface CreateHotelInput {
  name: string;
  city: District;
  address: string;
  description?: string;
  amenities?: FacilityCatalog[];
  starRating?: number;
  checkInTime: string;
  checkOutTime: string;
}

export interface RoomAvailability {
  id: string;
  hotelId: string;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
}
```

`searchAvailableRooms`'s signature changes its `city` parameter type only: `city?: District` (the `Prisma.sql` template body is unchanged — Postgres binds an enum value the same way it binds a string parameter).

- [ ] **Step 12: Fix `VehiclesService`**

In `apps/api/src/vehicles/vehicles.service.ts`, update `CreateVehicleInput` and `VehicleAvailability`:

```ts
import { Prisma, Vehicle, District } from "@prisma/client";

export interface CreateVehicleInput {
  category: "CNG" | "JEEP" | "BOAT";
  city: District;
  model?: string;
  capacity: number;
  pricePerDayMinor: number;
}

export interface VehicleAvailability {
  id: string;
  category: string;
  city: District;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
}
```

`searchAvailable`'s `city` parameter becomes `city?: District`.

- [ ] **Step 13: Run full unit suite**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: many existing tests in `hotels.service.spec.ts`, `hotels.controller.spec.ts`, `rooms.service.spec.ts`, `rooms.controller.spec.ts`, `vehicles.service.spec.ts`, `vehicles.controller.spec.ts` will now FAIL to compile — they construct `CreateHotelDto`/`CreateRoomDto`/`CreateVehicleDto` objects or `RoomAvailability`/`VehicleAvailability` fixtures with plain-string `city`/`roomType` values (e.g. `city: "Dhaka"`, `roomType: "DOUBLE"` as bare strings assigned to a now-enum-typed field). This is expected — Task 4 fixes them.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(api): update Hotel/Room/Vehicle DTOs and services for the new enum types and Room attributes"
```

---

## Task 4: Fix existing test files broken by the enum migration

**Files:** Modify every existing `*.spec.ts` under `apps/api/src/hotels/`, `apps/api/src/vehicles/` that constructs a `Hotel`/`Room`/`Vehicle`/DTO fixture with a plain string `city`/`roomType`/`amenities` value, plus `apps/api/test/helpers/test-fixtures.ts`.

This task has no new behavior of its own — it is the mechanical fix-up required to get back to a fully green, compiling test suite before adding any new functionality. Do this task by running the compiler and the test suite repeatedly and fixing what's broken, rather than guessing which files need changes in advance (the exact list depends on what Task 2/3 actually changed, which the plan cannot fully predict file-by-file since it was written before those tasks ran).

**Interfaces:**

- Consumes: `District`, `RoomType`, `BedType`, `FacilityCatalog` from `@prisma/client` (Task 2).
- Produces: a fully green `pnpm --filter @staybangla/api run test:unit` and `test:e2e`, ready for Task 5 onward to build on.

- [ ] **Step 1: Run `tsc --noEmit` and collect the full list of compile errors**

Run: `pnpm --filter @staybangla/api exec tsc --noEmit`
Read the full error list. Every error will be one of: (a) a test file passing a bare string where an enum is now required, (b) a test file's mock/fixture object missing new required fields (`hasAC`, `bedType`, `checkInTime`, `checkOutTime`).

- [ ] **Step 2: Fix each file's enum-typed string literals**

For every `city: "Dhaka"` (or similar), change to `city: "DHAKA" as const` or `city: District.DHAKA` if `District` is already imported in that file (prefer the enum member access — `District.DHAKA` — over a string literal with `as const`, for consistency and to catch typos at compile time). Same for `roomType: "DOUBLE"` → `roomType: RoomType.DOUBLE`, and any `amenities: ["Pool"]` on a `Hotel` fixture (not `Room`, whose `amenities` stays `string[]`) → `amenities: [FacilityCatalog.SWIMMING_POOL]`.

- [ ] **Step 3: Add the new required fields to `CreateHotelDto`/`CreateRoomDto` test fixtures**

Every test that builds a `CreateHotelDto`-shaped object needs `checkInTime`/`checkOutTime` added (e.g. `checkInTime: "14:00", checkOutTime: "11:00"`). Every test that builds a `CreateRoomDto`-shaped object needs `hasAC`/`bedType` added (e.g. `hasAC: true, bedType: BedType.DOUBLE`).

- [ ] **Step 4: Fix `apps/api/test/helpers/test-fixtures.ts`'s `createHotelWithRoom`**

This is the highest-impact fix — every existing e2e spec file uses this fixture. Replace the two `request(...).send({...})` bodies:

```ts
export async function createHotelWithRoom(
  app: INestApplication,
  vendorToken: string,
  overrides: Partial<{ pricePerNightMinor: number; capacity: number }> = {},
): Promise<{ hotelId: string; roomId: string }> {
  const hotel = await request(app.getHttpServer())
    .post("/hotels")
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({
      name: "Test Hotel",
      city: "DHAKA",
      address: "123 Test Road",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    });

  const room = await request(app.getHttpServer())
    .post(`/hotels/${hotel.body.id}/rooms`)
    .set("Authorization", `Bearer ${vendorToken}`)
    .send({
      roomType: "DOUBLE",
      pricePerNightMinor: overrides.pricePerNightMinor ?? 500000,
      capacity: overrides.capacity ?? 2,
      hasAC: true,
      bedType: "DOUBLE",
    });

  return { hotelId: hotel.body.id as string, roomId: room.body.id as string };
}
```

(These are DTO validation inputs sent over real HTTP, so they use the string literal enum values — `"DHAKA"`, `"DOUBLE"` — that `class-validator`'s `@IsEnum` accepts at the API boundary, not TypeScript enum-member access, which only exists inside compiled TS code, not JSON request bodies.)

- [ ] **Step 5: Run full unit suite, fix remaining failures iteratively**

Run: `pnpm --filter @staybangla/api run test:unit`
Fix any remaining compile or assertion failures one file at a time, re-running after each fix. Do not move to Step 6 until this is 100% green.

- [ ] **Step 6: Run full e2e suite, fix remaining failures iteratively**

Run: `pnpm --filter @staybangla/api run test:e2e`
Same iterative fix process. Pay particular attention to `test/booking-lifecycle.e2e-spec.ts`, `test/booking-ownership.e2e-spec.ts`, `test/booking-availability.e2e-spec.ts`, `test/booking-concurrency.e2e-spec.ts` — all depend on `createHotelWithRoom` and will break if Step 4's fixture fix has any mismatch with what the (now-enum-validated) DTOs actually require.

- [ ] **Step 7: Full monorepo verification**

Run: `pnpm typecheck && pnpm lint`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(api): update existing test fixtures for the new District/RoomType/BedType enums"
```

---

## Task 5: `StoragePort` + `MinioStorageService`

**Files:** Create `apps/api/src/common/storage/{storage.port.ts, minio-storage.service.ts(+.spec), storage.module.ts}`.

**Dependency:** `minio@^8.0.0` (the official MinIO JS SDK).

**Interfaces:**

- Produces: `StoragePort.getPresignedUploadUrl(objectKey: string, contentType: string): Promise<string>`, `StoragePort.deleteObject(objectKey: string): Promise<void>`, `StoragePort.ensureBucketExists(): Promise<void>`.

- [ ] **Step 1: Install**

```bash
pnpm --filter @staybangla/api add minio@^8.0.0
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/common/storage/minio-storage.service.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { MinioStorageService } from "./minio-storage.service";

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: "staybangla",
    MINIO_SECRET_KEY: "staybangla-secret",
    MINIO_BUCKET: "staybangla-photos",
    PRESIGNED_URL_EXPIRY_SECONDS: 300,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("MinioStorageService", () => {
  it("delegates getPresignedUploadUrl to the underlying MinIO client with the configured bucket and expiry", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      presignedPutObject: jest
        .fn()
        .mockResolvedValue("https://minio.local/signed-url"),
    };
    (service as unknown as { client: unknown }).client = client;

    const url = await service.getPresignedUploadUrl(
      "hotels/h1/photo.jpg",
      "image/jpeg",
    );

    expect(client.presignedPutObject).toHaveBeenCalledWith(
      "staybangla-photos",
      "hotels/h1/photo.jpg",
      300,
    );
    expect(url).toBe("https://minio.local/signed-url");
  });

  it("delegates deleteObject to the underlying MinIO client", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = { removeObject: jest.fn().mockResolvedValue(undefined) };
    (service as unknown as { client: unknown }).client = client;

    await service.deleteObject("hotels/h1/photo.jpg");

    expect(client.removeObject).toHaveBeenCalledWith(
      "staybangla-photos",
      "hotels/h1/photo.jpg",
    );
  });

  it("ensureBucketExists creates the bucket only if it doesn't already exist", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      bucketExists: jest.fn().mockResolvedValue(false),
      makeBucket: jest.fn().mockResolvedValue(undefined),
    };
    (service as unknown as { client: unknown }).client = client;

    await service.ensureBucketExists();

    expect(client.bucketExists).toHaveBeenCalledWith("staybangla-photos");
    expect(client.makeBucket).toHaveBeenCalledWith("staybangla-photos");
  });

  it("ensureBucketExists is a no-op when the bucket already exists", async () => {
    const service = new MinioStorageService(makeConfig());
    const client = {
      bucketExists: jest.fn().mockResolvedValue(true),
      makeBucket: jest.fn(),
    };
    (service as unknown as { client: unknown }).client = client;

    await service.ensureBucketExists();

    expect(client.makeBucket).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- minio-storage.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`apps/api/src/common/storage/storage.port.ts`:

```ts
export abstract class StoragePort {
  abstract getPresignedUploadUrl(
    objectKey: string,
    contentType: string,
  ): Promise<string>;
  abstract deleteObject(objectKey: string): Promise<void>;
  abstract ensureBucketExists(): Promise<void>;
}
```

`apps/api/src/common/storage/minio-storage.service.ts`:

```ts
import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";
import { StoragePort } from "./storage.port";

@Injectable()
export class MinioStorageService extends StoragePort implements OnModuleInit {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly expirySeconds: number;

  constructor(config: ConfigService) {
    super();
    this.client = new Client({
      endPoint: config.get<string>("MINIO_ENDPOINT", "127.0.0.1"),
      port: config.get<number>("MINIO_PORT", 9000),
      useSSL: config.get<boolean>("MINIO_USE_SSL", false),
      accessKey: config.get<string>("MINIO_ACCESS_KEY"),
      secretKey: config.get<string>("MINIO_SECRET_KEY"),
    });
    this.bucket = config.get<string>("MINIO_BUCKET", "staybangla-photos");
    this.expirySeconds = config.get<number>(
      "PRESIGNED_URL_EXPIRY_SECONDS",
      300,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async getPresignedUploadUrl(
    objectKey: string,
    _contentType: string,
  ): Promise<string> {
    return this.client.presignedPutObject(
      this.bucket,
      objectKey,
      this.expirySeconds,
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }
}
```

Note: `_contentType` is accepted but unused in this minimal implementation — MinIO's `presignedPutObject` doesn't take a content-type parameter directly (content-type enforcement would require `presignedPostPolicy` instead, which is out of scope for this task's minimal viable upload flow). Keep the parameter in the interface for forward-compatibility with a future stricter implementation, but mark it as intentionally unused (prefix with `_`) rather than silently dropping it from the interface.

`apps/api/src/common/storage/storage.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { StoragePort } from "./storage.port";
import { MinioStorageService } from "./minio-storage.service";

@Module({
  providers: [{ provide: StoragePort, useClass: MinioStorageService }],
  exports: [StoragePort],
})
export class StorageModule {}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- minio-storage.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add StoragePort/MinioStorageService for presigned photo uploads"
```

---

## Task 6: Photo endpoints on `HotelsService`/`HotelsController`

**Files:** Modify `apps/api/src/hotels/hotels.service.ts(+.spec)`, `apps/api/src/hotels/hotels.controller.ts(+.spec)`, `apps/api/src/hotels/hotels.module.ts`.

**Interfaces:**

- Consumes: `StoragePort` (Task 5).
- Produces: `HotelsService.presignPhotoUpload(callerId: string, hotelId: string, contentType: string): Promise<{ uploadUrl: string; objectKey: string }>`, `HotelsService.confirmPhoto(callerId: string, hotelId: string, objectKey: string, isPrimary: boolean): Promise<HotelPhoto>`, `HotelsService.deletePhoto(callerId: string, hotelId: string, photoId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/hotels/hotels.service.spec.ts` (add `storagePort: { getPresignedUploadUrl: jest.Mock; ensureBucketExists: jest.Mock }` and construct `service` with it as a third constructor arg in a new `describe` block — check the file's existing `beforeEach` pattern for how `prisma`/`usersService` mocks are built, and follow the same shape):

```ts
describe("HotelsService photo methods", () => {
  let prisma: {
    hotel: { findUnique: jest.Mock };
    hotelPhoto: {
      create: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let storagePort: {
    getPresignedUploadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let service: HotelsService;

  beforeEach(() => {
    prisma = {
      hotel: { findUnique: jest.fn() },
      hotelPhoto: {
        create: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    storagePort = {
      getPresignedUploadUrl: jest
        .fn()
        .mockResolvedValue("https://minio.local/signed"),
      deleteObject: jest.fn(),
    };
    service = new HotelsService(
      prisma as unknown as PrismaService,
      {} as never,
      storagePort as never,
    );
  });

  describe("presignPhotoUpload", () => {
    it("returns a presigned URL and a server-generated objectKey scoped to the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });

      const result = await service.presignPhotoUpload("v1", "h1", "image/jpeg");

      expect(result.objectKey).toMatch(/^hotels\/h1\/.+\.jpg$/);
      expect(result.uploadUrl).toBe("https://minio.local/signed");
      expect(storagePort.getPresignedUploadUrl).toHaveBeenCalledWith(
        result.objectKey,
        "image/jpeg",
      );
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.presignPhotoUpload("v1", "h1", "image/jpeg"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("confirmPhoto", () => {
    it("creates a HotelPhoto row, not primary by default", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.create.mockResolvedValue({
        id: "p1",
        hotelId: "h1",
        isPrimary: false,
      });

      const result = await service.confirmPhoto(
        "v1",
        "h1",
        "hotels/h1/x.jpg",
        false,
      );

      expect(prisma.hotelPhoto.create).toHaveBeenCalledWith({
        data: { hotelId: "h1", objectKey: "hotels/h1/x.jpg", isPrimary: false },
      });
      expect(result.isPrimary).toBe(false);
    });

    it("clears the existing primary photo before setting a new one when isPrimary=true", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.create.mockResolvedValue({
        id: "p2",
        hotelId: "h1",
        isPrimary: true,
      });

      await service.confirmPhoto("v1", "h1", "hotels/h1/y.jpg", true);

      expect(prisma.hotelPhoto.updateMany).toHaveBeenCalledWith({
        where: { hotelId: "h1", isPrimary: true },
        data: { isPrimary: false },
      });
      expect(prisma.hotelPhoto.create).toHaveBeenCalledWith({
        data: { hotelId: "h1", objectKey: "hotels/h1/y.jpg", isPrimary: true },
      });
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(
        service.confirmPhoto("v1", "h1", "hotels/h1/x.jpg", false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deletePhoto", () => {
    it("deletes the storage object and the DB row when the caller owns the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.findUnique.mockResolvedValue({
        id: "p1",
        hotelId: "h1",
        objectKey: "hotels/h1/x.jpg",
      });

      await service.deletePhoto("v1", "h1", "p1");

      expect(storagePort.deleteObject).toHaveBeenCalledWith("hotels/h1/x.jpg");
      expect(prisma.hotelPhoto.delete).toHaveBeenCalledWith({
        where: { id: "p1" },
      });
    });

    it("throws NotFoundException when the photo doesn't exist", async () => {
      prisma.hotel.findUnique.mockResolvedValue({ id: "h1", ownerId: "v1" });
      prisma.hotelPhoto.findUnique.mockResolvedValue(null);
      await expect(service.deletePhoto("v1", "h1", "missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects when the caller does not own the hotel", async () => {
      prisma.hotel.findUnique.mockResolvedValue({
        id: "h1",
        ownerId: "someone-else",
      });
      await expect(service.deletePhoto("v1", "h1", "p1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service.spec.ts`
Expected: FAIL — new methods don't exist, constructor now takes 3 args.

- [ ] **Step 3: Implement — add to `HotelsService`**

Add `StoragePort` to the constructor and add the three methods:

```ts
import { randomUUID } from "node:crypto";
import { HotelPhoto } from "@prisma/client";
import { StoragePort } from "../common/storage/storage.port";

@Injectable()
export class HotelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly storagePort: StoragePort,
  ) {}

  // ...existing methods unchanged...

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    return map[contentType] ?? "jpg";
  }

  async presignPhotoUpload(
    callerId: string,
    hotelId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    const ext = this.extensionFromContentType(contentType);
    const objectKey = `hotels/${hotelId}/${randomUUID()}.${ext}`;
    const uploadUrl = await this.storagePort.getPresignedUploadUrl(
      objectKey,
      contentType,
    );
    return { uploadUrl, objectKey };
  }

  async confirmPhoto(
    callerId: string,
    hotelId: string,
    objectKey: string,
    isPrimary: boolean,
  ): Promise<HotelPhoto> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    if (isPrimary) {
      await this.prisma.hotelPhoto.updateMany({
        where: { hotelId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return this.prisma.hotelPhoto.create({
      data: { hotelId, objectKey, isPrimary },
    });
  }

  async deletePhoto(
    callerId: string,
    hotelId: string,
    photoId: string,
  ): Promise<void> {
    const hotel = await this.findByIdOrThrow(hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    const photo = await this.prisma.hotelPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new NotFoundException("Photo not found");
    await this.storagePort.deleteObject(photo.objectKey);
    await this.prisma.hotelPhoto.delete({ where: { id: photoId } });
  }
}
```

Note: `confirmPhoto`'s `updateMany`-then-`create` is NOT wrapped in an explicit `$transaction` in this minimal version — a crash between the two calls would leave zero primary photos (safe, recoverable state) rather than two primaries (which the partial unique index would reject anyway at the DB level as a hard backstop). This is an accepted simplification; if a future task adds stricter atomicity requirements, wrap both calls in `this.prisma.$transaction([...])`.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service.spec.ts`
Expected: PASS. This will also break every OTHER existing test in this file and `hotels.controller.spec.ts` that constructs `new HotelsService(prisma, usersService)` with only 2 args — fix those call sites now by adding a third mock arg (`{} as never` is sufficient for tests that don't exercise photo methods).

- [ ] **Step 5: Write the failing controller tests**

Append to `apps/api/src/hotels/hotels.controller.spec.ts`:

```ts
describe("photo endpoints", () => {
  it("presignPhoto() delegates with the caller's id", async () => {
    hotelsService.presignPhotoUpload.mockResolvedValue({
      uploadUrl: "https://x",
      objectKey: "hotels/h1/y.jpg",
    });
    const result = await controller.presignPhoto(
      { id: "v1", roles: ["VENDOR"] },
      "h1",
      { contentType: "image/jpeg" },
    );
    expect(hotelsService.presignPhotoUpload).toHaveBeenCalledWith(
      "v1",
      "h1",
      "image/jpeg",
    );
    expect(result.objectKey).toBe("hotels/h1/y.jpg");
  });

  it("confirmPhoto() delegates with the caller's id", async () => {
    hotelsService.confirmPhoto.mockResolvedValue({ id: "p1", isPrimary: true });
    await controller.confirmPhoto({ id: "v1", roles: ["VENDOR"] }, "h1", {
      objectKey: "hotels/h1/y.jpg",
      isPrimary: true,
    });
    expect(hotelsService.confirmPhoto).toHaveBeenCalledWith(
      "v1",
      "h1",
      "hotels/h1/y.jpg",
      true,
    );
  });

  it("deletePhoto() delegates with the caller's id", async () => {
    await controller.deletePhoto({ id: "v1", roles: ["VENDOR"] }, "h1", "p1");
    expect(hotelsService.deletePhoto).toHaveBeenCalledWith("v1", "h1", "p1");
  });
});
```

Also add `presignPhotoUpload: jest.fn(), confirmPhoto: jest.fn(), deletePhoto: jest.fn()` to the existing `hotelsService` mock object in `beforeEach`.

- [ ] **Step 6: Run to confirm fail** → FAIL.

- [ ] **Step 7: Create the photo DTOs and implement `HotelsController`**

`apps/api/src/hotels/dto/presign-photo.dto.ts`:

```ts
import { IsIn } from "class-validator";

export class PresignPhotoDto {
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  contentType!: "image/jpeg" | "image/png" | "image/webp";
}
```

`apps/api/src/hotels/dto/confirm-photo.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ConfirmPhotoDto {
  @IsString()
  objectKey!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
```

Add to `apps/api/src/hotels/hotels.controller.ts`:

```ts
import { HotelPhoto } from "@prisma/client";
import { PresignPhotoDto } from "./dto/presign-photo.dto";
import { ConfirmPhotoDto } from "./dto/confirm-photo.dto";

  @Post(":id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.hotelsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @Post(":id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<HotelPhoto> {
    return this.hotelsService.confirmPhoto(user.id, id, dto.objectKey, dto.isPrimary ?? false);
  }

  @Delete(":id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.hotelsService.deletePhoto(user.id, id, photoId);
  }
```

(Add `Delete` to the existing `@nestjs/common` import list.)

- [ ] **Step 8: Wire `StorageModule` into `HotelsModule`**

`apps/api/src/hotels/hotels.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { StorageModule } from "../common/storage/storage.module";
import { HotelsService } from "./hotels.service";
import { HotelsController } from "./hotels.controller";
import { RoomsService } from "./rooms.service";
import { RoomsController } from "./rooms.controller";

@Module({
  imports: [UsersModule, StorageModule],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService, RoomsService],
})
export class HotelsModule {}
```

- [ ] **Step 9: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: full suite PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add hotel photo presign/confirm/delete endpoints"
```

---

## Task 7: Photo endpoints on `RoomsService`/`RoomsController`

**Files:** Modify `apps/api/src/hotels/rooms.service.ts(+.spec)`, `apps/api/src/hotels/rooms.controller.ts(+.spec)`.

This mirrors Task 6 exactly, one level down (Room instead of Hotel, ownership routed through the parent Hotel exactly as `RoomsService.update` already does).

**Interfaces:**

- Consumes: `StoragePort` (Task 5), `HotelsService.findByIdOrThrow` (existing).
- Produces: `RoomsService.presignPhotoUpload(callerId, roomId, contentType): Promise<{uploadUrl, objectKey}>`, `RoomsService.confirmPhoto(callerId, roomId, objectKey, isPrimary): Promise<RoomPhoto>`, `RoomsService.deletePhoto(callerId, roomId, photoId): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/hotels/rooms.service.spec.ts` a `describe("RoomsService photo methods", ...)` block, structurally identical to Task 6 Step 1's tests but substituting: `prisma.room.findUnique` (not `prisma.hotel.findUnique`) returning `{ id: "r1", hotelId: "h1" }`, `hotelsService.findByIdOrThrow` (mocked) returning `{ id: "h1", ownerId: "v1" }` for the ownership check (matching the existing `RoomsService.update` pattern of routing ownership through the parent Hotel), and `prisma.roomPhoto.{create,updateMany,delete,findUnique}` instead of `hotelPhoto`. `objectKey` pattern: `rooms/{roomId}/{uuid}.{ext}`.

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement — add to `RoomsService`**

```ts
import { randomUUID } from "node:crypto";
import { RoomPhoto } from "@prisma/client";
import { StoragePort } from "../common/storage/storage.port";

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hotelsService: HotelsService,
    private readonly storagePort: StoragePort,
  ) {}

  // ...existing create/update unchanged...

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    return map[contentType] ?? "jpg";
  }

  private async assertOwnsRoom(
    callerId: string,
    roomId: string,
  ): Promise<{ id: string; hotelId: string }> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Room not found");
    const hotel = await this.hotelsService.findByIdOrThrow(room.hotelId);
    if (hotel.ownerId !== callerId) {
      throw new ForbiddenException("You do not own this hotel");
    }
    return room;
  }

  async presignPhotoUpload(
    callerId: string,
    roomId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    await this.assertOwnsRoom(callerId, roomId);
    const ext = this.extensionFromContentType(contentType);
    const objectKey = `rooms/${roomId}/${randomUUID()}.${ext}`;
    const uploadUrl = await this.storagePort.getPresignedUploadUrl(
      objectKey,
      contentType,
    );
    return { uploadUrl, objectKey };
  }

  async confirmPhoto(
    callerId: string,
    roomId: string,
    objectKey: string,
    isPrimary: boolean,
  ): Promise<RoomPhoto> {
    await this.assertOwnsRoom(callerId, roomId);
    if (isPrimary) {
      await this.prisma.roomPhoto.updateMany({
        where: { roomId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return this.prisma.roomPhoto.create({
      data: { roomId, objectKey, isPrimary },
    });
  }

  async deletePhoto(
    callerId: string,
    roomId: string,
    photoId: string,
  ): Promise<void> {
    await this.assertOwnsRoom(callerId, roomId);
    const photo = await this.prisma.roomPhoto.findUnique({
      where: { id: photoId },
    });
    if (!photo) throw new NotFoundException("Photo not found");
    await this.storagePort.deleteObject(photo.objectKey);
    await this.prisma.roomPhoto.delete({ where: { id: photoId } });
  }
}
```

- [ ] **Step 4: Run to confirm pass, fix the two-arg constructor call sites in existing tests (same as Task 6 Step 4)** → PASS.

- [ ] **Step 5: Write failing controller tests and implement `RoomsController`'s photo endpoints**

Same structure as Task 6 Steps 5–7, with routes `POST hotels/:hotelId/rooms/:id/photos/presign` — actually, simpler: mirror the existing `RoomsController`'s `PATCH rooms/:id` route shape (top-level `rooms/:id`, not nested under `hotels/:hotelId`), since a room's id is already globally unique and the existing `update` endpoint uses this shape:

```ts
  @Post("rooms/:id/photos/presign")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async presignPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: PresignPhotoDto,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    return this.roomsService.presignPhotoUpload(user.id, id, dto.contentType);
  }

  @Post("rooms/:id/photos/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async confirmPhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: ConfirmPhotoDto,
  ): Promise<RoomPhoto> {
    return this.roomsService.confirmPhoto(user.id, id, dto.objectKey, dto.isPrimary ?? false);
  }

  @Delete("rooms/:id/photos/:photoId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async deletePhoto(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("photoId") photoId: string,
  ): Promise<void> {
    return this.roomsService.deletePhoto(user.id, id, photoId);
  }
```

(Reuse the same `PresignPhotoDto`/`ConfirmPhotoDto` from Task 6 — import from `./dto/presign-photo.dto` / `./dto/confirm-photo.dto`, don't duplicate them. Add `RoomPhoto` to the `@prisma/client` import and `Delete` to the `@nestjs/common` import in `rooms.controller.ts`.)

- [ ] **Step 6: `HotelsModule` already imports `StorageModule` (Task 6) — `RoomsController`/`RoomsService` are in the same module, so no additional module wiring needed.**

- [ ] **Step 7: Run full unit suite**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add room photo presign/confirm/delete endpoints"
```

---

## Task 8: `VendorVerificationService` — approve/reject/resubmit core logic

**Files:** Create `apps/api/src/admin/vendor-verification.service.ts(+.spec)`, `apps/api/src/admin/dto/reject-vendor.dto.ts`.

**Interfaces:**

- Produces: `VendorVerificationService.listPending(): Promise<User[]>`, `VendorVerificationService.approve(adminId: string, vendorId: string): Promise<User>`, `VendorVerificationService.reject(adminId: string, vendorId: string, reason: string): Promise<User>`, `VendorVerificationService.getHistory(vendorId: string): Promise<VendorVerificationLog[]>`, `VendorVerificationService.resubmit(vendorId: string): Promise<User>`.

- [ ] **Step 1: DTO**

`apps/api/src/admin/dto/reject-vendor.dto.ts`:

```ts
import { IsNotEmpty, IsString } from "class-validator";

export class RejectVendorDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/admin/vendor-verification.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorVerificationService } from "./vendor-verification.service";

describe("VendorVerificationService", () => {
  let prisma: {
    user: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
    };
    vendorVerificationLog: { create: jest.Mock; findMany: jest.Mock };
  };
  let service: VendorVerificationService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
      },
      vendorVerificationLog: { create: jest.fn(), findMany: jest.fn() },
    };
    service = new VendorVerificationService(prisma as unknown as PrismaService);
  });

  describe("listPending", () => {
    it("returns users with verifiedStatus=PENDING", async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: "v1", verifiedStatus: "PENDING" },
      ]);
      const result = await service.listPending();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { verifiedStatus: "PENDING" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("approve", () => {
    it("flips PENDING to VERIFIED and logs the action", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });

      const result = await service.approve("admin1", "v1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "PENDING" },
        data: { verifiedStatus: "VERIFIED" },
      });
      expect(prisma.vendorVerificationLog.create).toHaveBeenCalledWith({
        data: {
          vendorId: "v1",
          adminId: "admin1",
          action: "VERIFIED",
          reason: undefined,
        },
      });
      expect(result.verifiedStatus).toBe("VERIFIED");
    });

    it("throws ConflictException when the vendor is not currently PENDING", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve("admin1", "v1")).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.vendorVerificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe("reject", () => {
    it("flips PENDING to REJECTED and logs the reason", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });

      const result = await service.reject(
        "admin1",
        "v1",
        "NID document unclear",
      );

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "PENDING" },
        data: { verifiedStatus: "REJECTED" },
      });
      expect(prisma.vendorVerificationLog.create).toHaveBeenCalledWith({
        data: {
          vendorId: "v1",
          adminId: "admin1",
          action: "REJECTED",
          reason: "NID document unclear",
        },
      });
      expect(result.verifiedStatus).toBe("REJECTED");
    });

    it("throws ConflictException when the vendor is not currently PENDING", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject("admin1", "v1", "reason")).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("getHistory", () => {
    it("returns the log rows for a vendor, newest first", async () => {
      prisma.vendorVerificationLog.findMany.mockResolvedValue([{ id: "log1" }]);
      const result = await service.getHistory("v1");
      expect(prisma.vendorVerificationLog.findMany).toHaveBeenCalledWith({
        where: { vendorId: "v1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("resubmit", () => {
    it("flips REJECTED to PENDING", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "REJECTED",
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });

      const result = await service.resubmit("v1");

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: "v1", verifiedStatus: "REJECTED" },
        data: { verifiedStatus: "PENDING" },
      });
      expect(result.verifiedStatus).toBe("PENDING");
    });

    it("is an idempotent no-op when already PENDING", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "PENDING",
      });
      const result = await service.resubmit("v1");
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(result.verifiedStatus).toBe("PENDING");
    });

    it("is an idempotent no-op when already VERIFIED", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "v1",
        verifiedStatus: "VERIFIED",
      });
      const result = await service.resubmit("v1");
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(result.verifiedStatus).toBe("VERIFIED");
    });

    it("throws NotFoundException for a missing user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resubmit("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`apps/api/src/admin/vendor-verification.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { User, VendorVerificationLog } from "@prisma/client";
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
    await this.prisma.vendorVerificationLog.create({
      data: { vendorId, adminId, action: "VERIFIED", reason: undefined },
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
    await this.prisma.vendorVerificationLog.create({
      data: { vendorId, adminId, action: "REJECTED", reason },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }

  async getHistory(vendorId: string): Promise<VendorVerificationLog[]> {
    return this.prisma.vendorVerificationLog.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
    });
  }

  async resubmit(vendorId: string): Promise<User> {
    const vendor = await this.prisma.user.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException("User not found");

    if (vendor.verifiedStatus !== "REJECTED") {
      return vendor; // idempotent no-op: already PENDING or VERIFIED
    }

    await this.prisma.user.updateMany({
      where: { id: vendorId, verifiedStatus: "REJECTED" },
      data: { verifiedStatus: "PENDING" },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id: vendorId } });
  }
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): add VendorVerificationService with guarded approve/reject/resubmit"
```

---

## Task 9: `VendorVerificationController` + `AdminModule`

**Files:** Create `apps/api/src/admin/vendor-verification.controller.ts(+.spec)`, `apps/api/src/admin/admin.module.ts`. Modify `apps/api/src/users/users.controller.ts(+.spec)` (for the `/vendors/me/resubmit` route — see note below), `apps/api/src/app.module.ts`.

**Interfaces:**

- Consumes: `VendorVerificationService` (Task 8).

- [ ] **Step 1: Write the failing controller test**

`apps/api/src/admin/vendor-verification.controller.spec.ts`:

```ts
import { Test } from "@nestjs/testing";
import { VendorVerificationController } from "./vendor-verification.controller";
import { VendorVerificationService } from "./vendor-verification.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("VendorVerificationController", () => {
  let controller: VendorVerificationController;
  let service: {
    listPending: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    getHistory: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listPending: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      getHistory: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VendorVerificationController],
      providers: [{ provide: VendorVerificationService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorVerificationController);
  });

  it("listPending() delegates to the service", async () => {
    service.listPending.mockResolvedValue([{ id: "v1" }]);
    const result = await controller.listPending();
    expect(result).toEqual([{ id: "v1" }]);
  });

  it("approve() passes the admin's id and vendor id", async () => {
    service.approve.mockResolvedValue({ id: "v1", verifiedStatus: "VERIFIED" });
    await controller.approve({ id: "admin1", roles: ["ADMIN"] }, "v1");
    expect(service.approve).toHaveBeenCalledWith("admin1", "v1");
  });

  it("reject() passes the admin's id, vendor id, and reason", async () => {
    service.reject.mockResolvedValue({ id: "v1", verifiedStatus: "REJECTED" });
    await controller.reject({ id: "admin1", roles: ["ADMIN"] }, "v1", {
      reason: "bad docs",
    });
    expect(service.reject).toHaveBeenCalledWith("admin1", "v1", "bad docs");
  });

  it("getHistory() passes the vendor id", async () => {
    service.getHistory.mockResolvedValue([{ id: "log1" }]);
    await controller.getHistory("v1");
    expect(service.getHistory).toHaveBeenCalledWith("v1");
  });
});
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement**

`apps/api/src/admin/vendor-verification.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { User, VendorVerificationLog } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VendorVerificationService } from "./vendor-verification.service";
import { RejectVendorDto } from "./dto/reject-vendor.dto";

@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorVerificationController {
  constructor(
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @Get("pending")
  async listPending(): Promise<User[]> {
    return this.vendorVerificationService.listPending();
  }

  @Post(":id/approve")
  async approve(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<User> {
    return this.vendorVerificationService.approve(admin.id, id);
  }

  @Post(":id/reject")
  async reject(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
    @Body() dto: RejectVendorDto,
  ): Promise<User> {
    return this.vendorVerificationService.reject(admin.id, id, dto.reason);
  }

  @Get(":id/history")
  async getHistory(@Param("id") id: string): Promise<VendorVerificationLog[]> {
    return this.vendorVerificationService.getHistory(id);
  }
}
```

- [ ] **Step 4: `AdminModule`**

`apps/api/src/admin/admin.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { VendorVerificationService } from "./vendor-verification.service";
import { VendorVerificationController } from "./vendor-verification.controller";

@Module({
  controllers: [VendorVerificationController],
  providers: [VendorVerificationService],
  exports: [VendorVerificationService],
})
export class AdminModule {}
```

- [ ] **Step 5: Add `/vendors/me/resubmit` to `UsersController`**

This route belongs on `UsersController` (not `AdminModule`) since it's a self-service action a vendor takes on their own account — matching the existing `/users/me` self-only pattern, not an admin-privileged one. Add to `apps/api/src/users/users.controller.ts`:

```ts
import { Post } from "@nestjs/common"; // add to existing import list
import { VendorVerificationService } from "../admin/vendor-verification.service";

// add to constructor:
  constructor(
    private readonly usersService: UsersService,
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @Post("me/resubmit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  async resubmit(@CurrentUser() user: RequestUser): Promise<PublicUser> {
    const updated = await this.vendorVerificationService.resubmit(user.id);
    return toPublicUser(updated);
  }
```

Write the failing test first, in `apps/api/src/users/users.controller.spec.ts` (add `vendorVerificationService: { resubmit: jest.Mock }` to the test module's providers, matching how `usersService` is already mocked there):

```ts
it("resubmit() delegates to VendorVerificationService with the caller's id", async () => {
  vendorVerificationService.resubmit.mockResolvedValue({
    id: "v1",
    verifiedStatus: "PENDING",
    passwordHash: "x",
  });
  const result = await controller.resubmit({ id: "v1", roles: ["VENDOR"] });
  expect(vendorVerificationService.resubmit).toHaveBeenCalledWith("v1");
  expect(result).not.toHaveProperty("passwordHash");
});
```

Run this test first (Step 2 pattern) to confirm it fails before adding the controller method — then confirm it passes.

Update `apps/api/src/users/users.module.ts` to import `AdminModule` (for `VendorVerificationService`) — but `AdminModule` doesn't export anything `UsersModule` needs to import in a circular way, so instead export `VendorVerificationService` directly usable: add `AdminModule` to `UsersModule`'s `imports` array (this creates `UsersModule → AdminModule` as a one-way dependency, which is fine since `AdminModule` doesn't import `UsersModule`).

- [ ] **Step 6: Wire `AdminModule` into `AppModule`**

In `apps/api/src/app.module.ts`, add:

```ts
import { AdminModule } from "./admin/admin.module";
// add AdminModule to the imports array, alongside HotelsModule/VehiclesModule/BookingsModule
```

- [ ] **Step 7: Run full unit + e2e suite**

Run: `pnpm --filter @staybangla/api run test:unit && pnpm --filter @staybangla/api run test:e2e`
Expected: both green — the e2e run is the real test of whether the `UsersModule ← AdminModule` wiring boots correctly.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add admin vendor-approval endpoints and /vendors/me/resubmit"
```

---

## Task 10: e2e fixtures for admin/vendor-approval flow

**Files:** Modify `apps/api/test/helpers/test-fixtures.ts`, `apps/api/test/helpers/test-db.ts`.

**Interfaces:**

- Produces: `createAdmin(app: INestApplication, email: string): Promise<{ adminId: string; accessToken: string }>` (mirrors `createTraveler`'s direct-Prisma-insert-plus-mint-JWT pattern, since there's no HTTP-facing way to create an ADMIN either).

- [ ] **Step 1: Add `createAdmin` to `test-fixtures.ts`**

```ts
export async function createAdmin(
  app: INestApplication,
  email: string,
): Promise<{ adminId: string; accessToken: string }> {
  const user = await testPrisma.user.create({
    data: {
      email,
      fullName: "Test Admin",
      verifiedStatus: "VERIFIED",
      roles: { create: [{ role: "ADMIN" }] },
    },
  });

  const tokenService = app.get(TokenService);
  const { accessToken } = await tokenService.issueTokenPair({
    id: user.id,
    roles: ["ADMIN"],
  });

  return { adminId: user.id, accessToken };
}
```

(`TokenService` is already imported in this file from Task 19's `createTraveler` addition — no new import needed.)

- [ ] **Step 2: Update `cleanDatabase()` to clear the new tables**

`apps/api/test/helpers/test-db.ts` — add before the existing `user.deleteMany()` call (FK-safe order: photos before their parent hotel/room, verification logs before the users they reference):

```ts
export async function cleanDatabase(): Promise<void> {
  await testPrisma.hotelPhoto.deleteMany();
  await testPrisma.roomPhoto.deleteMany();
  await testPrisma.vendorVerificationLog.deleteMany();
  await testPrisma.booking.deleteMany();
  await testPrisma.room.deleteMany();
  await testPrisma.vehicle.deleteMany();
  await testPrisma.hotel.deleteMany();
  await testPrisma.refreshToken.deleteMany();
  await testPrisma.userRole.deleteMany();
  await testPrisma.user.deleteMany();
}
```

- [ ] **Step 3: Verify via a real e2e run**

There's no dedicated test for a pure helper-file change, but every existing e2e spec calls `cleanDatabase()` — run the full suite to confirm the new deletions don't break FK ordering:

Run: `pnpm --filter @staybangla/api run test:e2e`
Expected: PASS, all suites green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): add createAdmin e2e fixture, clear new tables in cleanDatabase"
```

---

## Task 11: e2e — vendor approval flow

**Files:** Create `apps/api/test/vendor-approval.e2e-spec.ts`.

- [ ] **Step 1: Implement**

```ts
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "src/app.module";
import { configureApp } from "src/bootstrap/configure-app";
import { cleanDatabase } from "./helpers/test-db";
import { registerAndLogin } from "./helpers/test-users";
import { createAdmin } from "./helpers/test-fixtures";

describe("Vendor approval (e2e)", () => {
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

  it("a newly registered vendor appears in the admin's pending list", async () => {
    const { adminId: _adminId, accessToken: adminToken } = await createAdmin(
      app,
      "admin1@example.com",
    );
    await registerAndLogin(app, "pending-vendor@example.com");

    const res = await request(app.getHttpServer())
      .get("/admin/vendors/pending")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(
      res.body.some(
        (v: { email: string }) => v.email === "pending-vendor@example.com",
      ),
    ).toBe(true);
  });

  it("admin approves a pending vendor, who can then create a hotel", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin2@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "approve-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const approve = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.verifiedStatus).toBe("VERIFIED");

    const createHotel = await request(app.getHttpServer())
      .post("/hotels")
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({
        name: "Approved Hotel",
        city: "COXS_BAZAR",
        address: "Beach Road",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      });
    expect(createHotel.status).toBe(201);
  });

  it("admin rejects a pending vendor with a reason, recorded in history", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin3@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "reject-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    const reject = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "NID document unclear" });
    expect(reject.status).toBe(201);
    expect(reject.body.verifiedStatus).toBe("REJECTED");

    const history = await request(app.getHttpServer())
      .get(`/admin/vendors/${me.body.id}/history`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].reason).toBe("NID document unclear");
    expect(history.body[0].action).toBe("REJECTED");
  });

  it("a rejected vendor can resubmit and becomes PENDING again", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin4@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "resubmit-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "incomplete profile" });

    const resubmit = await request(app.getHttpServer())
      .post("/vendors/me/resubmit")
      .set("Authorization", `Bearer ${vendorToken}`);

    expect(resubmit.status).toBe(201);
    expect(resubmit.body.verifiedStatus).toBe("PENDING");
  });

  it("a non-admin cannot access /admin/vendors/pending", async () => {
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "sneaky-vendor@example.com",
    );
    const res = await request(app.getHttpServer())
      .get("/admin/vendors/pending")
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(res.status).toBe(403);
  });

  it("rejecting an already-VERIFIED vendor returns 409 (guarded transition)", async () => {
    const { accessToken: adminToken } = await createAdmin(
      app,
      "admin5@example.com",
    );
    const { accessToken: vendorToken } = await registerAndLogin(
      app,
      "double-vendor@example.com",
    );
    const me = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${vendorToken}`);

    await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    const secondReject = await request(app.getHttpServer())
      .post(`/admin/vendors/${me.body.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "changed my mind" });

    expect(secondReject.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- vendor-approval`
Expected: PASS, 6/6 tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(api): add e2e coverage for the vendor approval flow"
```

---

## Task 12: e2e — room/hotel photo upload flow

**Files:** Create `apps/api/test/room-listing-photos.e2e-spec.ts`.

**Note on MinIO in tests:** this is the first e2e coverage that requires the real MinIO container (not just Postgres/Redis) to be running. Docker services must be confirmed healthy including MinIO before running this task's tests.

- [ ] **Step 1: Implement**

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

describe("Room/hotel photo upload (e2e)", () => {
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

  it("full happy path: presign -> upload to MinIO -> confirm -> appears as primary", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    const presign = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    expect(presign.status).toBe(201);
    expect(presign.body.uploadUrl).toEqual(expect.any(String));
    expect(presign.body.objectKey).toMatch(
      new RegExp(`^hotels/${hotelId}/.+\\.jpg$`),
    );

    // Real upload to the presigned URL, proving MinIO round-trips correctly.
    const fakeImageBytes = Buffer.from("fake-jpeg-bytes");
    const uploadRes = await fetch(presign.body.uploadUrl, {
      method: "PUT",
      body: fakeImageBytes,
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(uploadRes.ok).toBe(true);

    const confirm = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign.body.objectKey, isPrimary: true });
    expect(confirm.status).toBe(201);
    expect(confirm.body.isPrimary).toBe(true);
  });

  it("uploading a second primary photo un-sets the first", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor2@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorToken);

    const presign1 = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    const first = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign1.body.objectKey, isPrimary: true });
    expect(first.body.isPrimary).toBe(true);

    const presign2 = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/jpeg" });
    const second = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/confirm`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ objectKey: presign2.body.objectKey, isPrimary: true });
    expect(second.body.isPrimary).toBe(true);

    const deleteFirst = await request(app.getHttpServer())
      .delete(`/hotels/${hotelId}/photos/${first.body.id}`)
      .set("Authorization", `Bearer ${vendorToken}`);
    expect(deleteFirst.status).toBe(200);
  });

  it("vendor B cannot presign a photo upload for vendor A's hotel", async () => {
    const { accessToken: vendorAToken } = await createVerifiedVendor(
      app,
      "photo-owner-a@example.com",
    );
    const { accessToken: vendorBToken } = await createVerifiedVendor(
      app,
      "photo-owner-b@example.com",
    );
    const { hotelId } = await createHotelWithRoom(app, vendorAToken);

    const res = await request(app.getHttpServer())
      .post(`/hotels/${hotelId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorBToken}`)
      .send({ contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  it("presigning a room photo scopes the objectKey to the room's id", async () => {
    const { accessToken: vendorToken } = await createVerifiedVendor(
      app,
      "photo-vendor3@example.com",
    );
    const { roomId } = await createHotelWithRoom(app, vendorToken);

    const res = await request(app.getHttpServer())
      .post(`/rooms/${roomId}/photos/presign`)
      .set("Authorization", `Bearer ${vendorToken}`)
      .send({ contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.objectKey).toMatch(
      new RegExp(`^rooms/${roomId}/.+\\.png$`),
    );
  });
});
```

- [ ] **Step 2: Confirm Docker services (including MinIO) are running**

```bash
docker compose -f infra/docker/docker-compose.yml ps
```

Expected: `staybangla-minio-1` shows `healthy`.

- [ ] **Step 3: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- room-listing-photos`
Expected: PASS, 4/4 tests. If the real `fetch(...)` PUT to the presigned URL fails (e.g. connection refused), check that `MINIO_ENDPOINT`/`MINIO_PORT` in `.env.test` actually point at the running container (`127.0.0.1:9000`) — this is the first test in the whole codebase to make a real network call to MinIO, so a misconfigured endpoint here is a genuine, first-time-surfaced bug, not a flaky test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): add e2e coverage for presigned hotel/room photo upload"
```

---

## Task 13: Final verification + PR

- [ ] **Step 1: Full monorepo verification**

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 2: Coverage check**

Run: `pnpm --filter @staybangla/api run test:unit`
Expected: global coverage threshold (80% branches/functions/lines/statements) passes. If any new file falls short, add real test cases for the uncovered branches (following this project's established discipline — never lower the threshold or add an unjustified exclusion) before proceeding.

- [ ] **Step 3: Manual runtime smoke test**

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
git push -u origin feat/room-listing-enhancements
gh pr create --title "feat: room listing enhancements (districts, room attributes, photos) + vendor approval" --body "See docs/superpowers/specs/2026-07-24-room-listing-enhancements-design.md for the full design."
gh pr checks --watch
```

- [ ] **Step 5: Do not merge without explicit confirmation**

Report the PR URL and CI status back; wait for explicit go-ahead before merging, matching how the previous module (PR #9) was handled.

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc (Room attributes, District enum, Hotel facilities/check-in-out, VendorVerificationLog + endpoints + resubmit, HotelPhoto/RoomPhoto + presigned upload) is represented across Tasks 1–12. ✓
- **Breaking-change fallout handled explicitly:** Tasks 3–4 are dedicated to fixing the existing shipped code (DTOs, services, e2e fixtures) that the `String → Enum` migration breaks — this was the single biggest risk of silently missing something, since the original design doc's "Existing files this module must also touch" list is exactly what Tasks 3–4 execute against. ✓
- **Type consistency:** `District`/`RoomType`/`BedType`/`FacilityCatalog` (Task 2) are used by name identically in Tasks 3, 6, 7. `StoragePort`'s three methods (Task 5) are consumed identically in Tasks 6–7. `VendorVerificationService`'s five methods (Task 8) are consumed identically in Task 9. ✓
- **No placeholders:** every step has complete code; the one explicitly-flagged simplification (Task 6's `confirmPhoto` not using an explicit `$transaction`) is called out with its accepted risk and a concrete escalation path, not left vague. ✓
- **Race-safety discipline carried forward:** approve/reject/resubmit (Task 8) all use the identical guarded-`updateMany` pattern already proven in the booking module, including a test for the concurrent-double-review case (Task 11's "rejecting an already-VERIFIED vendor returns 409"). ✓

## Verification (end-to-end)

1. `docker compose -f infra/docker/docker-compose.yml up -d` → postgres/redis/**minio** all healthy (this module is the first to require MinIO for tests to pass).
2. Dev + test DBs migrated (Task 2), including the `District`/`RoomType` enum casts.
3. `pnpm --filter @staybangla/api run test:unit` → green, coverage holds at 80%.
4. `pnpm --filter @staybangla/api run test:e2e` → green, including the new vendor-approval and photo-upload suites (the photo suite makes a real network PUT to MinIO — the first e2e test in this codebase to do so).
5. `pnpm lint && pnpm typecheck && pnpm build` (full monorepo) → green.
6. Manual smoke: approve a vendor via curl as an admin, confirm they can then create a hotel; presign+upload+confirm a real photo via curl and confirm it's retrievable.
7. PR opened, `verify` CI check green — **held for explicit merge confirmation**, not auto-merged.

## Next after this module

Dashboard UI (`add-vendor-dashboard-basic`, `add-admin-panel-basic`) consumes this module's `VendorVerificationService`/photo endpoints directly — no further backend work needed for those modules' core data access, only new read-oriented aggregation endpoints (booking calendars, earnings summaries) and the frontend itself.
