-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "hold_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");
