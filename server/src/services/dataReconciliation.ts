/**
 * Data Reconciliation Service
 *
 * Merges credit report data (older, richer) with Creditor CSV data (newer, fresher amounts)
 * to produce the most accurate and complete account picture.
 *
 * Strategy:
 *   - Creditor CSV is the source of truth for: outstanding, overdue, status, ROI,
 *     tenure, tenurePaid, delinquency, lastPaymentDate, reportedDate, debtType
 *   - Credit report supplements with: DPD history/trends, creditLimit, accountType
 *     (secured/unsecured), writtenOffStatus, suitFiled, enquiries, openDate
 *   - When both sources have a field, the fresher one wins (by reportedDate vs reportDate)
 *   - Accounts in CSV but not in credit report are included (new accounts)
 *   - Accounts in credit report but closed in CSV are marked CLOSED
 *   - Accounts only in credit report (not in CSV) are kept with a staleness flag
 */

import {
  CreditorAccount,
  EnrichedAccount,
  EnrichedCreditReport,
  DPDSummary,
  PortfolioSummary,
} from '../types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ReconciledAccount {
  lenderName: string;
  status: 'ACTIVE' | 'CLOSED' | string;
  accountType: string;         // SECURED / UNSECURED / OTHERS
  debtType: string;
  outstandingAmount: number | null;
  overdueAmount: number | null;
  creditLimit: number | null;
  sanctionedAmount: number | null;
  roi: number | null;
  repaymentTenure: number | null;
  tenurePaid: number | null;
  estimatedEMI: number | null;
  openDate: string | null;
  closedDate: string | null;
  lastPaymentDate: string | null;
  delinquency: number | null;
  writtenOffStatus: string | null;
  suitFiled: string | null;
  dpd: DPDSummary;
  /** Which sources contributed to this account */
  dataSources: Array<'credit_report' | 'creditor_csv'>;
  /** Date of the freshest data used for financial amounts */
  dataAsOf: string | null;
}

export interface ReconciliationResult {
  accounts: ReconciledAccount[];
  creditScore: number | null;
  bureau: string;
  reportDate: string;            // freshest date across all sources
  enquiries: Array<{ reason: string; amount: number | null }>;
  summary: PortfolioSummary;
  reconciliationLog: string[];   // human-readable log of what was merged/overridden
}

// ── Date parsing helpers ────────────────────────────────────────────────────

/**
 * Parse various date formats into a comparable timestamp.
 * Handles: "2025-11-21", "Feb 15, 2026, 5:30 AM", "Jan 31, 2026, 5:30 AM"
 */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateISO(dateStr: string | null | undefined): string | null {
  const d = parseDate(dateStr);
  if (!d) return null;
  return d.toISOString().split('T')[0];
}

function isNewer(dateA: string | null | undefined, dateB: string | null | undefined): boolean {
  const a = parseDate(dateA);
  const b = parseDate(dateB);
  if (!a) return false;
  if (!b) return true;
  return a.getTime() > b.getTime();
}

// ── Lender name normalization for matching ──────────────────────────────────

function normalizeLenderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(limited|ltd|pvt|private|public)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy match two lender names. Returns true if they likely refer to the same entity.
 */
// Generic financial/geographic words that are too common to count as distinguishing tokens
const LENDER_STOPWORDS = new Set([
  'finance', 'financial', 'india', 'indian', 'capital', 'services', 'bank', 'banking',
  'credit', 'investment', 'investments', 'asset', 'management', 'housing', 'securities',
  'loans', 'money', 'funds', 'fund', 'leasing', 'fincorp', 'corporation', 'company',
]);

function lenderMatch(a: string, b: string): boolean {
  const na = normalizeLenderName(a);
  const nb = normalizeLenderName(b);

  // Exact normalized match
  if (na === nb) return true;

  // One contains the other (handles "HDFC Bank" vs "HDFC Bank Ltd")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Token overlap: require 2+ NON-generic tokens to match.
  // Generic words like "finance", "india", "capital" are filtered out so they
  // cannot cause unrelated lenders (e.g. "Home Credit India Finance" vs "PayU Finance India")
  // to be incorrectly matched.
  const tokensA = na.split(' ').filter(t => t.length > 2);
  const tokensB = nb.split(' ').filter(t => t.length > 2);
  const overlap = tokensA.filter(t => tokensB.includes(t));
  const significantOverlap = overlap.filter(t => !LENDER_STOPWORDS.has(t));
  if (significantOverlap.length >= 2) return true;

  // First significant word match (handles "Hero FinCorp" vs "Hero Fincorp Ltd")
  if (tokensA.length > 0 && tokensB.length > 0 && tokensA[0] === tokensB[0]) {
    // Check second word is close enough
    if (tokensA.length >= 2 && tokensB.length >= 2) {
      if (tokensA[1].startsWith(tokensB[1].slice(0, 3)) || tokensB[1].startsWith(tokensA[1].slice(0, 3))) {
        return true;
      }
    }
    // Single-word match with same first token
    if (tokensA.length === 1 || tokensB.length === 1) return true;
  }

  return false;
}

/**
 * Match a creditor account to its credit report counterpart.
 * Uses lender name + open date + sanctioned amount for disambiguation.
 */
function findReportMatch(
  creditor: CreditorAccount,
  reportAccounts: EnrichedAccount[],
  alreadyMatched: Set<number>,
): number {
  const candidates: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < reportAccounts.length; i++) {
    if (alreadyMatched.has(i)) continue;
    const ra = reportAccounts[i];

    if (!lenderMatch(creditor.lenderName, ra.lenderName)) continue;

    // Score the match quality
    let score = 1; // base: lender name matches

    // Open date match
    const credOpenDate = formatDateISO(creditor.openDate);
    const reportOpenDate = ra.openDate;
    if (credOpenDate && reportOpenDate && credOpenDate === reportOpenDate) {
      score += 3; // strong signal
    }

    // Sanctioned amount match (within 10% tolerance for rounding)
    const credSanc = creditor.sanctionedAmount ?? 0;
    const reportSanc = ra.sanctionedAmount ?? 0;
    if (credSanc > 0 && reportSanc > 0) {
      const diff = Math.abs(credSanc - reportSanc) / Math.max(credSanc, reportSanc);
      if (diff < 0.1) score += 2;
    }

    // Debt type similarity
    const credDT = (creditor.debtType || '').toLowerCase();
    const reportDT = (ra.debtType || '').toLowerCase();
    if (credDT.includes('card') && reportDT.includes('card')) score += 1;
    else if (credDT.includes('loan') && reportDT.includes('loan')) score += 1;

    candidates.push({ index: i, score });
  }

  if (candidates.length === 0) return -1;

  // Return the best match
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].index;
}

// ── Default DPD summary for accounts without credit report data ─────────────

function defaultDPD(delinquency: number | null): DPDSummary {
  const dpd = delinquency ?? 0;
  return {
    maxDPD: Math.max(0, dpd),
    currentDPD: Math.max(0, dpd),
    monthsWithDPD: dpd > 0 ? 1 : 0,
    totalMonths: 1,
    recentTrend: dpd > 0 ? [dpd] : [0],
    improving: false,
    worstPeriod: null,
  };
}

/**
 * Merge credit report DPD history with CSV delinquency value.
 * If CSV reports a higher delinquency than the credit report's maxDPD,
 * update maxDPD and currentDPD to reflect the fresher CSV data.
 */
function mergeDPD(reportDPD: DPDSummary, csvDelinquency: number | null): DPDSummary {
  const csvDays = Math.max(0, csvDelinquency ?? 0);
  if (csvDays <= (reportDPD.maxDPD ?? 0) && csvDays <= (reportDPD.currentDPD ?? 0)) {
    return reportDPD; // credit report already captures the delinquency
  }

  return {
    ...reportDPD,
    maxDPD: Math.max(reportDPD.maxDPD ?? 0, csvDays),
    currentDPD: Math.max(reportDPD.currentDPD ?? 0, csvDays),
    monthsWithDPD: csvDays > 0 && reportDPD.monthsWithDPD === 0
      ? Math.max(1, reportDPD.monthsWithDPD)
      : reportDPD.monthsWithDPD,
  };
}

// ── Core reconciliation ─────────────────────────────────────────────────────

/**
 * Reconcile credit report and Creditor CSV data into a unified account list.
 *
 * @param report     - Enriched credit report (may be null if no credit report exists)
 * @param creditors  - Creditor CSV accounts for this user
 * @returns ReconciliationResult with merged accounts and log
 */
export function reconcileData(
  report: EnrichedCreditReport | null,
  creditors: CreditorAccount[],
): ReconciliationResult {
  const log: string[] = [];
  const reconciled: ReconciledAccount[] = [];

  // No data at all
  if (!report && creditors.length === 0) {
    return {
      accounts: [],
      creditScore: null,
      bureau: '',
      reportDate: '',
      enquiries: [],
      summary: emptySummary(),
      reconciliationLog: ['No data from either source'],
    };
  }

  // Only Creditor CSV (no credit report)
  if (!report) {
    log.push('No credit report — using Creditor CSV as sole source');
    for (const c of creditors) {
      reconciled.push(accountFromCreditorOnly(c));
    }
    return buildResult(reconciled, null, creditors, log);
  }

  // Only credit report (no Creditor CSV)
  if (creditors.length === 0) {
    log.push('No Creditor CSV data — using credit report as sole source');
    for (const ra of report.accounts) {
      reconciled.push(accountFromReportOnly(ra));
    }
    return buildResult(reconciled, report, creditors, log);
  }

  // ── Both sources available — reconcile ──────────────────────────────────

  const reportDate = parseDate(report.reportDate);
  log.push(`Credit report date: ${report.reportDate}`);

  const alreadyMatchedReport = new Set<number>();

  // Phase 1: Match each CSV account to its credit report counterpart
  for (const creditor of creditors) {
    const matchIdx = findReportMatch(creditor, report.accounts, alreadyMatchedReport);
    const credReportedDate = formatDateISO(creditor.reportedDate);

    if (matchIdx >= 0) {
      // Matched — merge the two sources
      alreadyMatchedReport.add(matchIdx);
      const ra = report.accounts[matchIdx];
      const csvIsFresher = isNewer(creditor.reportedDate, report.reportDate);

      const merged = mergeAccount(ra, creditor, csvIsFresher);
      reconciled.push(merged);

      // Log significant differences
      const outDiff = Math.abs((creditor.outstandingAmount ?? 0) - (ra.outstandingAmount ?? 0));
      if (outDiff > 1000) {
        log.push(
          `${creditor.lenderName}: outstanding updated ₹${ra.outstandingAmount?.toLocaleString('en-IN')} → ₹${creditor.outstandingAmount?.toLocaleString('en-IN')}` +
          ` (CSV ${credReportedDate || 'unknown'} vs report ${report.reportDate})`
        );
      }

      if (ra.status === 'ACTIVE' && creditor.accountStatus.toUpperCase() === 'CLOSED') {
        log.push(`${creditor.lenderName}: status changed ACTIVE → CLOSED (CSV is newer)`);
      }

      if ((creditor.overdueAmount ?? 0) > 0 && (ra.overdueAmount ?? 0) === 0) {
        log.push(`${creditor.lenderName}: new overdue ₹${creditor.overdueAmount?.toLocaleString('en-IN')} (not in credit report)`);
      }
    } else {
      // CSV-only account (not in credit report — new account or different name)
      log.push(`${creditor.lenderName}: found in CSV only (not matched to credit report) — added as new account`);
      reconciled.push(accountFromCreditorOnly(creditor));
    }
  }

  // Phase 2: Add unmatched credit report accounts (not in CSV)
  for (let i = 0; i < report.accounts.length; i++) {
    if (alreadyMatchedReport.has(i)) continue;
    const ra = report.accounts[i];

    // Only add if it's an active account — stale closed accounts aren't useful
    if (ra.status === 'ACTIVE') {
      log.push(`${ra.lenderName}: found in credit report only (no CSV match) — included with stale flag`);
    }
    reconciled.push(accountFromReportOnly(ra));
  }

  return buildResult(reconciled, report, creditors, log);
}

// ── Merge a matched pair (credit report account + creditor CSV account) ─────

function mergeAccount(
  ra: EnrichedAccount,
  creditor: CreditorAccount,
  csvIsFresher: boolean,
): ReconciledAccount {
  // Financial amounts: prefer fresher source
  const outstanding = csvIsFresher ? (creditor.outstandingAmount ?? ra.outstandingAmount) : (ra.outstandingAmount ?? creditor.outstandingAmount);
  const overdue = csvIsFresher ? (creditor.overdueAmount ?? ra.overdueAmount) : (ra.overdueAmount ?? creditor.overdueAmount);
  const status = csvIsFresher ? (creditor.accountStatus.toUpperCase() || ra.status) : ra.status;
  const roi = pickFresher(creditor.roi, ra.roi, csvIsFresher);
  const lastPayDate = csvIsFresher
    ? (formatDateISO(creditor.lastPaymentDate) || ra.lastPaymentDate)
    : (ra.lastPaymentDate || formatDateISO(creditor.lastPaymentDate));
  const debtType = csvIsFresher ? (creditor.debtType || ra.debtType) : (ra.debtType || creditor.debtType);

  return {
    lenderName: ra.lenderName,  // credit report usually has cleaner names
    status,
    accountType: ra.accountType || '',
    debtType,
    outstandingAmount: outstanding,
    overdueAmount: overdue,
    creditLimit: ra.creditLimit,  // only in credit report
    sanctionedAmount: creditor.sanctionedAmount ?? ra.sanctionedAmount,
    roi,
    repaymentTenure: creditor.repaymentTenure ?? ra.repaymentTenure,
    tenurePaid: creditor.tenurePaid ?? null,
    estimatedEMI: ra.estimatedEMI,  // from bureau if available
    openDate: ra.openDate || formatDateISO(creditor.openDate),
    closedDate: formatDateISO(creditor.closedDate) || ra.closedDate,
    lastPaymentDate: lastPayDate,
    delinquency: Math.max(0, csvIsFresher ? (creditor.delinquency ?? 0) : (ra.delinquency ?? creditor.delinquency ?? 0)) || null,
    writtenOffStatus: ra.writtenOffStatus,  // only in credit report
    suitFiled: ra.suitFiled ?? (creditor.suitFiledWilfulDefault || null),
    dpd: mergeDPD(ra.dpd, creditor.delinquency),  // merge credit report DPD with CSV delinquency
    dataSources: ['credit_report', 'creditor_csv'],
    dataAsOf: formatDateISO(creditor.reportedDate) || ra.lastPaymentDate || null,
  };
}

function pickFresher<T>(csvVal: T | null, reportVal: T | null, csvIsFresher: boolean): T | null {
  if (csvIsFresher) return csvVal ?? reportVal ?? null;
  return reportVal ?? csvVal ?? null;
}

// ── Single-source account converters ────────────────────────────────────────

function accountFromReportOnly(ra: EnrichedAccount): ReconciledAccount {
  return {
    lenderName: ra.lenderName,
    status: ra.status,
    accountType: ra.accountType,
    debtType: ra.debtType,
    outstandingAmount: ra.outstandingAmount,
    overdueAmount: ra.overdueAmount,
    creditLimit: ra.creditLimit,
    sanctionedAmount: ra.sanctionedAmount,
    roi: ra.roi,
    repaymentTenure: ra.repaymentTenure,
    tenurePaid: null,
    estimatedEMI: ra.estimatedEMI,
    openDate: ra.openDate,
    closedDate: ra.closedDate,
    lastPaymentDate: ra.lastPaymentDate,
    delinquency: ra.delinquency,
    writtenOffStatus: ra.writtenOffStatus,
    suitFiled: ra.suitFiled,
    dpd: ra.dpd,
    dataSources: ['credit_report'],
    dataAsOf: ra.lastPaymentDate,
  };
}

function accountFromCreditorOnly(c: CreditorAccount): ReconciledAccount {
  const isClosed = (c.accountStatus || '').toUpperCase() === 'CLOSED';
  return {
    lenderName: c.lenderName,
    status: c.accountStatus.toUpperCase() || 'UNKNOWN',
    accountType: c.accountType || '',
    debtType: c.debtType,
    outstandingAmount: c.outstandingAmount,
    // Never carry delinquency signals on closed accounts — the debt is resolved
    overdueAmount: isClosed ? null : c.overdueAmount,
    creditLimit: c.creditLimitAmount,
    sanctionedAmount: c.sanctionedAmount,
    roi: c.roi,
    repaymentTenure: c.repaymentTenure,
    tenurePaid: c.tenurePaid ?? null,
    estimatedEMI: null,
    openDate: formatDateISO(c.openDate),
    closedDate: formatDateISO(c.closedDate),
    lastPaymentDate: formatDateISO(c.lastPaymentDate),
    delinquency: isClosed ? null : (Math.max(0, c.delinquency ?? 0) || null),
    writtenOffStatus: null,
    suitFiled: c.suitFiledWilfulDefault || null,
    dpd: isClosed ? defaultDPD(null) : defaultDPD(c.delinquency),
    dataSources: ['creditor_csv'],
    dataAsOf: formatDateISO(c.reportedDate),
  };
}

// ── Build final result with recomputed summary ──────────────────────────────

function buildResult(
  accounts: ReconciledAccount[],
  report: EnrichedCreditReport | null,
  creditors: CreditorAccount[],
  log: string[],
): ReconciliationResult {
  // Sort: active first, then by outstanding descending
  accounts.sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
    return (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0);
  });

  const active = accounts.filter(a => a.status === 'ACTIVE');
  const closed = accounts.filter(a => a.status !== 'ACTIVE');

  // Find the freshest date across all accounts
  let freshestDate = report?.reportDate || '';
  for (const a of accounts) {
    if (a.dataAsOf && isNewer(a.dataAsOf, freshestDate)) {
      freshestDate = a.dataAsOf;
    }
  }

  // Recompute summary from reconciled data
  const totalOutstanding = active.reduce((s, a) => s + (a.outstandingAmount ?? 0), 0);
  const securedAccounts = active.filter(a => /home|vehicle|mortgage|secured|gold/i.test(a.debtType) || a.accountType === 'SECURED');
  const unsecuredAccounts = active.filter(a => !securedAccounts.includes(a));
  const securedOutstanding = securedAccounts.reduce((s, a) => s + (a.outstandingAmount ?? 0), 0);
  const unsecuredOutstanding = totalOutstanding - securedOutstanding;

  const delinquent = active.filter(a => (a.outstandingAmount ?? 0) > 0 && ((a.delinquency ?? 0) > 0 || (a.overdueAmount ?? 0) > 0 || (a.dpd.maxDPD ?? 0) > 0));

  const roiAccounts = active.filter(a => (a.roi ?? 0) > 0).sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));
  const largestDebt = active.length > 0
    ? { lender: active[0].lenderName, amount: active[0].outstandingAmount ?? 0, type: active[0].debtType }
    : null;
  const worstDPD = [...active].sort((a, b) => (b.dpd.maxDPD ?? 0) - (a.dpd.maxDPD ?? 0))[0];

  const summary: PortfolioSummary = {
    activeCount: active.length,
    closedCount: closed.length,
    delinquentCount: delinquent.length,
    totalOutstanding,
    securedOutstanding,
    unsecuredOutstanding,
    securedActiveCount: securedAccounts.length,
    unsecuredActiveCount: unsecuredAccounts.length,
    creditCardCount: active.filter(a => /credit card/i.test(a.debtType)).length,
    personalLoanCount: active.filter(a => /personal loan|short term/i.test(a.debtType)).length,
    highestROI: roiAccounts.length > 0 ? { lender: roiAccounts[0].lenderName, rate: roiAccounts[0].roi! } : null,
    lowestROI: roiAccounts.length > 0 ? { lender: roiAccounts[roiAccounts.length - 1].lenderName, rate: roiAccounts[roiAccounts.length - 1].roi! } : null,
    largestDebt,
    worstDPDAccount: worstDPD && worstDPD.dpd.maxDPD > 0
      ? { lender: worstDPD.lenderName, maxDPD: worstDPD.dpd.maxDPD, type: worstDPD.debtType }
      : null,
  };

  return {
    accounts,
    creditScore: report?.creditScore ?? null,
    bureau: report?.bureau ?? 'EXPERIAN',
    reportDate: freshestDate,
    enquiries: report?.enquiries ?? [],
    summary,
    reconciliationLog: log,
  };
}

function emptySummary(): PortfolioSummary {
  return {
    activeCount: 0, closedCount: 0, delinquentCount: 0,
    totalOutstanding: 0, securedOutstanding: 0, unsecuredOutstanding: 0,
    securedActiveCount: 0, unsecuredActiveCount: 0,
    creditCardCount: 0, personalLoanCount: 0,
    highestROI: null, lowestROI: null, largestDebt: null, worstDPDAccount: null,
  };
}

// ── Convert reconciled accounts to EnrichedAccount format ───────────────────
// This allows the reconciled data to plug into the existing pipeline seamlessly

/**
 * Convert reconciliation result into an EnrichedCreditReport that the existing
 * advisorContext pipeline can consume without changes to its interface.
 */
export function toEnrichedReport(result: ReconciliationResult): EnrichedCreditReport {
  const accounts: EnrichedAccount[] = result.accounts.map(a => ({
    lenderName: a.lenderName,
    status: a.status,
    accountType: a.accountType,
    debtType: a.debtType,
    outstandingAmount: a.outstandingAmount,
    overdueAmount: a.overdueAmount,
    creditLimit: a.creditLimit,
    sanctionedAmount: a.sanctionedAmount,
    roi: a.roi,
    repaymentTenure: a.repaymentTenure,
    estimatedEMI: a.estimatedEMI,
    openDate: a.openDate,
    closedDate: a.closedDate,
    lastPaymentDate: a.lastPaymentDate,
    delinquency: a.delinquency,
    writtenOffStatus: a.writtenOffStatus,
    suitFiled: a.suitFiled,
    dpd: a.dpd,
  }));

  return {
    creditScore: result.creditScore,
    bureau: result.bureau,
    reportDate: result.reportDate,
    summary: result.summary,
    accounts,
    enquiries: result.enquiries,
  };
}
