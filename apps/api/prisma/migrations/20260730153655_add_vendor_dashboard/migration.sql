-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "VendorLedgerCategory" AS ENUM ('WALK_IN_BOOKING', 'MAINTENANCE', 'SALARY', 'UTILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'OFFLINE');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'ONLINE';

-- CreateTable
CREATE TABLE "vendor_ledger_entries" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "room_id" TEXT,
    "vehicle_id" TEXT,
    "booking_id" TEXT,
    "direction" "LedgerDirection" NOT NULL,
    "category" "VendorLedgerCategory" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "note" TEXT,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_ledger_entries_vendor_id_entry_date_idx" ON "vendor_ledger_entries"("vendor_id", "entry_date");

-- CreateIndex
CREATE INDEX "vendor_ledger_entries_room_id_idx" ON "vendor_ledger_entries"("room_id");

-- CreateIndex
CREATE INDEX "vendor_ledger_entries_vehicle_id_idx" ON "vendor_ledger_entries"("vehicle_id");

-- CreateIndex
CREATE INDEX "vendor_ledger_entries_booking_id_idx" ON "vendor_ledger_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce exactly one of room_id/vehicle_id is set (defense-in-depth; app
-- layer also validates this) — same pattern as bookings_bookable_consistency_check.
ALTER TABLE "vendor_ledger_entries" ADD CONSTRAINT "vendor_ledger_room_xor_vehicle_check"
  CHECK (("room_id" IS NOT NULL) != ("vehicle_id" IS NOT NULL));

