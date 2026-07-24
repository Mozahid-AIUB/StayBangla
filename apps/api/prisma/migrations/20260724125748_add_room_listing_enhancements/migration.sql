/*
  Warnings:

  - The `amenities` column on the `hotels` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `check_in_time` to the `hotels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `check_out_time` to the `hotels` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `city` on the `hotels` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `bed_type` to the `rooms` table without a default value. This is not possible if the table is not empty.
  - Added the required column `has_ac` to the `rooms` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `room_type` on the `rooms` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `city` on the `vehicles` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "District" AS ENUM ('DHAKA', 'CHATTOGRAM', 'COXS_BAZAR', 'RANGAMATI', 'BANDARBAN', 'KHAGRACHARI', 'SYLHET', 'SREEMANGAL', 'SAINT_MARTIN', 'KHULNA', 'SUNDARBANS', 'RAJSHAHI', 'BARISHAL', 'RANGPUR', 'MYMENSINGH', 'JESSORE');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'DOUBLE', 'TWIN', 'SUITE', 'FAMILY', 'DORMITORY');

-- CreateEnum
CREATE TYPE "BedType" AS ENUM ('SINGLE', 'TWIN', 'DOUBLE', 'QUEEN', 'KING', 'BUNK');

-- CreateEnum
CREATE TYPE "FacilityCatalog" AS ENUM ('TRAVEL_DESK', 'BATHTUB', 'LAUNDRY_SERVICE', 'WELCOME_DRINKS', 'THEMED_NIGHTS', 'ELEVATOR', 'SMOKE_FREE', 'SWIMMING_POOL', 'PARKING', 'GYM', 'RESTAURANT', 'ROOM_SERVICE', 'WIFI', 'AIR_CONDITIONING', 'GENERATOR_BACKUP', 'CCTV');

-- DropIndex
DROP INDEX "bookings_resource_owner_id_idx";

-- DropIndex
DROP INDEX "bookings_user_id_idx";

-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "check_in_time" TEXT NOT NULL,
ADD COLUMN     "check_out_time" TEXT NOT NULL;
ALTER TABLE "hotels" ALTER COLUMN "city" TYPE "District" USING ("city"::text::"District");
-- NOTE: brief's literal `ARRAY(SELECT unnest(...) ...)` USING-clause form is rejected by
-- Postgres with "cannot use subquery in transform expression" (subqueries are not allowed
-- inside an ALTER COLUMN ... USING expression). The direct array-to-array cast below is the
-- Postgres-supported equivalent: it casts every element through text, same as the brief's intent.
ALTER TABLE "hotels" ALTER COLUMN "amenities" TYPE "FacilityCatalog"[] USING ("amenities"::text[]::"FacilityCatalog"[]);

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "amenities" TEXT[],
ADD COLUMN     "bed_type" "BedType" NOT NULL,
ADD COLUMN     "has_ac" BOOLEAN NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "room_type" TYPE "RoomType" USING ("room_type"::text::"RoomType");

-- AlterTable
ALTER TABLE "vehicles" ALTER COLUMN "city" TYPE "District" USING ("city"::text::"District");

-- CreateTable
CREATE TABLE "vendor_verification_logs" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" "VerifiedStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_photos" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_photos" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_verification_logs_vendor_id_idx" ON "vendor_verification_logs"("vendor_id");

-- CreateIndex
CREATE INDEX "hotel_photos_hotel_id_idx" ON "hotel_photos"("hotel_id");

-- CreateIndex
CREATE INDEX "room_photos_room_id_idx" ON "room_photos"("room_id");

-- AddForeignKey
ALTER TABLE "vendor_verification_logs" ADD CONSTRAINT "vendor_verification_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_verification_logs" ADD CONSTRAINT "vendor_verification_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_photos" ADD CONSTRAINT "hotel_photos_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_photos" ADD CONSTRAINT "room_photos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (partial unique: at most one primary photo per hotel/room)
CREATE UNIQUE INDEX "hotel_photos_one_primary_per_hotel"
  ON "hotel_photos" ("hotel_id") WHERE ("is_primary" = true);
CREATE UNIQUE INDEX "room_photos_one_primary_per_room"
  ON "room_photos" ("room_id") WHERE ("is_primary" = true);
