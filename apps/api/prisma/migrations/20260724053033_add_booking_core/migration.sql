-- CreateEnum
CREATE TYPE "BookableType" AS ENUM ('ROOM', 'VEHICLE');

-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('CNG', 'JEEP', 'BOAT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'AUTO_CANCELLED', 'CANCELLED', 'REFUNDED', 'BLOCKED');

-- CreateTable
CREATE TABLE "hotels" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT,
    "amenities" TEXT[],
    "star_rating" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "price_per_night_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "capacity" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "city" TEXT NOT NULL,
    "model" TEXT,
    "capacity" INTEGER NOT NULL,
    "price_per_day_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "bookable_type" "BookableType" NOT NULL,
    "room_id" TEXT,
    "vehicle_id" TEXT,
    "resource_owner_id" TEXT NOT NULL,
    "date_range" daterange NOT NULL,
    "guest_count" INTEGER,
    "total_amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
