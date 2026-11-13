-- AlterTable
ALTER TABLE "TenantEcfConfig" ADD COLUMN     "pronesoftBusinessId" TEXT,
ADD COLUMN     "pronesoftRnc" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL,
ALTER COLUMN "clientSecretEnc" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlatformEcfConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeEnvironment" TEXT NOT NULL DEFAULT 'sandbox',
    "sandboxClientId" TEXT,
    "sandboxClientSecretEnc" TEXT,
    "prodClientId" TEXT,
    "prodClientSecretEnc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformEcfConfig_pkey" PRIMARY KEY ("id")
);
