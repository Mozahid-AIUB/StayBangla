-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_booking_id_type_key" ON "ledger_entries"("booking_id", "type");

