-- CreateTable
CREATE TABLE "Minimization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "originalConfigSnapshot" TEXT NOT NULL,
    "minimizedConfig" TEXT,
    "predicate" TEXT NOT NULL,
    "minReproductionRate" REAL NOT NULL DEFAULT 1.0,
    "strategy" TEXT NOT NULL DEFAULT 'staged_delta_debugging',
    "maxAttempts" INTEGER NOT NULL DEFAULT 50,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "trialsPerCandidate" INTEGER NOT NULL DEFAULT 1,
    "finalTrials" INTEGER NOT NULL DEFAULT 3,
    "finalObservedRate" REAL,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'cleaned',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Minimization_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MinimizationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "minimizationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "changeDesc" TEXT NOT NULL,
    "candidateConfig" TEXT NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "trialCount" INTEGER NOT NULL,
    "failedTrials" INTEGER NOT NULL,
    "reproductionRate" REAL NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MinimizationAttempt_minimizationId_fkey" FOREIGN KEY ("minimizationId") REFERENCES "Minimization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Minimization_sourceRunId_idx" ON "Minimization"("sourceRunId");

-- CreateIndex
CREATE INDEX "Minimization_status_idx" ON "Minimization"("status");

-- CreateIndex
CREATE INDEX "Minimization_createdAt_idx" ON "Minimization"("createdAt");

-- CreateIndex
CREATE INDEX "MinimizationAttempt_minimizationId_idx" ON "MinimizationAttempt"("minimizationId");

-- CreateIndex
CREATE INDEX "MinimizationAttempt_minimizationId_attemptNumber_idx" ON "MinimizationAttempt"("minimizationId", "attemptNumber");
