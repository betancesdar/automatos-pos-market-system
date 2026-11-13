-- AlterTable
ALTER TABLE "EcfSubmission" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "encf" TEXT,
ADD COLUMN     "legalStatus" TEXT,
ADD COLUMN     "response" JSONB;
