-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "bookings_resource_owner_id_idx" ON "bookings"("resource_owner_id");
