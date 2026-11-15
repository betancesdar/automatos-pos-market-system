-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "carryConsumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "carryOverToNext" BOOLEAN NOT NULL DEFAULT false;
