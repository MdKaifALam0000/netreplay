-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'toxiproxy',
    "config" TEXT NOT NULL,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "replayedFromId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "configSnapshot" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "summary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RequestResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "requestIndex" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" REAL NOT NULL,
    "errorCategory" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" TEXT,
    CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Profile_createdAt_idx" ON "Profile"("createdAt");

-- CreateIndex
CREATE INDEX "Run_profileId_idx" ON "Run"("profileId");

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt");

-- CreateIndex
CREATE INDEX "RequestResult_runId_idx" ON "RequestResult"("runId");

-- CreateIndex
CREATE INDEX "RequestResult_runId_requestIndex_idx" ON "RequestResult"("runId", "requestIndex");

-- CreateIndex
CREATE INDEX "RunEvent_runId_idx" ON "RunEvent"("runId");

-- CreateIndex
CREATE INDEX "RunEvent_runId_timestamp_idx" ON "RunEvent"("runId", "timestamp");
