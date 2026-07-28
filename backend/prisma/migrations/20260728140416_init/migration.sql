-- CreateEnum
CREATE TYPE "TournamentState" AS ENUM ('DRAFT', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('PENDING', 'PAIRED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'LATE_ENTRY', 'PAUSED');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "FideTitle" AS ENUM ('GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM', 'NONE');

-- CreateEnum
CREATE TYPE "PairingResult" AS ENUM ('PENDING', 'WHITE_WIN', 'BLACK_WIN', 'DRAW', 'WHITE_WIN_FORFEIT', 'BLACK_WIN_FORFEIT', 'DOUBLE_FORFEIT', 'FULL_POINT_BYE', 'HALF_POINT_BYE', 'ZERO_POINT_BYE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numberOfRounds" INTEGER NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "state" "TournamentState" NOT NULL DEFAULT 'DRAFT',
    "tieBreaks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceleration" JSONB,
    "lateEntryPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "fideId" TEXT,
    "fullName" TEXT NOT NULL,
    "sex" "Sex" NOT NULL,
    "fideTitle" "FideTitle" NOT NULL DEFAULT 'NONE',
    "federation" TEXT,
    "pairingRating" INTEGER NOT NULL DEFAULT 0,
    "officialRating" INTEGER,
    "birthYear" INTEGER,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "startingRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pairing" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "boardNumber" INTEGER NOT NULL,
    "whiteId" TEXT NOT NULL,
    "blackId" TEXT,
    "result" "PairingResult" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Pairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Player_tournamentId_idx" ON "Player"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_tournamentId_fideId_key" ON "Player"("tournamentId", "fideId");

-- CreateIndex
CREATE INDEX "Round_tournamentId_idx" ON "Round"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Round_tournamentId_index_key" ON "Round"("tournamentId", "index");

-- CreateIndex
CREATE INDEX "Pairing_roundId_idx" ON "Pairing"("roundId");

-- CreateIndex
CREATE INDEX "Pairing_whiteId_idx" ON "Pairing"("whiteId");

-- CreateIndex
CREATE INDEX "Pairing_blackId_idx" ON "Pairing"("blackId");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_whiteId_fkey" FOREIGN KEY ("whiteId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pairing" ADD CONSTRAINT "Pairing_blackId_fkey" FOREIGN KEY ("blackId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
