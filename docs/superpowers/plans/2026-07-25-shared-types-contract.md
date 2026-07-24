# Shared Types Contract + Hotel/Vehicle Detail Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `packages/shared-types` real, hand-written response types for Hotel/Room/Vehicle/Booking/User/VendorVerificationLog, add the two missing detail endpoints (`GET /hotels/:id`, `GET /vehicles/:id`) that make those types meaningful, and fix a `passwordHash` leak in the vendor-verification admin endpoints.

**Architecture:** New files in `packages/shared-types/src/` (one per domain concept, hand-written plain interfaces — no `@prisma/client` dependency added to this package). Two new controller routes added to existing `HotelsController`/`VehiclesController`, backed by two new service methods. One existing controller (`VendorVerificationController`) changes its return type to strip `passwordHash` via the already-existing `toPublicUser()` mapper.

**Tech Stack:** TypeScript (shared-types is plain `tsc`-compiled, no NestJS/Prisma dependency), NestJS controllers/services (existing conventions), Jest for both unit and e2e tests.

## Global Constraints

- `packages/shared-types` gets NO new dependency on `@prisma/client` — every new type is a hand-written plain `interface`, matching the existing precedent in `apps/api/src/bookings/bookings.types.ts` (`BookingRecord`).
- Only response/read shapes are shared. Request DTOs (`CreateHotelDto`, etc.) are NOT added to shared-types — they stay backend-only.
- Every new/changed backend method follows the existing codebase convention: `NotFoundException` for missing or soft-deleted (`isActive: false`) resources, exactly mirroring `HotelsService.findByIdOrThrow`'s and `VehiclesService.update`'s existing lookup style (see Task 2/3 for the one difference: the _existing_ `findByIdOrThrow` does NOT filter `isActive`, and must not be changed to do so, because vendor-owner flows — photo upload/delete — need to reach a vendor's own inactive listings too; the new public detail methods are separate, additive methods with their own `isActive: true` filter).
- Every new interface field name matches the exact camelCase name the real API JSON response uses today (verified against each service's Prisma `select`/mapped return shape) — not the Prisma model's raw field name where they'd differ (there are no such differences in this schema; every field name is already camelCase end-to-end).
- Dates are serialized as ISO 8601 strings in the shared types (`createdAt: string`, not `Date`) — this matches what actually crosses the wire as JSON (NestJS's default `JSON.stringify` serializes `Date` to an ISO string; the shared type describes the wire shape, not the in-process object).
- Frequent commits: one commit per task, following the exact commit message style already used in this repo (`feat(api): ...`, `test(api): ...`, `fix(api): ...`, `feat(shared-types): ...`).

---

## File Structure

```
packages/shared-types/src/
├── enums.ts              [MODIFY: add District, RoomType, BedType, FacilityCatalog;
│                           add explanatory comment above BookingStatus.SELECTED]
├── enums.spec.ts         [MODIFY: add tests for the four new enums]
├── user.ts               [NEW: PublicUser, VendorVerificationLogEntry]
├── user.spec.ts          [NEW]
├── hotel.ts              [NEW: HotelPhotoRef, Hotel, HotelWithDetails]
├── hotel.spec.ts         [NEW]
├── room.ts               [NEW: RoomPhotoRef, Room]
├── room.spec.ts          [NEW]
├── vehicle.ts            [NEW: Vehicle]
├── vehicle.spec.ts       [NEW]
├── booking.ts            [NEW: BookableType, Booking]
├── booking.spec.ts       [NEW]
└── index.ts              [MODIFY: add barrel exports for the five new files]

apps/api/src/
├── hotels/
│   ├── hotels.service.ts          [MODIFY: add findPublicDetailOrThrow()]
│   ├── hotels.service.spec.ts     [MODIFY: add tests]
│   ├── hotels.controller.ts       [MODIFY: add GET :id route]
│   └── hotels.controller.spec.ts  [MODIFY: add test]
├── vehicles/
│   ├── vehicles.service.ts          [MODIFY: extract findByIdOrThrow(), add isActive check]
│   ├── vehicles.service.spec.ts     [MODIFY: add tests]
│   ├── vehicles.controller.ts       [MODIFY: add GET :id route]
│   └── vehicles.controller.spec.ts  [MODIFY: add test]
└── admin/
    ├── vendor-verification.controller.ts       [MODIFY: return PublicUser, not User]
    └── vendor-verification.controller.spec.ts  [MODIFY: update expectations]

apps/api/test/
├── hotel-vehicle-detail.e2e-spec.ts       [NEW]
└── vendor-approval.e2e-spec.ts            [MODIFY: add passwordHash-leak regression test]
```

---

## Task 1: Add District/RoomType/BedType/FacilityCatalog enums to shared-types

**Files:**

- Modify: `packages/shared-types/src/enums.ts`
- Modify: `packages/shared-types/src/enums.spec.ts`

**Interfaces:**

- Produces: `District`, `RoomType`, `BedType`, `FacilityCatalog` string enums, importable from `@staybangla/shared-types` — consumed by Task 4 (`hotel.ts`), Task 5 (`room.ts`), Task 6 (`vehicle.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared-types/src/enums.spec.ts`:

```typescript
import { District, RoomType, BedType, FacilityCatalog } from "./enums";

describe("District", () => {
  it("includes every tourist-relevant district used by the API", () => {
    expect(District.DHAKA).toBe("DHAKA");
    expect(District.COXS_BAZAR).toBe("COXS_BAZAR");
    expect(District.SAINT_MARTIN).toBe("SAINT_MARTIN");
    expect(District.SREEMANGAL).toBe("SREEMANGAL");
  });

  it("has exactly 16 values, matching the Prisma schema enum", () => {
    expect(Object.values(District)).toHaveLength(16);
  });
});

describe("RoomType", () => {
  it("covers every room type the API accepts", () => {
    expect(Object.values(RoomType)).toEqual([
      "SINGLE",
      "DOUBLE",
      "TWIN",
      "SUITE",
      "FAMILY",
      "DORMITORY",
    ]);
  });
});

describe("BedType", () => {
  it("covers every bed type the API accepts", () => {
    expect(Object.values(BedType)).toEqual([
      "SINGLE",
      "TWIN",
      "DOUBLE",
      "QUEEN",
      "KING",
      "BUNK",
    ]);
  });
});

describe("FacilityCatalog", () => {
  it("has exactly 16 values, matching the Prisma schema enum", () => {
    expect(Object.values(FacilityCatalog)).toHaveLength(16);
  });

  it("includes core facilities used in hotel amenities", () => {
    expect(FacilityCatalog.WIFI).toBe("WIFI");
    expect(FacilityCatalog.AIR_CONDITIONING).toBe("AIR_CONDITIONING");
    expect(FacilityCatalog.SWIMMING_POOL).toBe("SWIMMING_POOL");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: FAIL — `District`/`RoomType`/`BedType`/`FacilityCatalog` are not exported from `./enums`.

- [ ] **Step 3: Implement**

Replace the full contents of `packages/shared-types/src/enums.ts`:

```typescript
export enum BookingStatus {
  /**
   * Frontend-only UI state before a hold exists — a traveler "selecting" a
   * room/date before calling POST /bookings. The database's BookingStatus
   * enum (apps/api/prisma/schema.prisma) intentionally has no SELECTED
   * value; no Booking row is ever persisted in this state. Do not "fix"
   * this by adding SELECTED to the Prisma enum or by removing it here.
   */
  SELECTED = "SELECTED",
  HELD = "HELD",
  CONFIRMED = "CONFIRMED",
  CHECKED_IN = "CHECKED_IN",
  COMPLETED = "COMPLETED",
  AUTO_CANCELLED = "AUTO_CANCELLED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
  BLOCKED = "BLOCKED",
}

export enum UserRole {
  TRAVELER = "TRAVELER",
  VENDOR = "VENDOR",
  GUIDE = "GUIDE",
  ADMIN = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
}

export enum District {
  DHAKA = "DHAKA",
  CHATTOGRAM = "CHATTOGRAM",
  COXS_BAZAR = "COXS_BAZAR",
  RANGAMATI = "RANGAMATI",
  BANDARBAN = "BANDARBAN",
  KHAGRACHARI = "KHAGRACHARI",
  SYLHET = "SYLHET",
  SREEMANGAL = "SREEMANGAL",
  SAINT_MARTIN = "SAINT_MARTIN",
  KHULNA = "KHULNA",
  SUNDARBANS = "SUNDARBANS",
  RAJSHAHI = "RAJSHAHI",
  BARISHAL = "BARISHAL",
  RANGPUR = "RANGPUR",
  MYMENSINGH = "MYMENSINGH",
  JESSORE = "JESSORE",
}

export enum RoomType {
  SINGLE = "SINGLE",
  DOUBLE = "DOUBLE",
  TWIN = "TWIN",
  SUITE = "SUITE",
  FAMILY = "FAMILY",
  DORMITORY = "DORMITORY",
}

export enum BedType {
  SINGLE = "SINGLE",
  TWIN = "TWIN",
  DOUBLE = "DOUBLE",
  QUEEN = "QUEEN",
  KING = "KING",
  BUNK = "BUNK",
}

export enum FacilityCatalog {
  TRAVEL_DESK = "TRAVEL_DESK",
  BATHTUB = "BATHTUB",
  LAUNDRY_SERVICE = "LAUNDRY_SERVICE",
  WELCOME_DRINKS = "WELCOME_DRINKS",
  THEMED_NIGHTS = "THEMED_NIGHTS",
  ELEVATOR = "ELEVATOR",
  SMOKE_FREE = "SMOKE_FREE",
  SWIMMING_POOL = "SWIMMING_POOL",
  PARKING = "PARKING",
  GYM = "GYM",
  RESTAURANT = "RESTAURANT",
  ROOM_SERVICE = "ROOM_SERVICE",
  WIFI = "WIFI",
  AIR_CONDITIONING = "AIR_CONDITIONING",
  GENERATOR_BACKUP = "GENERATOR_BACKUP",
  CCTV = "CCTV",
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: PASS — all `enums.spec.ts` cases green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/enums.ts packages/shared-types/src/enums.spec.ts
git commit -m "feat(shared-types): add District/RoomType/BedType/FacilityCatalog enums, document SELECTED drift"
```

---

## Task 2: PublicUser + VendorVerificationLogEntry shared types

**Files:**

- Create: `packages/shared-types/src/user.ts`
- Create: `packages/shared-types/src/user.spec.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**

- Produces: `PublicUser`, `VendorVerificationLogEntry` interfaces, exported from `@staybangla/shared-types`.

- [ ] **Step 1: Write the failing test**

`packages/shared-types/src/user.spec.ts`:

```typescript
import { PublicUser, VendorVerificationLogEntry } from "./user";

describe("PublicUser", () => {
  it("accepts a shape matching the real /users/me API response, with no passwordHash field", () => {
    const user: PublicUser = {
      id: "u1",
      phone: null,
      email: "vendor@example.com",
      fullName: "Vendor One",
      vendorType: "HOTEL",
      verifiedStatus: "VERIFIED",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(user.email).toBe("vendor@example.com");
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("allows vendorType and phone to be null (traveler/guide accounts)", () => {
    const user: PublicUser = {
      id: "u2",
      phone: "+8801700000000",
      email: null,
      fullName: null,
      vendorType: null,
      verifiedStatus: "PENDING",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(user.vendorType).toBeNull();
  });
});

describe("VendorVerificationLogEntry", () => {
  it("accepts a shape matching the real /admin/vendors/:id/history entries", () => {
    const entry: VendorVerificationLogEntry = {
      id: "log1",
      vendorId: "u1",
      adminId: "admin1",
      action: "REJECTED",
      reason: "Missing trade license",
      createdAt: "2026-07-25T00:00:00.000Z",
    };

    expect(entry.action).toBe("REJECTED");
  });

  it("allows reason to be null (VERIFIED/PENDING actions rarely include one)", () => {
    const entry: VendorVerificationLogEntry = {
      id: "log2",
      vendorId: "u1",
      adminId: "admin1",
      action: "VERIFIED",
      reason: null,
      createdAt: "2026-07-25T00:00:00.000Z",
    };

    expect(entry.reason).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: FAIL — `Cannot find module './user'`.

- [ ] **Step 3: Implement**

`packages/shared-types/src/user.ts`:

```typescript
export interface PublicUser {
  id: string;
  phone: string | null;
  email: string | null;
  fullName: string | null;
  vendorType: "HOTEL" | "VEHICLE" | "BOTH" | null;
  verifiedStatus: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: string;
  updatedAt: string;
}

export interface VendorVerificationLogEntry {
  id: string;
  vendorId: string;
  adminId: string;
  action: "VERIFIED" | "REJECTED" | "PENDING";
  reason: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: PASS.

- [ ] **Step 5: Add barrel export**

Replace the full contents of `packages/shared-types/src/index.ts`:

```typescript
export * from "./enums";
export * from "./user";
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/user.ts packages/shared-types/src/user.spec.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add PublicUser and VendorVerificationLogEntry types"
```

---

## Task 3: Fix passwordHash leak in vendor-verification admin endpoints

**Files:**

- Modify: `apps/api/src/admin/vendor-verification.controller.ts`
- Modify: `apps/api/src/admin/vendor-verification.controller.spec.ts`
- Modify: `apps/api/test/vendor-approval.e2e-spec.ts`

**Interfaces:**

- Consumes: `toPublicUser`, `PublicUser` from `apps/api/src/users/to-public-user.ts` (existing, unchanged — `export type PublicUser = Omit<User, "passwordHash">` and `export function toPublicUser(user: User): PublicUser`).
- Consumes: `VendorVerificationService.listPending(): Promise<User[]>`, `.approve(adminId, vendorId): Promise<User>`, `.reject(adminId, vendorId, reason): Promise<User>` — all existing, unchanged (the service still needs the full `User` internally; only the controller boundary changes).

- [ ] **Step 1: Write the failing e2e regression test**

Read the existing file first to find the right insertion point:

Run: `cat apps/api/test/vendor-approval.e2e-spec.ts`

Add this test inside the existing `describe("Vendor approval (e2e)", ...)` block (after the other `approve`-related tests):

```typescript
it("never leaks passwordHash in listPending/approve/reject responses", async () => {
  const { accessToken: adminToken } = await createAdmin(
    app,
    "leak-check-admin@example.com",
  );
  const { vendorId } = await createVerifiedVendor(
    app,
    "leak-check-vendor@example.com",
  );
  // Force back to PENDING so approve() has something to act on — reuse the
  // existing resubmit-after-reject pattern already proven in this file, or
  // directly flip via testPrisma if this file has that shortcut available.
  await testPrisma.user.update({
    where: { id: vendorId },
    data: { verifiedStatus: "PENDING" },
  });

  const pending = await request(app.getHttpServer())
    .get("/admin/vendors/pending")
    .set("Authorization", `Bearer ${adminToken}`);
  expect(JSON.stringify(pending.body)).not.toMatch(
    /passwordHash|password_hash|\$argon2/,
  );

  const approve = await request(app.getHttpServer())
    .post(`/admin/vendors/${vendorId}/approve`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(JSON.stringify(approve.body)).not.toMatch(
    /passwordHash|password_hash|\$argon2/,
  );
});
```

(If `testPrisma` is not already imported in this file, add `import { testPrisma } from "./helpers/test-db";` to the top import block — check the existing imports first with `head -10 apps/api/test/vendor-approval.e2e-spec.ts` and only add it if missing.)

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:e2e -- vendor-approval`
Expected: FAIL — the response bodies currently contain a `passwordHash` field (e.g. `"passwordHash":"$argon2id$..."`).

- [ ] **Step 3: Update the controller unit test's expectations first**

Modify `apps/api/src/admin/vendor-verification.controller.spec.ts` — the existing mocked service returns plain objects like `{ id: "v1" }`, which remain valid test doubles since `toPublicUser` only strips a field that isn't present in the mock anyway. No changes needed to this file's mocks, but add one new test at the end of the `describe` block to lock in the mapping behavior:

```typescript
it("listPending() strips passwordHash from each returned user", async () => {
  service.listPending.mockResolvedValue([
    { id: "v1", email: "a@b.com", passwordHash: "$argon2id$secret" },
  ]);
  const result = await controller.listPending();
  expect(result[0]).not.toHaveProperty("passwordHash");
  expect(result[0].email).toBe("a@b.com");
});

it("approve() strips passwordHash from the returned user", async () => {
  service.approve.mockResolvedValue({
    id: "v1",
    verifiedStatus: "VERIFIED",
    passwordHash: "$argon2id$secret",
  });
  const result = await controller.approve(
    { id: "admin1", roles: ["ADMIN"] },
    "v1",
  );
  expect(result).not.toHaveProperty("passwordHash");
});
```

- [ ] **Step 4: Run to confirm this new unit test also fails**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.controller`
Expected: FAIL — `result[0]` currently has a `passwordHash` property since the controller returns the service's raw mock object unchanged.

- [ ] **Step 5: Implement the fix**

Modify `apps/api/src/admin/vendor-verification.controller.ts` — full replacement:

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { VendorVerificationLog } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VendorVerificationService } from "./vendor-verification.service";
import { RejectVendorDto } from "./dto/reject-vendor.dto";
import { toPublicUser, PublicUser } from "../users/to-public-user";

@Controller("admin/vendors")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "SUPER_ADMIN")
export class VendorVerificationController {
  constructor(
    private readonly vendorVerificationService: VendorVerificationService,
  ) {}

  @Get("pending")
  async listPending(): Promise<PublicUser[]> {
    const vendors = await this.vendorVerificationService.listPending();
    return vendors.map(toPublicUser);
  }

  @Post(":id/approve")
  async approve(
    @CurrentUser() admin: RequestUser,
    @Param("id") id: string,
  ): Promise<PublicUser> {
    const vendor = await this.vendorVerificationService.approve(admin.id, id);
    return toPublicUser(vendor);
  }

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

  @Get(":id/history")
  async getHistory(@Param("id") id: string): Promise<VendorVerificationLog[]> {
    return this.vendorVerificationService.getHistory(id);
  }
}
```

- [ ] **Step 6: Run to confirm both new tests pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vendor-verification.controller`
Expected: PASS.

Run: `pnpm --filter @staybangla/api run test:e2e -- vendor-approval`
Expected: PASS — full suite, including the new regression test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/admin/vendor-verification.controller.ts apps/api/src/admin/vendor-verification.controller.spec.ts apps/api/test/vendor-approval.e2e-spec.ts
git commit -m "fix(api): strip passwordHash from vendor-verification admin endpoints"
```

---

## Task 4: HotelsService.findPublicDetailOrThrow + GET /hotels/:id

**Files:**

- Modify: `apps/api/src/hotels/hotels.service.ts`
- Modify: `apps/api/src/hotels/hotels.service.spec.ts`
- Modify: `apps/api/src/hotels/hotels.controller.ts`
- Modify: `apps/api/src/hotels/hotels.controller.spec.ts`

**Interfaces:**

- Produces: `HotelsService.findPublicDetailOrThrow(id: string): Promise<HotelDetailResult>` where `HotelDetailResult` is a new exported interface (defined in this task, in `hotels.service.ts`) shaped as:
  ```typescript
  export interface HotelDetailResult extends Hotel {
    rooms: Room[];
    photos: HotelPhoto[];
  }
  ```
  (using the existing Prisma `Hotel`/`Room`/`HotelPhoto` types already imported in this file — this is the backend-internal return type; Task 7's e2e test and the frontend later will see this shape serialized as JSON matching shared-types' `HotelWithDetails`).
- Consumes: nothing new — uses `this.prisma` (existing constructor dependency).

- [ ] **Step 1: Write the failing service test**

Add to `apps/api/src/hotels/hotels.service.spec.ts` (read the file first with `cat apps/api/src/hotels/hotels.service.spec.ts` to match its existing mock-setup style before inserting):

```typescript
describe("findPublicDetailOrThrow", () => {
  it("returns the hotel with its rooms and photos included", async () => {
    prisma.hotel.findUnique.mockResolvedValue({
      id: "h1",
      isActive: true,
      rooms: [{ id: "r1", photos: [] }],
      photos: [{ id: "p1", isPrimary: true }],
    });

    const result = await service.findPublicDetailOrThrow("h1");

    expect(prisma.hotel.findUnique).toHaveBeenCalledWith({
      where: { id: "h1" },
      include: { rooms: { include: { photos: true } }, photos: true },
    });
    expect(result.rooms).toEqual([{ id: "r1", photos: [] }]);
    expect(result.photos).toEqual([{ id: "p1", isPrimary: true }]);
  });

  it("throws NotFoundException when the hotel does not exist", async () => {
    prisma.hotel.findUnique.mockResolvedValue(null);
    await expect(service.findPublicDetailOrThrow("missing")).rejects.toThrow(
      "Hotel not found",
    );
  });

  it("throws NotFoundException when the hotel is soft-deleted (isActive: false)", async () => {
    prisma.hotel.findUnique.mockResolvedValue({ id: "h1", isActive: false });
    await expect(service.findPublicDetailOrThrow("h1")).rejects.toThrow(
      "Hotel not found",
    );
  });
});
```

Note: check the existing `describe("HotelsService", ...)` block's top-level mock declaration (likely `let prisma: { hotel: { findUnique: jest.Mock; ... } }`) — add `findUnique: jest.fn()` to the `hotel` mock object if not already present (it likely already is, since `findByIdOrThrow` uses it).

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service`
Expected: FAIL — `service.findPublicDetailOrThrow is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/hotels/hotels.service.ts`, add this import to the existing `@prisma/client` import block (modify the existing import statement at the top of the file to include `Room`):

```typescript
import {
  Hotel,
  HotelPhoto,
  Prisma,
  District,
  FacilityCatalog,
  RoomType,
  Room,
} from "@prisma/client";
```

Add this new exported interface directly below the existing `RoomAvailability` interface (after line 37, before the `@Injectable()` class):

```typescript
export interface HotelDetailResult extends Hotel {
  rooms: Room[];
  photos: HotelPhoto[];
}
```

Add this new method to the `HotelsService` class, directly after the existing `findByIdOrThrow` method:

```typescript
  async findPublicDetailOrThrow(id: string): Promise<HotelDetailResult> {
    const hotel = await this.prisma.hotel.findUnique({
      where: { id },
      include: { rooms: { include: { photos: true } }, photos: true },
    });
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException("Hotel not found");
    }
    return hotel as HotelDetailResult;
  }
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.service`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

Add to `apps/api/src/hotels/hotels.controller.spec.ts` (read the file first to match its exact mock-setup style):

```typescript
it("findOne() delegates to HotelsService.findPublicDetailOrThrow", async () => {
  hotelsService.findPublicDetailOrThrow.mockResolvedValue({
    id: "h1",
    rooms: [],
    photos: [],
  });
  const result = await controller.findOne("h1");
  expect(hotelsService.findPublicDetailOrThrow).toHaveBeenCalledWith("h1");
  expect(result).toEqual({ id: "h1", rooms: [], photos: [] });
});
```

Add `findPublicDetailOrThrow: jest.Mock` to the existing `hotelsService` mock type declaration and its `beforeEach` initialization (`findPublicDetailOrThrow: jest.fn()`), matching the style of the other mocked methods already there (`create`, `presignPhotoUpload`, etc.).

- [ ] **Step 6: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.controller`
Expected: FAIL — `controller.findOne is not a function`.

- [ ] **Step 7: Implement the controller route**

In `apps/api/src/hotels/hotels.controller.ts`, add `Get` to the existing `@nestjs/common` import:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
```

Add this new route as the first method in the `HotelsController` class (before `create`) — public, no guards, matching the existing public `GET /rooms/available` convention:

```typescript
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<Hotel> {
    return this.hotelsService.findPublicDetailOrThrow(id);
  }
```

- [ ] **Step 8: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- hotels.controller`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/hotels/hotels.service.ts apps/api/src/hotels/hotels.service.spec.ts apps/api/src/hotels/hotels.controller.ts apps/api/src/hotels/hotels.controller.spec.ts
git commit -m "feat(api): add GET /hotels/:id detail endpoint with rooms and photos"
```

---

## Task 5: VehiclesService.findByIdOrThrow extraction + GET /vehicles/:id

**Files:**

- Modify: `apps/api/src/vehicles/vehicles.service.ts`
- Modify: `apps/api/src/vehicles/vehicles.service.spec.ts`
- Modify: `apps/api/src/vehicles/vehicles.controller.ts`
- Modify: `apps/api/src/vehicles/vehicles.controller.spec.ts`

**Interfaces:**

- Produces: `VehiclesService.findByIdOrThrow(id: string): Promise<Vehicle>` (new extracted method — throws `NotFoundException("Vehicle not found")` for missing OR `isActive: false` vehicles).
- Consumes: nothing new.

**Note on why this differs from Task 4's `HotelsService`:** `HotelsService` already had a `findByIdOrThrow` (used by owner-flows, does NOT filter `isActive`), so Task 4 added a separate, new `findPublicDetailOrThrow` method rather than changing the existing one. `VehiclesService` has no such existing method — `update()` does its lookup inline. This task extracts that inline lookup into a new `findByIdOrThrow` method that DOES filter `isActive` (there is no existing owner-flow that needs to reach an inactive vehicle the way hotel photo-management does, so one method serving both `update`'s ownership check and the new public GET route is correct here — verified by reading `vehicles.controller.ts`: the only other vehicle-mutating route is `update` itself).

- [ ] **Step 1: Write the failing service tests**

Add to `apps/api/src/vehicles/vehicles.service.spec.ts` (read the file first to match its exact mock style):

```typescript
describe("findByIdOrThrow", () => {
  it("returns the vehicle when it exists and is active", async () => {
    prisma.vehicle.findUnique.mockResolvedValue({
      id: "veh1",
      isActive: true,
    });
    const result = await service.findByIdOrThrow("veh1");
    expect(result).toEqual({ id: "veh1", isActive: true });
  });

  it("throws NotFoundException when the vehicle does not exist", async () => {
    prisma.vehicle.findUnique.mockResolvedValue(null);
    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(
      "Vehicle not found",
    );
  });

  it("throws NotFoundException when the vehicle is soft-deleted (isActive: false)", async () => {
    prisma.vehicle.findUnique.mockResolvedValue({
      id: "veh1",
      isActive: false,
    });
    await expect(service.findByIdOrThrow("veh1")).rejects.toThrow(
      "Vehicle not found",
    );
  });
});
```

Also update the existing `update()` describe block's tests if any of them currently mock `prisma.vehicle.findUnique` to return an inactive vehicle expecting `update` to succeed anyway — read `vehicles.service.spec.ts` in full first to check. If none do (the existing tests likely only cover the not-found and wrong-owner cases, not the isActive dimension, since `update` never previously checked it), no existing test needs changing; the new `isActive` check in the extracted method is additive-only for `update`'s behavior.

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vehicles.service`
Expected: FAIL — `service.findByIdOrThrow is not a function`.

- [ ] **Step 3: Implement**

Replace the full contents of `apps/api/src/vehicles/vehicles.service.ts`:

```typescript
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Vehicle, District } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";

export interface CreateVehicleInput {
  category: "CNG" | "JEEP" | "BOAT";
  city: District;
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
  city: District;
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

  async findByIdOrThrow(id: string): Promise<Vehicle> {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || !vehicle.isActive) {
      throw new NotFoundException("Vehicle not found");
    }
    return vehicle;
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
    city?: District,
  ): Promise<VehicleAvailability[]> {
    const cityFilter = city
      ? Prisma.sql`AND v.city = ${city}::"District"`
      : Prisma.empty;
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

Note: `update()`'s own inline lookup is deliberately left as-is (not switched to call `findByIdOrThrow`) — `update` must find an existing-but-inactive vehicle too (a vendor re-activating their own soft-deleted vehicle via `PATCH .../isActive: true` must still work), so it cannot reuse the new `isActive`-filtering method. This is the same reasoning already documented for `HotelsService` in this plan's Global Constraints.

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vehicles.service`
Expected: PASS.

- [ ] **Step 5: Write the failing controller test**

Add to `apps/api/src/vehicles/vehicles.controller.spec.ts`:

```typescript
it("findOne() delegates to VehiclesService.findByIdOrThrow", async () => {
  vehiclesService.findByIdOrThrow.mockResolvedValue({ id: "veh1" });
  const result = await controller.findOne("veh1");
  expect(vehiclesService.findByIdOrThrow).toHaveBeenCalledWith("veh1");
  expect(result).toEqual({ id: "veh1" });
});
```

Add `findByIdOrThrow: jest.Mock` to the existing `vehiclesService` mock type declaration and its `beforeEach` initialization.

- [ ] **Step 6: Run to confirm fail**

Run: `pnpm --filter @staybangla/api run test:unit -- vehicles.controller`
Expected: FAIL — `controller.findOne is not a function`.

- [ ] **Step 7: Implement the controller route**

In `apps/api/src/vehicles/vehicles.controller.ts`, add `Get` and `Param` are already imported — check the existing import list first (`Get` is already there for the `available` route; `Param` is already there for `update`). Add this new route as the first method in the `VehiclesController` class (before `available`):

```typescript
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<Vehicle> {
    return this.vehiclesService.findByIdOrThrow(id);
  }
```

**Route ordering warning:** this MUST be added so Nest still matches `GET /vehicles/available` correctly. Nest resolves routes by declaration order for path-parameter collisions — since `:id` is a dynamic segment and `available` is a static segment, place the `available` route's `@Get("available")` method BEFORE this new `@Get(":id")` method in the class body (i.e., keep `available` as the first declared route, add `findOne` as the second, before `create`/`update`). Verify by reading the current file order first with `cat apps/api/src/vehicles/vehicles.controller.ts` — if `available` is already declared first, insert `findOne` immediately after it, not before.

- [ ] **Step 8: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:unit -- vehicles.controller`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/vehicles/vehicles.service.ts apps/api/src/vehicles/vehicles.service.spec.ts apps/api/src/vehicles/vehicles.controller.ts apps/api/src/vehicles/vehicles.controller.spec.ts
git commit -m "feat(api): add GET /vehicles/:id detail endpoint"
```

---

## Task 6: Hotel/Room/Vehicle/Booking shared types

**Files:**

- Create: `packages/shared-types/src/hotel.ts`
- Create: `packages/shared-types/src/hotel.spec.ts`
- Create: `packages/shared-types/src/room.ts`
- Create: `packages/shared-types/src/room.spec.ts`
- Create: `packages/shared-types/src/vehicle.ts`
- Create: `packages/shared-types/src/vehicle.spec.ts`
- Create: `packages/shared-types/src/booking.ts`
- Create: `packages/shared-types/src/booking.spec.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**

- Consumes: `District`, `RoomType`, `BedType`, `FacilityCatalog`, `BookingStatus` from `./enums` (Task 1).
- Produces: `HotelPhotoRef`, `Hotel`, `HotelWithDetails` (from `hotel.ts`); `RoomPhotoRef`, `Room` (from `room.ts`); `Vehicle` (from `vehicle.ts`); `BookableType`, `Booking` (from `booking.ts`) — all exported from `@staybangla/shared-types`.

- [ ] **Step 1: Write the failing tests**

`packages/shared-types/src/hotel.spec.ts`:

```typescript
import { Hotel, HotelWithDetails, HotelPhotoRef } from "./hotel";
import { District, FacilityCatalog } from "./enums";
import { Room } from "./room";

describe("Hotel", () => {
  it("accepts a shape matching the real GET /hotels/:id response", () => {
    const hotel: Hotel = {
      id: "h1",
      ownerId: "v1",
      name: "Cox's Paradise Hotel",
      city: District.COXS_BAZAR,
      address: "Marine Drive Road",
      description: "Seafront hotel",
      amenities: [FacilityCatalog.WIFI, FacilityCatalog.SWIMMING_POOL],
      starRating: 4,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(hotel.city).toBe("COXS_BAZAR");
  });

  it("allows description and starRating to be null", () => {
    const hotel: Hotel = {
      id: "h2",
      ownerId: "v1",
      name: "Budget Inn",
      city: District.DHAKA,
      address: "Motijheel",
      description: null,
      amenities: [],
      starRating: null,
      checkInTime: "12:00",
      checkOutTime: "10:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(hotel.starRating).toBeNull();
  });
});

describe("HotelWithDetails", () => {
  it("extends Hotel with rooms and photos arrays", () => {
    const photo: HotelPhotoRef = {
      id: "p1",
      objectKey: "hotels/h1/abc.jpg",
      isPrimary: true,
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const room: Room = {
      id: "r1",
      hotelId: "h1",
      roomType: "DOUBLE" as Room["roomType"],
      pricePerNightMinor: 500000,
      currency: "BDT",
      capacity: 2,
      hasAC: true,
      bedType: "DOUBLE" as Room["bedType"],
      amenities: [],
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      photos: [],
    };
    const hotelWithDetails: HotelWithDetails = {
      id: "h1",
      ownerId: "v1",
      name: "Cox's Paradise Hotel",
      city: District.COXS_BAZAR,
      address: "Marine Drive Road",
      description: null,
      amenities: [],
      starRating: null,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      rooms: [room],
      photos: [photo],
    };

    expect(hotelWithDetails.rooms).toHaveLength(1);
    expect(hotelWithDetails.photos[0].isPrimary).toBe(true);
  });
});
```

`packages/shared-types/src/room.spec.ts`:

```typescript
import { Room, RoomPhotoRef } from "./room";
import { RoomType, BedType } from "./enums";

describe("Room", () => {
  it("accepts a shape matching the real room object nested in GET /hotels/:id", () => {
    const photo: RoomPhotoRef = {
      id: "p1",
      objectKey: "rooms/r1/xyz.png",
      isPrimary: false,
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const room: Room = {
      id: "r1",
      hotelId: "h1",
      roomType: RoomType.SUITE,
      pricePerNightMinor: 800000,
      currency: "BDT",
      capacity: 4,
      hasAC: true,
      bedType: BedType.KING,
      amenities: ["Balcony", "Sea View"],
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      photos: [photo],
    };

    expect(room.roomType).toBe("SUITE");
    expect(room.amenities).toEqual(["Balcony", "Sea View"]);
  });
});
```

`packages/shared-types/src/vehicle.spec.ts`:

```typescript
import { Vehicle } from "./vehicle";
import { District } from "./enums";

describe("Vehicle", () => {
  it("accepts a shape matching the real GET /vehicles/:id response", () => {
    const vehicle: Vehicle = {
      id: "veh1",
      ownerId: "v1",
      category: "CNG",
      city: District.DHAKA,
      model: "Bajaj RE",
      capacity: 3,
      pricePerDayMinor: 200000,
      currency: "BDT",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(vehicle.category).toBe("CNG");
  });

  it("allows model to be null", () => {
    const vehicle: Vehicle = {
      id: "veh2",
      ownerId: "v1",
      category: "BOAT",
      city: District.SAINT_MARTIN,
      model: null,
      capacity: 10,
      pricePerDayMinor: 500000,
      currency: "BDT",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(vehicle.model).toBeNull();
  });
});
```

`packages/shared-types/src/booking.spec.ts`:

```typescript
import { Booking, BookableType } from "./booking";
import { BookingStatus } from "./enums";

describe("Booking", () => {
  it("accepts a shape matching the real BookingRecord API response for a room booking", () => {
    const bookableType: BookableType = "ROOM";
    const booking: Booking = {
      id: "b1",
      userId: "traveler1",
      bookableType,
      roomId: "r1",
      vehicleId: null,
      resourceOwnerId: "vendor1",
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      guestCount: 2,
      totalAmountMinor: 1000000,
      currency: "BDT",
      status: BookingStatus.HELD,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(booking.bookableType).toBe("ROOM");
    expect(booking.vehicleId).toBeNull();
  });

  it("accepts a shape for a vendor-created BLOCKED entry (userId null)", () => {
    const booking: Booking = {
      id: "b2",
      userId: null,
      bookableType: "VEHICLE",
      roomId: null,
      vehicleId: "veh1",
      resourceOwnerId: "vendor1",
      checkIn: "2026-09-05",
      checkOut: "2026-09-06",
      guestCount: null,
      totalAmountMinor: 0,
      currency: "BDT",
      status: BookingStatus.BLOCKED,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(booking.userId).toBeNull();
    expect(booking.status).toBe("BLOCKED");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: FAIL — `Cannot find module './hotel'`, `'./room'`, `'./vehicle'`, `'./booking'`.

- [ ] **Step 3: Implement `room.ts`**

`packages/shared-types/src/room.ts`:

```typescript
import { RoomType, BedType } from "./enums";

export interface RoomPhotoRef {
  id: string;
  objectKey: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Room {
  id: string;
  hotelId: string;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
  hasAC: boolean;
  bedType: BedType;
  amenities: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  photos: RoomPhotoRef[];
}
```

- [ ] **Step 4: Implement `hotel.ts`**

`packages/shared-types/src/hotel.ts`:

```typescript
import { District, FacilityCatalog } from "./enums";
import { Room } from "./room";

export interface HotelPhotoRef {
  id: string;
  objectKey: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Hotel {
  id: string;
  ownerId: string;
  name: string;
  city: District;
  address: string;
  description: string | null;
  amenities: FacilityCatalog[];
  starRating: number | null;
  checkInTime: string;
  checkOutTime: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HotelWithDetails extends Hotel {
  rooms: Room[];
  photos: HotelPhotoRef[];
}
```

- [ ] **Step 5: Implement `vehicle.ts`**

`packages/shared-types/src/vehicle.ts`:

```typescript
import { District } from "./enums";

export interface Vehicle {
  id: string;
  ownerId: string;
  category: "CNG" | "JEEP" | "BOAT";
  city: District;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 6: Implement `booking.ts`**

`packages/shared-types/src/booking.ts`:

```typescript
import { BookingStatus } from "./enums";

export type BookableType = "ROOM" | "VEHICLE";

export interface Booking {
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
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 7: Run to confirm pass**

Run: `pnpm --filter @staybangla/shared-types run test`
Expected: PASS — all new spec files green.

- [ ] **Step 8: Add barrel exports**

Replace the full contents of `packages/shared-types/src/index.ts`:

```typescript
export * from "./enums";
export * from "./user";
export * from "./hotel";
export * from "./room";
export * from "./vehicle";
export * from "./booking";
```

- [ ] **Step 9: Run the package build to confirm no circular-import or type errors**

Run: `pnpm --filter @staybangla/shared-types run build`
Expected: PASS — `dist/` regenerated with no TypeScript errors (this catches issues like `hotel.ts` importing `Room` from `room.ts` while `room.ts` doesn't import anything from `hotel.ts` — no circularity exists in this design, but this step proves it).

- [ ] **Step 10: Commit**

```bash
git add packages/shared-types/src/hotel.ts packages/shared-types/src/hotel.spec.ts packages/shared-types/src/room.ts packages/shared-types/src/room.spec.ts packages/shared-types/src/vehicle.ts packages/shared-types/src/vehicle.spec.ts packages/shared-types/src/booking.ts packages/shared-types/src/booking.spec.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add Hotel/Room/Vehicle/Booking response types"
```

---

## Task 7: E2e coverage for the two new detail endpoints

**Files:**

- Create: `apps/api/test/hotel-vehicle-detail.e2e-spec.ts`

**Interfaces:**

- Consumes: `createVerifiedVendor`, `createHotelWithRoom` from `apps/api/test/helpers/test-fixtures.ts` (existing, unchanged).

- [ ] **Step 1: Write the failing e2e tests**

`apps/api/test/hotel-vehicle-detail.e2e-spec.ts`:

```typescript
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

describe("Hotel/Vehicle detail endpoints (e2e)", () => {
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

  describe("GET /hotels/:id", () => {
    it("returns the hotel with its rooms and photos, with no auth required", async () => {
      const { accessToken: vendorToken } = await createVerifiedVendor(
        app,
        "detail-vendor@example.com",
      );
      const { hotelId, roomId } = await createHotelWithRoom(app, vendorToken);

      const res = await request(app.getHttpServer()).get(`/hotels/${hotelId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(hotelId);
      expect(res.body.rooms).toHaveLength(1);
      expect(res.body.rooms[0].id).toBe(roomId);
      expect(res.body.photos).toEqual([]);
    });

    it("returns 404 for a hotel id that does not exist", async () => {
      const res = await request(app.getHttpServer()).get(
        "/hotels/00000000-0000-0000-0000-000000000000",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /vehicles/:id", () => {
    it("returns the vehicle, with no auth required", async () => {
      const { accessToken: vendorToken } = await createVerifiedVendor(
        app,
        "detail-vendor2@example.com",
      );
      const create = await request(app.getHttpServer())
        .post("/vehicles")
        .set("Authorization", `Bearer ${vendorToken}`)
        .send({
          category: "CNG",
          city: "DHAKA",
          capacity: 3,
          pricePerDayMinor: 200000,
        });

      const res = await request(app.getHttpServer()).get(
        `/vehicles/${create.body.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(create.body.id);
      expect(res.body.category).toBe("CNG");
    });

    it("returns 404 for a vehicle id that does not exist", async () => {
      const res = await request(app.getHttpServer()).get(
        "/vehicles/00000000-0000-0000-0000-000000000000",
      );
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run to confirm pass**

Run: `pnpm --filter @staybangla/api run test:e2e -- hotel-vehicle-detail`
Expected: PASS (Tasks 4 and 5 already implemented the underlying endpoints — this task is pure verification, no production code changes expected; if anything fails here, it indicates a gap in Task 4/5's implementation that must be fixed before proceeding).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/hotel-vehicle-detail.e2e-spec.ts
git commit -m "test(api): add e2e coverage for GET /hotels/:id and GET /vehicles/:id"
```

---

## Task 8: Full monorepo verification + PR

**Files:** None (verification only).

- [ ] **Step 1: Full monorepo checks**

Run:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green. `pnpm build` in particular confirms `packages/shared-types`'s new barrel exports compile cleanly and `apps/api`/`apps/web` (which depends on `@staybangla/shared-types` via `workspace:*`) still typecheck against the expanded package.

- [ ] **Step 2: Push branch and open PR**

```bash
git checkout -b feat/shared-types-contract
git push -u origin feat/shared-types-contract
gh pr create --title "feat: shared-types contract + hotel/vehicle detail endpoints" --body "Implements ROADMAP.md item 1.4. Adds hand-written response types for Hotel/Room/Vehicle/Booking/User/VendorVerificationLog to packages/shared-types, adds GET /hotels/:id and GET /vehicles/:id, and fixes a passwordHash leak in the vendor-verification admin endpoints. See docs/superpowers/specs/2026-07-25-shared-types-contract-design.md for full design."
gh pr checks --watch
```

- [ ] **Step 3: Merge once the `verify` CI check is green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Update ROADMAP.md**

After merge, edit `ROADMAP.md` on a new small branch/PR: change item 1.4's status from `🚧 next` to `✅`, and mark 1.5 (`add-rate-limiting`) as `🚧 next`.

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-25-shared-types-contract-design.md` is covered — new types (Tasks 1, 2, 6), `SELECTED` documentation (Task 1), `GET /hotels/:id` (Task 4), `GET /vehicles/:id` (Task 5), `passwordHash` fix (Task 3), e2e coverage (Task 3's regression test + Task 7), full verification (Task 8). ✓
- **Type consistency:** `HotelDetailResult` (Task 4, backend-internal) and `HotelWithDetails` (Task 6, shared-types) are deliberately two different names for the same JSON shape — one is the Prisma-typed backend return value, the other is the hand-written wire-contract type a frontend imports. This mirrors the existing `BookingRecord`/Prisma-`Booking` split already in the codebase. Not a naming bug.
- **Fixed during self-review:** originally drafted Task 5 to have `VehiclesService.update` call the new `findByIdOrThrow`, which would have broken re-activating a soft-deleted vehicle. Corrected to leave `update`'s inline lookup as-is, matching `HotelsService`'s established owner-flow-vs-public-flow separation.
- **No placeholders:** every step has complete, real code — no "add appropriate handling"-style gaps.
