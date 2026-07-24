# Shared Types Contract + Hotel/Vehicle Detail Endpoints — Design

**Status:** Approved for planning
**Scope:** `packages/shared-types` (new hand-written response types) + `apps/api` (two new GET endpoints, one security fix). No frontend/UI in this change.
**Depends on:** `add-hotel-vehicle-booking-core` (merged, PR #9), `add-room-listing-enhancements` (merged, PR #12).

## Problem

`packages/shared-types` exports only two enums (`BookingStatus`, `UserRole`). There is no shared type for any domain model (Hotel, Room, Vehicle, Booking, User, VendorVerificationLog) — a frontend cannot import a single typed shape from the backend and must hand-guess every response field. This is the last blocker before frontend work can start safely.

While mapping every controller's actual response shape to build these types, two real, pre-existing defects surfaced and are fixed as part of this same change (not scope creep — they only became visible by doing this mapping exercise):

1. **`passwordHash` leak.** `GET /admin/vendors/pending`, `POST /admin/vendors/:id/approve`, and `POST /admin/vendors/:id/reject` return the raw Prisma `User` row, including `passwordHash`. Every other endpoint that returns a user (`GET/PATCH /users/me`) already strips it via `toPublicUser()`. This is the same class of bug pattern already fixed once in this codebase — it just wasn't caught here at the time.
2. **Missing detail endpoints.** There is no `GET /hotels/:id` or `GET /vehicles/:id`. The only read paths are `GET /rooms/available` and `GET /vehicles/available`, which return a flat search-result shape (`RoomAvailability`/`VehicleAvailability`) with no photos, no hotel-level fields (checkInTime, amenities), and no room listing. A shared "Hotel" type is meaningless if no endpoint ever returns a full Hotel — so this change adds the two missing detail endpoints as the real-use-case grounding for the new shared types.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               packages/shared-types/src/                     │
│                                                               │
│  enums.ts        (existing — BookingStatus, UserRole)         │
│  user.ts         (new — PublicUser, VendorVerificationLog)   │
│  hotel.ts        (new — Hotel, HotelPhoto, HotelWithRooms)   │
│  room.ts         (new — Room, RoomPhoto)                     │
│  vehicle.ts      (new — Vehicle)                              │
│  booking.ts      (new — Booking, re-exports bookings.types    │
│                   shape, hand-written, no @prisma/client dep) │
│  index.ts        (barrel — export * from each)                │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ hand-written, mirrors actual API
                          │ response JSON shape — NOT Prisma's
                          │ generated types (no @prisma/client
                          │ dependency added to this package)
                          │
┌─────────────────────────────────────────────────────────────┐
│                    apps/api/src/                              │
│                                                               │
│  hotels.controller.ts   + GET /hotels/:id  (public, includes  │
│                           rooms[] and photos[])                │
│  vehicles.controller.ts + GET /vehicles/:id (public)          │
│  admin/vendor-verification.controller.ts                       │
│         listPending/approve/reject → now return PublicUser     │
│         (passwordHash stripped via toPublicUser())              │
└─────────────────────────────────────────────────────────────┘
```

Each shared type is a **hand-written plain TypeScript interface**, matching the existing precedent set by `apps/api/src/bookings/bookings.types.ts` (`BookingRecord`) — not a re-export of Prisma's generated types. This keeps `shared-types` dependency-free (no `@prisma/client` in a package the frontend will import) and keeps the contract intentionally decoupled from internal DB column shape (e.g., `objectKey` stays a plain string field on the wire type — no leaking of Prisma relation wrapper types).

**Scope boundary:** only response/read shapes are shared. Request bodies (`CreateHotelDto`, etc.) stay backend-only with their existing `class-validator` decorators — sharing them would create a second place that must change every time a validation rule changes, which is a maintenance trap, not a contract worth publishing.

## New Types (packages/shared-types)

```typescript
// user.ts
export interface PublicUser {
  id: string;
  phone: string | null;
  email: string | null;
  fullName: string | null;
  vendorType: "HOTEL" | "VEHICLE" | "BOTH" | null;
  verifiedStatus: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: string; // ISO 8601 — API serializes Date as JSON string
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

```typescript
// hotel.ts
import { District, FacilityCatalog } from "./enums";

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

```typescript
// room.ts
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

```typescript
// vehicle.ts
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

```typescript
// booking.ts
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

`District`, `RoomType`, `BedType`, `FacilityCatalog` enums move into `enums.ts` alongside the existing `BookingStatus`/`UserRole` (hand-copied from the Prisma schema's enum value lists — this is the one place a schema enum rename must be manually mirrored, same tradeoff already accepted for `BookingStatus`).

### `BookingStatus.SELECTED` — resolution

`SELECTED` stays in `enums.ts`'s `BookingStatus`, with an explicit comment added directly above it:

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
  // ...unchanged
}
```

This prevents a future contributor from treating the enum mismatch as an accidental bug.

## Backend changes

### 1. `GET /hotels/:id` (new, public)

```typescript
// hotels.controller.ts
@Get(":id")
async findOne(@Param("id") id: string): Promise<HotelWithDetailsResult> {
  return this.hotelsService.findByIdWithDetails(id);
}
```

`HotelsService.findByIdWithDetails(id)` — new method, `prisma.hotel.findUnique({ where: { id }, include: { rooms: { include: { photos: true } }, photos: true } })`, throws `NotFoundException` if missing or `isActive: false` (matches the existing "don't leak soft-deleted resources" convention already used in `searchAvailableRooms`'s `isActive: true` filter).

Route ordering note: this must be registered so it doesn't shadow `POST /hotels` or intercept `:id/photos/presign`-style sub-routes — Nest matches HTTP method + exact path segments, so a `GET :id` alongside existing `POST` and `POST :id/photos/...` routes on the same controller doesn't collide (verified against the existing `HotelsController`'s route list — no existing `GET` route on this controller today).

### 2. `GET /vehicles/:id` (new, public)

`VehiclesService.update` currently does its ownership check with an inline `prisma.vehicle.findUnique` call (no extracted helper method exists yet — checked directly in `vehicles.service.ts`). This task extracts that into a new `findByIdOrThrow(id): Promise<Vehicle>` method (throwing `NotFoundException` for missing or `isActive: false` vehicles, mirroring `HotelsService.findByIdOrThrow`'s existing convention), reuses it from both `update` and the new controller route. This is a small, in-scope refactor — not a separate task — since the new endpoint needs the exact same lookup+404 logic `update` already has, and duplicating it inline a second time would immediately create the kind of drift this module exists to prevent.

### 3. Fix: `passwordHash` leak in vendor-verification endpoints

`VendorVerificationController.listPending/approve/reject` change return type from `Promise<User>`/`Promise<User[]>` to `Promise<PublicUser>`/`Promise<PublicUser[]>`, applying the existing `toPublicUser()` mapper (from `apps/api/src/users/to-public-user.ts`) at the controller boundary — the same place/pattern `UsersController` already uses. `VendorVerificationService`'s internals are untouched (it correctly needs the full `User` internally); only the controller-boundary serialization changes.

## RBAC / CASL

No change — `GET /hotels/:id` and `GET /vehicles/:id` are public (unauthenticated), matching the existing `GET /rooms/available`/`GET /vehicles/available` public-search convention: a traveler must be able to view listing details before logging in.

## Explicitly deferred

| Concern                                                                                    | Deferred to                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presigned GET URLs for photos (returning a real viewable `url` instead of raw `objectKey`) | Whenever the frontend photo-display work actually needs it — the backend already knows how to mint presigned PUT URLs (`StoragePort`), and adding a GET-presign method is a small, isolated addition to make then, not now |
| Pagination on `GET /hotels/:id`'s `rooms[]`                                                | Not needed yet — a single hotel's room count is small (tens, not thousands)                                                                                                                                                |
| `GET /hotels` (list all hotels, not just search)                                           | Not requested; `GET /rooms/available` already serves the traveler search use case                                                                                                                                          |

## Testing Strategy

TDD, matching existing discipline:

- `GET /hotels/:id` — e2e: returns hotel with nested rooms+photos; 404 for missing/inactive hotel.
- `GET /vehicles/:id` — e2e: returns vehicle; 404 for missing/inactive vehicle.
- `passwordHash` fix — regression e2e test asserting the JSON response body for `listPending`/`approve`/`reject` never contains `passwordHash` (same assertion style already used in `auth-credentials.e2e-spec.ts`: `expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$argon2/)`).
- `shared-types` — unit tests confirming each new interface's shape compiles against a literal object matching real API JSON (mirrors `enums.spec.ts`'s existing style).

## Env additions

None.
