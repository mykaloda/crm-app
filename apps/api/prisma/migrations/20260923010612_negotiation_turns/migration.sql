-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN     "state" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Negotiation" ADD COLUMN     "nextTurnUserId" TEXT,
ADD COLUMN     "turnSince" TIMESTAMP(3);
