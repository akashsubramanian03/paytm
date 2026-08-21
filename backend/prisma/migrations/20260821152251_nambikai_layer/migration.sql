-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "contributionPaise" INTEGER NOT NULL,
    "plannedCycles" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Group_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "payoutOrder" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" DATETIME,
    CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "amountDuePaise" INTEGER NOT NULL,
    "amountPaidPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "daysLate" INTEGER NOT NULL DEFAULT 0,
    "ledgerEntryId" TEXT,
    "payoutToUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contribution_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contribution_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BehaviourSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "valueBps" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TrustGraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "strengthBps" INTEGER NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "firstSeenAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "evidence" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FinancialHealthScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "breakdown" TEXT NOT NULL,
    "reasonCodes" TEXT NOT NULL,
    "gates" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "computedWithoutClusterData" BOOLEAN NOT NULL DEFAULT true,
    "engineVersion" TEXT NOT NULL,
    "consentRecordId" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialHealthScore_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClusterTrustSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clusterType" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "reliabilityBps" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "observedCycles" INTEGER NOT NULL,
    "onTimeRateBps" INTEGER NOT NULL,
    "missedCount" INTEGER NOT NULL,
    "excludedUserId" TEXT,
    "evidence" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClusterSignalAppeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clusterType" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "suppressed" BOOLEAN NOT NULL DEFAULT true,
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ClusterSignalAppeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UnderwritingReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicantType" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "requestedByPartnerId" TEXT NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "scoreId" TEXT NOT NULL,
    "clusterSignalId" TEXT,
    "clusterSignalIncluded" BOOLEAN NOT NULL DEFAULT false,
    "clusterOmissionReason" TEXT,
    "reasonCodes" TEXT NOT NULL,
    "recommendationText" TEXT NOT NULL,
    "explainerSource" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "consentRecordId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnderwritingReport_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "FinancialHealthScore" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UnderwritingReport_clusterSignalId_fkey" FOREIGN KEY ("clusterSignalId") REFERENCES "ClusterTrustSignal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UnderwritingReport_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consentRecordId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "artifactType" TEXT,
    "artifactId" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "gstNumber" TEXT,
    "registeredAt" DATETIME,
    "city" TEXT NOT NULL DEFAULT 'Chennai',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "monthlyRevenueEstimatePaise" INTEGER NOT NULL,
    "monthlyInflowEstimatePaise" INTEGER NOT NULL,
    "receivablesEstimatePaise" INTEGER NOT NULL,
    "existingDebtEstimatePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Business_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "dueAt" DATETIME,
    "settledAt" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Group_status_idx" ON "Group"("status");

-- CreateIndex
CREATE INDEX "Group_createdById_idx" ON "Group"("createdById");

-- CreateIndex
CREATE INDEX "GroupMember_userId_status_idx" ON "GroupMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_ledgerEntryId_key" ON "Contribution"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "Contribution_userId_dueAt_idx" ON "Contribution"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "Contribution_groupId_cycleIndex_idx" ON "Contribution"("groupId", "cycleIndex");

-- CreateIndex
CREATE INDEX "Contribution_status_dueAt_idx" ON "Contribution"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_groupId_userId_cycleIndex_key" ON "Contribution"("groupId", "userId", "cycleIndex");

-- CreateIndex
CREATE INDEX "BehaviourSignal_subjectType_subjectId_computedAt_idx" ON "BehaviourSignal"("subjectType", "subjectId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BehaviourSignal_subjectType_subjectId_signalKey_windowDays_key" ON "BehaviourSignal"("subjectType", "subjectId", "signalKey", "windowDays");

-- CreateIndex
CREATE INDEX "TrustGraphEdge_toType_toId_idx" ON "TrustGraphEdge"("toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustGraphEdge_fromType_fromId_toType_toId_relation_key" ON "TrustGraphEdge"("fromType", "fromId", "toType", "toId", "relation");

-- CreateIndex
CREATE INDEX "FinancialHealthScore_subjectType_subjectId_computedAt_idx" ON "FinancialHealthScore"("subjectType", "subjectId", "computedAt");

-- CreateIndex
CREATE INDEX "ClusterTrustSignal_clusterType_clusterId_excludedUserId_computedAt_idx" ON "ClusterTrustSignal"("clusterType", "clusterId", "excludedUserId", "computedAt");

-- CreateIndex
CREATE INDEX "ClusterSignalAppeal_userId_status_idx" ON "ClusterSignalAppeal"("userId", "status");

-- CreateIndex
CREATE INDEX "ClusterSignalAppeal_clusterType_clusterId_status_idx" ON "ClusterSignalAppeal"("clusterType", "clusterId", "status");

-- CreateIndex
CREATE INDEX "UnderwritingReport_applicantType_applicantId_generatedAt_idx" ON "UnderwritingReport"("applicantType", "applicantId", "generatedAt");

-- CreateIndex
CREATE INDEX "UnderwritingReport_requestedByPartnerId_generatedAt_idx" ON "UnderwritingReport"("requestedByPartnerId", "generatedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_subjectType_subjectId_dataType_purpose_revokedAt_idx" ON "ConsentRecord"("subjectType", "subjectId", "dataType", "purpose", "revokedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord"("userId");

-- CreateIndex
CREATE INDEX "ConsentAuditLog_subjectType_subjectId_createdAt_idx" ON "ConsentAuditLog"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentAuditLog_artifactType_artifactId_idx" ON "ConsentAuditLog"("artifactType", "artifactId");

-- CreateIndex
CREATE INDEX "ConsentAuditLog_requestId_idx" ON "ConsentAuditLog"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_gstNumber_key" ON "Business"("gstNumber");

-- CreateIndex
CREATE INDEX "Business_ownerId_idx" ON "Business"("ownerId");

-- CreateIndex
CREATE INDEX "BusinessRecord_businessId_kind_periodStart_idx" ON "BusinessRecord"("businessId", "kind", "periodStart");

-- CreateIndex
CREATE INDEX "BusinessRecord_businessId_status_idx" ON "BusinessRecord"("businessId", "status");
