-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');
-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('GROSS_PAYMENT', 'PLATFORM_FEE', 'VENDOR_OWED');
-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "gateway_tran_id" TEXT,
ADD COLUMN     "gateway_val_id" TEXT,
ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "vendor_owed_minor" INTEGER;
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "commission_rate_percent" INTEGER NOT NULL DEFAULT 10;
-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "rate_percent_applied" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");
-- CreateIndex
CREATE UNIQUE INDEX "bookings_gateway_tran_id_key" ON "bookings"("gateway_tran_id");
-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
