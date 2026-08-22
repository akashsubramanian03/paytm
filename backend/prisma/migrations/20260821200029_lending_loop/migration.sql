-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "requestedPaise" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "scoreId" TEXT,
    "reportId" TEXT,
    "affordability" TEXT NOT NULL,
    "declineReasonCodes" TEXT,
    "consentRecordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanApplication_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoanOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "sanctionedPaise" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "flatRateBps" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "emiPaise" INTEGER NOT NULL,
    "totalRepayablePaise" INTEGER NOT NULL,
    "totalInterestPaise" INTEGER NOT NULL,
    "suggestedDueDay" INTEGER NOT NULL,
    "dueDayRationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanOffer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "principalPaise" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "emiPaise" INTEGER NOT NULL,
    "dueDayOfMonth" INTEGER NOT NULL,
    "disbursedAt" DATETIME NOT NULL,
    "disbursementLedgerEntryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outstandingPaise" INTEGER NOT NULL,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Loan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Loan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Loan_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LoanOffer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "installmentIndex" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "amountDuePaise" INTEGER NOT NULL,
    "principalPaise" INTEGER NOT NULL,
    "interestPaise" INTEGER NOT NULL,
    "amountPaidPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "daysLate" INTEGER NOT NULL DEFAULT 0,
    "ledgerEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanInstallment_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KycRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "maskedId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'SIMULATED_FORMAT_CHECK',
    "failureReason" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnomalyFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severityBps" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LoanApplication_userId_createdAt_idx" ON "LoanApplication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoanApplication_status_idx" ON "LoanApplication"("status");

-- CreateIndex
CREATE INDEX "LoanOffer_applicationId_status_idx" ON "LoanOffer"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_applicationId_key" ON "Loan"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_offerId_key" ON "Loan"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_disbursementLedgerEntryId_key" ON "Loan"("disbursementLedgerEntryId");

-- CreateIndex
CREATE INDEX "Loan_userId_status_idx" ON "Loan"("userId", "status");

-- CreateIndex
CREATE INDEX "Loan_partnerId_status_idx" ON "Loan"("partnerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_ledgerEntryId_key" ON "LoanInstallment"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "LoanInstallment_loanId_dueAt_idx" ON "LoanInstallment"("loanId", "dueAt");

-- CreateIndex
CREATE INDEX "LoanInstallment_status_dueAt_idx" ON "LoanInstallment"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_loanId_installmentIndex_key" ON "LoanInstallment"("loanId", "installmentIndex");

-- CreateIndex
CREATE INDEX "KycRecord_userId_status_idx" ON "KycRecord"("userId", "status");

-- CreateIndex
CREATE INDEX "AnomalyFlag_subjectType_subjectId_computedAt_idx" ON "AnomalyFlag"("subjectType", "subjectId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnomalyFlag_subjectType_subjectId_kind_windowStart_key" ON "AnomalyFlag"("subjectType", "subjectId", "kind", "windowStart");
