-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "chiefArbiter" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "deputyArbiters" TEXT,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "federation" TEXT,
ADD COLUMN     "timeControl" TEXT,
ADD COLUMN     "tournamentType" TEXT;
