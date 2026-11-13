-- CreateEnum
CREATE TYPE "CreditFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "promissoryCounter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CreditSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "downPayment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "financedAmount" DECIMAL(14,2) NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "frequency" "CreditFrequency" NOT NULL DEFAULT 'MONTHLY',
    "firstDueDate" TIMESTAMP(3) NOT NULL,
    "lateFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "creditSaleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "creditSaleId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "isDownPayment" BOOLEAN NOT NULL DEFAULT false,
    "receivedById" TEXT NOT NULL,
    "cashSessionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromissoryNote" (
    "id" TEXT NOT NULL,
    "creditSaleId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "debtorSnapshot" JSONB NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountInWords" TEXT NOT NULL,
    "legalText" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "notaryInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromissoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditSale_saleId_key" ON "CreditSale"("saleId");

-- CreateIndex
CREATE INDEX "CreditSale_tenantId_status_idx" ON "CreditSale"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CreditSale_customerId_idx" ON "CreditSale"("customerId");

-- CreateIndex
CREATE INDEX "Installment_creditSaleId_idx" ON "Installment"("creditSaleId");

-- CreateIndex
CREATE INDEX "CreditPayment_tenantId_createdAt_idx" ON "CreditPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditPayment_creditSaleId_idx" ON "CreditPayment"("creditSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "PromissoryNote_creditSaleId_key" ON "PromissoryNote"("creditSaleId");

-- AddForeignKey
ALTER TABLE "CreditSale" ADD CONSTRAINT "CreditSale_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditSale" ADD CONSTRAINT "CreditSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_creditSaleId_fkey" FOREIGN KEY ("creditSaleId") REFERENCES "CreditSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPayment" ADD CONSTRAINT "CreditPayment_creditSaleId_fkey" FOREIGN KEY ("creditSaleId") REFERENCES "CreditSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromissoryNote" ADD CONSTRAINT "PromissoryNote_creditSaleId_fkey" FOREIGN KEY ("creditSaleId") REFERENCES "CreditSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
