-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('VENDOR_APPROVED', 'VENDOR_REJECTED', 'VENDOR_RESUBMITTED', 'VENDOR_SUSPENDED', 'VENDOR_UNSUSPENDED', 'COMMISSION_RATE_CHANGED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspension_reason" TEXT;

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "action" "AdminActionType" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_id_idx" ON "admin_audit_logs"("target_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_id_idx" ON "admin_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing vendor_verification_logs rows into admin_audit_logs
-- before the old table is dropped. VerifiedStatus -> AdminActionType:
--   VERIFIED  -> VENDOR_APPROVED
--   REJECTED  -> VENDOR_REJECTED
--   PENDING   -> VENDOR_RESUBMITTED (a PENDING-action row only ever came
--     from VendorVerificationService.resubmit(), which sets action='PENDING')
INSERT INTO "admin_audit_logs" (id, actor_id, target_id, action, reason, metadata, created_at)
SELECT
  id,
  admin_id,
  vendor_id,
  CASE action
    WHEN 'VERIFIED' THEN 'VENDOR_APPROVED'
    WHEN 'REJECTED' THEN 'VENDOR_REJECTED'
    WHEN 'PENDING' THEN 'VENDOR_RESUBMITTED'
  END::"AdminActionType",
  reason,
  NULL,
  created_at
FROM "vendor_verification_logs";

-- DropForeignKey
ALTER TABLE "vendor_verification_logs" DROP CONSTRAINT "vendor_verification_logs_admin_id_fkey";

-- DropForeignKey
ALTER TABLE "vendor_verification_logs" DROP CONSTRAINT "vendor_verification_logs_vendor_id_fkey";

-- DropTable
DROP TABLE "vendor_verification_logs";
