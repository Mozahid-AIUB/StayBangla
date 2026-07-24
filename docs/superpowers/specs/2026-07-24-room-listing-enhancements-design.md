# Room Listing Enhancements + Vendor Approval — Design

**Status:** Approved for planning
**Scope:** Backend + database only (`apps/api`). No frontend/dashboard UI in this change.
**Depends on:** `add-hotel-vehicle-booking-core` (Phase 1, merged via PR #9) — extends the existing `Hotel`/`Room`/`Vehicle`/`User` models.

## Problem

The merged booking-core module lets a VERIFIED vendor list a bare-minimum Hotel/Room/Vehicle (name, city as free text, price, capacity) and lets a traveler book it. Three real gaps stand between that and a usable, enterprise-grade listing platform:

1. **No vendor gatekeeping process.** `verifiedStatus` exists on `User` (PENDING/VERIFIED/REJECTED) but nothing ever moves it — there is no admin-facing approve/reject flow, no reason recorded on rejection, and no audit trail of who approved what and when.
2. **Listings carry almost no searchable/comparable detail.** `city` is free text (a vendor could list under `"Cox's Bazar"`, `"coxsbazar"`, or `"কক্সবাজার"` and fragment search results), `roomType` is free text, and there is no AC/bed-type/facility/photo data at all — the things a traveler in Cox's Bazar/Rangamati/Bandarban/Sylhet/Saint Martin actually compares before booking.
3. **No photos.** MinIO has run since Phase 0 but nothing in the codebase has ever used it.

## Architecture

This module extends four existing models (`User`, `Hotel`, `Room`, `Vehicle`) with new fields and enums, and adds three new models (`VendorVerificationLog`, `HotelPhoto`, `RoomPhoto`). No new bookable resource type, no change to the booking lifecycle, no change to the double-booking-prevention mechanism — this module is purely about listing richness and vendor gatekeeping, layered on top of the already-proven booking core.

```
┌──────────────┐        ┌──────────────────────────┐
│    User      │───────▶│  VendorVerificationLog   │  (new — audit trail)
│ verifiedStatus│ 1:N    │  vendorId, adminId,      │
└──────────────┘        │  action, reason?          │
       │                └──────────────────────────┘
       │ 1:N
       ▼
┌──────────────┐        ┌──────────────┐
│    Hotel     │───────▶│  HotelPhoto  │  (new)
│  city:District│ 1:N    │  isPrimary   │
│  amenities:   │        └──────────────┘
│   Facility[]  │
│  checkIn/Out  │
│    Time       │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐        ┌──────────────┐
│    Room      │───────▶│  RoomPhoto   │  (new)
│  roomType:    │ 1:N    │  isPrimary   │
│    RoomType   │        └──────────────┘
│  bedType,hasAC│
│  amenities[]  │
└──────────────┘

┌──────────────┐
│   Vehicle    │
│  city:District│  (District enum reused — no other new Vehicle fields,
└──────────────┘   per explicit decision: AC/bed attributes are Room-only)
```

## Existing files this module must also touch

Beyond the new schema/endpoints below, the `District`/`RoomType` enum changes are breaking changes to code that already shipped in PR #9 and must be updated in the same change, not left inconsistent:

- `apps/api/src/hotels/dto/search-available-rooms.dto.ts` and `apps/api/src/vehicles/dto/search-available-vehicles.dto.ts` — `city?: string` becomes `city?: District` with `@IsEnum(District)` (currently `@IsString()`).
- `apps/api/src/hotels/dto/create-hotel.dto.ts`, `apps/api/src/vehicles/dto/create-vehicle.dto.ts` — `city: string` becomes `city: District`.
- `apps/api/src/hotels/dto/create-room.dto.ts` — `roomType: string` becomes `roomType: RoomType` (`@IsEnum`), plus new `hasAC`/`bedType`/`amenities` fields.
- `apps/api/src/hotels/hotels.service.ts`'s `searchAvailableRooms` and `apps/api/src/vehicles/vehicles.service.ts`'s `searchAvailable` — their raw-SQL `city` parameter binds a `District` enum value now, not an arbitrary string; the `Prisma.sql` template itself doesn't change (Postgres enum values bind the same way as strings), but the TypeScript parameter type does.
- All existing e2e fixtures that pass `city: "Dhaka"` (`test/helpers/test-fixtures.ts`'s `createHotelWithRoom`, and every e2e spec file that inlines a `city`/`roomType` value) must switch to valid enum literals (`"DHAKA"`, `"DOUBLE"`, etc.) — this will surface as a compile error (good — TypeScript will catch every call site) once the DTOs change.

## Data Model (Prisma changes)

### New enums

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

### Changed models

```prisma
model Hotel {
  // ...existing fields (id, ownerId, name, address, description, starRating,
  //    isActive, createdAt, updatedAt, owner, rooms) UNCHANGED...

  city         District          // CHANGED: was String
  amenities    FacilityCatalog[] // CHANGED: was String[] free-text
  checkInTime  String            // NEW — e.g. "14:00"
  checkOutTime String            // NEW — e.g. "11:00"

  photos HotelPhoto[]            // NEW relation
}

model Room {
  // ...existing fields (id, hotelId, pricePerNightMinor, currency, capacity,
  //    isActive, createdAt, updatedAt, hotel, bookings) UNCHANGED...

  roomType RoomType   // CHANGED: was String free-text (only "DOUBLE" used
                       //   anywhere in shipped code/tests — safe, non-breaking
                       //   migration)
  hasAC    Boolean     // NEW
  bedType  BedType     // NEW
  amenities String[]   // NEW — room-specific extras (Balcony, Sea View...),
                       //   deliberately free-text (small, low-cardinality
                       //   per-room list; not the primary search/filter
                       //   dimension the way Hotel.amenities and hasAC are)

  photos RoomPhoto[]   // NEW relation
}

model Vehicle {
  // ...existing fields UNCHANGED except:
  city District   // CHANGED: was String — same enum as Hotel.city
  // No hasAC/bedType/amenities added to Vehicle — explicit scope decision,
  // CNG/Jeep/Boat attributes are a separate concern for a future module if
  // ever needed.
}
```

### New models

```prisma
model VendorVerificationLog {
  id        String         @id @default(uuid())
  vendorId  String         @map("vendor_id")
  adminId   String         @map("admin_id")
  action    VerifiedStatus @map("action") // VERIFIED or REJECTED only —
                                           // PENDING is never a logged action,
                                           // it's the default pre-review state
  reason    String?                       // required by application logic when
                                           // action=REJECTED; optional (usually
                                           // absent) when action=VERIFIED
  createdAt DateTime       @default(now()) @map("created_at")

  vendor User @relation("VendorVerificationTarget", fields: [vendorId], references: [id])
  admin  User @relation("VendorVerificationActor", fields: [adminId], references: [id])

  @@index([vendorId])
  @@map("vendor_verification_logs")
}

model HotelPhoto {
  id        String   @id @default(uuid())
  hotelId   String   @map("hotel_id")
  objectKey String   @map("object_key") // MinIO object key, not a public URL —
                                         // signed URLs are generated per-request
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

`User` gains two new back-relations (`verificationLogsAsVendor`, `verificationLogsAsAdmin` — named relations since a `User` can appear in `VendorVerificationLog` in two different roles).

### Raw-SQL migration addition

A partial unique index enforces at most one primary photo per hotel/room (Prisma can't express a conditional unique constraint natively):

```sql
CREATE UNIQUE INDEX "hotel_photos_one_primary_per_hotel"
  ON "hotel_photos" ("hotel_id") WHERE ("is_primary" = true);
CREATE UNIQUE INDEX "room_photos_one_primary_per_room"
  ON "room_photos" ("room_id") WHERE ("is_primary" = true);
```

If a vendor marks a new photo primary, the service must first clear the existing primary flag in the same transaction (guarded update, same discipline as the booking module's status transitions) — otherwise the second insert/update would violate this index and surface as a 500 instead of a clean re-assignment.

## Vendor Approval Flow

```
Register ──► PENDING ──► [Admin reviews] ──┬──► VERIFIED  (log row: action=VERIFIED)
                                             │
                                             └──► REJECTED (log row: action=REJECTED, reason required)
                                                       │
                                                       ▼
                                            vendor edits their profile/listings
                                            as needed, then explicitly calls
                                            POST /vendors/me/resubmit
                                                       │
                                                       ▼
                                            REJECTED ──► PENDING (back in the
                                                          admin review queue)
```

Resubmission is a deliberate, explicit action — not an automatic side effect of editing a profile field — so a vendor can make several unrelated edits without accidentally re-triggering review, and an admin's rejection reason stays visible/actionable until the vendor consciously decides they've addressed it.

### Endpoints

```
GET  /admin/vendors/pending              (ADMIN, SUPER_ADMIN) — list PENDING vendors
POST /admin/vendors/:id/approve          (ADMIN, SUPER_ADMIN) — PENDING → VERIFIED
POST /admin/vendors/:id/reject           (ADMIN, SUPER_ADMIN) — PENDING → REJECTED
                                            body: { reason: string }  (required, non-empty)
GET  /admin/vendors/:id/history          (ADMIN, SUPER_ADMIN) — full VendorVerificationLog
                                            for one vendor, newest first
POST /vendors/me/resubmit                (own account, must currently be REJECTED)
                                            → REJECTED → PENDING (idempotent: no-op if
                                              already PENDING/VERIFIED, not an error)
```

`approve`/`reject` both use the same guarded-update discipline established in the booking module: `updateMany({ where: { id, verifiedStatus: "PENDING" }, data: { verifiedStatus: <next> } })`, checking `count === 1` before writing the `VendorVerificationLog` row — this makes concurrent double-review (two admins reviewing the same vendor at once) safe by construction, exactly like `confirmPayment`'s race-safety.

## Photo Upload (Presigned URL)

```
Vendor                    API                         MinIO
  │                         │                            │
  │  POST .../photos/presign│                            │
  │────────────────────────▶│                            │
  │                         │  generate presigned PUT URL│
  │                         │───────────────────────────▶│
  │  { uploadUrl, objectKey}│◀───────────────────────────│
  │◀────────────────────────│                            │
  │                         │                            │
  │  PUT file directly ─────┼───────────────────────────▶│
  │                         │                            │
  │  POST .../photos/confirm                              │
  │  { objectKey, isPrimary }                             │
  │────────────────────────▶│                            │
  │                         │  save HotelPhoto/RoomPhoto  │
  │                         │  row (only after confirm —  │
  │                         │  no orphaned-file cleanup    │
  │                         │  job needed since unconfirmed│
  │                         │  MinIO objects are simply    │
  │                         │  never referenced anywhere)  │
  │  201 photo record       │                            │
  │◀────────────────────────│                            │
```

New `StorageService` (port/adapter pattern, mirroring `PaymentProviderPort`):

```ts
export abstract class StoragePort {
  abstract getPresignedUploadUrl(
    objectKey: string,
    contentType: string,
  ): Promise<string>;
  abstract deleteObject(objectKey: string): Promise<void>;
}
```

A real `MinioStorageService` implementation (using the `minio` npm SDK) is the only implementation needed — there is no "stub" variant the way payment has one, since MinIO already runs in every environment (dev via docker-compose, same story in CI/test) and presigned-URL generation has no side effect worth faking.

### Endpoints

```
POST   /hotels/:id/photos/presign   (owner vendor) → { uploadUrl, objectKey }
POST   /hotels/:id/photos/confirm   (owner vendor) → HotelPhoto row created
POST   /rooms/:id/photos/presign    (owner vendor) → { uploadUrl, objectKey }
POST   /rooms/:id/photos/confirm    (owner vendor) → RoomPhoto row created
DELETE /hotels/:id/photos/:photoId  (owner vendor)
DELETE /rooms/:id/photos/:photoId   (owner vendor)
```

`objectKey` is server-generated (`hotels/{hotelId}/{uuid}.{ext}` / `rooms/{roomId}/{uuid}.{ext}`) — never client-supplied — so a vendor cannot overwrite another vendor's object or write outside their own resource's key prefix. Ownership (does this hotel/room belong to the caller?) is checked before issuing the presigned URL, using the exact same `hotel.ownerId !== callerId` / `room→hotel.ownerId !== callerId` pattern already established in `HotelsService`/`RoomsService`.

## RBAC / CASL

- `/admin/vendors/*` routes: `@Roles("ADMIN", "SUPER_ADMIN")`.
- `/vendors/me/resubmit`: any authenticated VENDOR, operates only on their own `req.user.id` — no CASL condition needed (self-only by construction, same as the existing `/users/me` pattern).
- Photo presign/confirm/delete: owner-only, reusing `HotelsService.findByIdOrThrow`/`RoomsService`'s existing ownership-check helpers rather than duplicating them.

## Explicitly deferred (not scope-creep, tracked for later modules)

| Concern                                                      | Deferred to                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Dashboard UI (vendor booking calendar, super-admin overview) | `add-vendor-dashboard-basic`, `add-admin-panel-basic` (roadmap, next after this)                                 |
| Latitude/longitude + map embed                               | `add-search-map-experience` (Phase 3, already on roadmap)                                                        |
| Vendor-suspension effect on existing/active bookings         | `add-admin-panel-basic`                                                                                          |
| Photo content moderation (NSFW/spam detection)               | Not yet planned — flag if it becomes a real problem                                                              |
| Resubmit rate-limiting (a vendor resubmitting 50 times/day)  | Not yet planned — low risk at current scale, cheap to add later (same Redis rate-limit pattern OTP already uses) |
| Vehicle-level AC/attribute filtering                         | Not requested; explicit decision that Room is the only model getting these attributes in this change             |

## Testing Strategy

TDD throughout, matching the booking-core module's discipline. Key risk areas:

- **Guarded-update race safety** for approve/reject/resubmit — a concurrent double-approve (two admin tabs open) must not double-log or throw an unhandled error; the second call's `updateMany` should observe `count === 0` and respond with a clean, already-handled state (not silently succeed a no-op write).
- **Partial unique index for `isPrimary`** — an e2e test must prove that marking a second photo primary correctly un-sets the first (not: violates the index, not: silently allows two primaries).
- **Ownership checks** on every new endpoint — vendor A cannot presign/confirm/delete a photo on vendor B's hotel/room; a non-admin cannot hit `/admin/vendors/*`.
- **`RoomType`/`District`/`FacilityCatalog` enum migration** — confirm the existing `roomType: "DOUBLE"` test fixtures still work after the `String` → `RoomType` column-type migration (Postgres requires an explicit `USING` cast clause in the raw migration SQL, since a plain Prisma-generated `ALTER COLUMN TYPE` won't safely cast existing text rows to an enum).
- **`/vendors/me/resubmit` idempotency** — calling it while already PENDING or VERIFIED is a safe no-op, not an error, matching the idempotency discipline already established by `confirmPayment`/`checkout`.

## Env additions

The MinIO _container_ has run since Phase 0 (`infra/docker/docker-compose.yml`), but no application code has ever read its connection details — `env.validation.ts` has no `MINIO_*` entries today. This module must add them:

```
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=staybangla          # matches docker-compose's MINIO_ROOT_USER
MINIO_SECRET_KEY=staybangla-secret   # matches docker-compose's MINIO_ROOT_PASSWORD
MINIO_BUCKET=staybangla-photos
PRESIGNED_URL_EXPIRY_SECONDS=300
```

The bucket (`staybangla-photos`) does not exist by default — `MinioStorageService` must create it on startup if missing (idempotent `bucketExists`/`makeBucket` check), the same "don't assume infra state, verify and create if needed" discipline used for the `btree_gist` Postgres extension in the booking-core migration.
