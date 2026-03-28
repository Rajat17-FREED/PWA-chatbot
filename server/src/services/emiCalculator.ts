/**
 * EMI Calculator Service
 *
 * Computes Equated Monthly Instalments using the standard reducing-balance formula:
 *   EMI = P × r × (1 + r)^n / ((1 + r)^n - 1)
 *
 * Also provides:
 *   - Total interest & total payment calculations
 *   - Per-account EMI estimation when bureau data is missing
 *   - Portfolio-level consolidation savings projections
 *   - Amortization schedule helpers
 *
 * Reference: https://emicalculator.net/
 */

import { AdvisorAccountContext } from '../types';

// ── Core types ──────────────────────────────────────────────────────────────

export interface EMIResult {
  emi: number;                  // monthly EMI (₹)
  totalInterest: number;        // total interest over loan tenure (₹)
  totalPayment: number;         // principal + total interest (₹)
  principal: number;            // original principal (₹)
  annualRate: number;           // annual interest rate (%)
  tenureMonths: number;         // tenure in months
}

export interface AccountEMIEstimate {
  lenderName: string;
  debtType: string;
  outstanding: number;
  interestRate: number;         // annual %
  tenureMonths: number;         // estimated remaining tenure
  estimatedEMI: number;         // calculated monthly EMI (₹)
  source: 'bureau' | 'calculated';  // where EMI came from
}

/**
 * Minimum monthly savings (₹) for consolidation to be presented as beneficial.
 * Below this threshold, the simplification benefit exists but the financial
 * savings are negligible and should not be the selling point.
 */
const MIN_MEANINGFUL_MONTHLY_SAVINGS = 500;

export interface ConsolidationProjection {
  currentTotalEMI: number;          // sum of all current EMIs (₹)
  consolidatedEMI: number;          // single EMI after consolidation (₹)
  monthlySavings: number;           // currentTotalEMI - consolidatedEMI (₹)
  totalPrincipal: number;           // total outstanding being consolidated (₹)
  consolidatedRate: number;         // projected consolidated rate (%)
  consolidatedTenureMonths: number; // projected tenure (months)
  totalInterestBefore: number;      // sum of interest across current loans
  totalInterestAfter: number;       // interest on consolidated loan
  interestSaved: number;            // totalInterestBefore - totalInterestAfter
  accountCount: number;             // number of accounts consolidated
  accountEstimates: AccountEMIEstimate[];  // per-account breakdown
  /** true when monthlySavings >= MIN_MEANINGFUL_MONTHLY_SAVINGS — LLM should only pitch savings when this is true */
  hasMeaningfulSavings: boolean;
}

// ── Default assumptions ─────────────────────────────────────────────────────

/** Default remaining tenure when tenure is unknown — 36 months is typical for personal loans in India */
const DEFAULT_REMAINING_TENURE_MONTHS = 36;

/** Default interest rate when rate is unknown — 15% is a mid-range unsecured loan rate in India */
const DEFAULT_INTEREST_RATE = 15;

/**
 * Consolidated loan rate — typically lower than the weighted average of
 * individual unsecured loans. Conservative estimate.
 */
const DEFAULT_CONSOLIDATED_RATE = 12;

/** Default consolidated tenure — 48 months gives meaningful EMI reduction */
const DEFAULT_CONSOLIDATED_TENURE_MONTHS = 48;

/** Minimum outstanding to include in EMI calculations (filters noise) */
const MIN_OUTSTANDING_FOR_EMI = 500;

// ── Core EMI formula ────────────────────────────────────────────────────────

/**
 * Calculate EMI using the standard reducing-balance formula.
 *
 * EMI = P × r × (1 + r)^n / ((1 + r)^n - 1)
 *
 * @param principal   - Loan amount in ₹
 * @param annualRate  - Annual interest rate in % (e.g. 12 for 12%)
 * @param tenureMonths - Loan tenure in months
 * @returns EMIResult with EMI, total interest, and total payment
 */
export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): EMIResult {
  // Guard: zero or negative inputs
  if (principal <= 0 || tenureMonths <= 0) {
    return { emi: 0, totalInterest: 0, totalPayment: 0, principal, annualRate, tenureMonths };
  }

  // Zero interest = simple division
  if (annualRate <= 0) {
    const emi = Math.round(principal / tenureMonths);
    return { emi, totalInterest: 0, totalPayment: principal, principal, annualRate: 0, tenureMonths };
  }

  const r = annualRate / 12 / 100;  // monthly interest rate
  const n = tenureMonths;

  const power = Math.pow(1 + r, n);
  const emi = Math.round(principal * r * power / (power - 1));
  const totalPayment = emi * n;
  const totalInterest = totalPayment - principal;

  return { emi, totalInterest, totalPayment, principal, annualRate, tenureMonths };
}

// ── Tenure estimation ───────────────────────────────────────────────────────

/**
 * Estimate remaining tenure for a loan when explicit tenure data is missing.
 * Uses sanctioned amount, outstanding, and account age to infer.
 */
function estimateRemainingTenure(account: AdvisorAccountContext): number {
  // Credit cards: revolving credit with no fixed tenure — use default
  // Must check BEFORE sanctioned/outstanding logic since card limit ≠ loan principal
  if (isCardAccount(account)) {
    return DEFAULT_REMAINING_TENURE_MONTHS;
  }

  const sanctioned = account.sanctionedAmount ?? 0;
  const outstanding = account.outstandingAmount ?? 0;
  const ageMo = account.accountAgeMonths ?? 0;

  // Explicit tenure from data
  if (account.repaymentTenure && account.repaymentTenure > 0) {
    const remaining = account.repaymentTenure - (ageMo || 0);
    return Math.max(6, remaining);
  }

  // If we have both sanctioned and outstanding, and the account has age,
  // estimate original tenure from repayment progress, then derive remaining.
  if (sanctioned > 0 && outstanding > 0 && ageMo > 0) {
    const repaidFraction = (sanctioned - outstanding) / sanctioned;
    if (repaidFraction > 0.05 && repaidFraction < 1) {
      // originalTenure ≈ ageMo / repaidFraction, remaining ≈ original - ageMo
      const estimatedOriginal = Math.round(ageMo / repaidFraction);
      const remaining = Math.max(6, estimatedOriginal - ageMo);
      // Cap at reasonable range
      return Math.min(remaining, 120);
    }
  }

  return DEFAULT_REMAINING_TENURE_MONTHS;
}

/**
 * Estimate interest rate when not available from bureau data.
 * Uses debt type heuristics based on typical Indian lending rates.
 */
function estimateInterestRate(account: AdvisorAccountContext): number {
  // Check credit card FIRST — 'credit card' contains 'car' which would falsely match vehicle
  if (isCardAccount(account)) return 36;  // revolving credit — effective rate is high

  const dt = (account.debtType || '').toLowerCase();

  if (dt.includes('home') || dt.includes('housing') || dt.includes('mortgage')) return 9;
  if (dt.includes('vehicle') || dt.includes('auto') || dt.includes('car') || dt.includes('two wheeler')) return 11;
  if (dt.includes('gold')) return 10;
  if (dt.includes('education')) return 10;
  if (dt.includes('personal')) return 16;
  if (dt.includes('consumer') || dt.includes('business')) return 18;

  return DEFAULT_INTEREST_RATE;
}

function isCardAccount(account: AdvisorAccountContext): boolean {
  const dt = (account.debtType || '').toLowerCase();
  return dt.includes('credit card') || (account.creditLimit ?? 0) > 0;
}

// ── Per-account EMI estimation ──────────────────────────────────────────────

/**
 * Estimate EMI for a single account. Uses bureau EMI if available,
 * otherwise calculates from outstanding, rate, and estimated tenure.
 */
export function estimateAccountEMI(account: AdvisorAccountContext): AccountEMIEstimate | null {
  const outstanding = account.outstandingAmount ?? 0;
  if (outstanding < MIN_OUTSTANDING_FOR_EMI) return null;
  if (account.status !== 'ACTIVE') return null;

  // If bureau already has EMI, use it directly
  if ((account.estimatedEMI ?? 0) > 0) {
    return {
      lenderName: account.lenderName,
      debtType: account.debtType,
      outstanding,
      interestRate: account.interestRate ?? estimateInterestRate(account),
      tenureMonths: estimateRemainingTenure(account),
      estimatedEMI: account.estimatedEMI!,
      source: 'bureau',
    };
  }

  // Calculate EMI from available data
  const rate = account.interestRate ?? estimateInterestRate(account);
  const tenure = estimateRemainingTenure(account);
  const result = calculateEMI(outstanding, rate, tenure);

  return {
    lenderName: account.lenderName,
    debtType: account.debtType,
    outstanding,
    interestRate: rate,
    tenureMonths: tenure,
    estimatedEMI: result.emi,
    source: 'calculated',
  };
}

// ── Portfolio-level consolidation projection ────────────────────────────────

/**
 * Project consolidation savings for a set of accounts.
 *
 * @param accounts - All advisor account contexts (active accounts will be filtered)
 * @param consolidatedRate - Projected consolidated interest rate (default 12%)
 * @param consolidatedTenure - Projected consolidated tenure in months (default 48)
 * @returns ConsolidationProjection or null if no accounts qualify
 */
export function projectConsolidation(
  accounts: AdvisorAccountContext[],
  consolidatedRate: number = DEFAULT_CONSOLIDATED_RATE,
  consolidatedTenure: number = DEFAULT_CONSOLIDATED_TENURE_MONTHS,
): ConsolidationProjection | null {
  // Estimate EMI for each qualifying account
  const estimates: AccountEMIEstimate[] = [];
  for (const account of accounts) {
    const est = estimateAccountEMI(account);
    if (est) estimates.push(est);
  }

  if (estimates.length === 0) return null;

  const totalPrincipal = estimates.reduce((sum, e) => sum + e.outstanding, 0);
  const currentTotalEMI = estimates.reduce((sum, e) => sum + e.estimatedEMI, 0);

  // Total interest remaining on current loans (sum of per-loan interest)
  const totalInterestBefore = estimates.reduce((sum, e) => {
    const result = calculateEMI(e.outstanding, e.interestRate, e.tenureMonths);
    return sum + result.totalInterest;
  }, 0);

  // Consolidated single loan
  const consolidated = calculateEMI(totalPrincipal, consolidatedRate, consolidatedTenure);

  const monthlySavings = Math.max(0, currentTotalEMI - consolidated.emi);
  const interestSaved = Math.max(0, totalInterestBefore - consolidated.totalInterest);

  return {
    currentTotalEMI,
    consolidatedEMI: consolidated.emi,
    monthlySavings,
    totalPrincipal,
    consolidatedRate,
    consolidatedTenureMonths: consolidatedTenure,
    totalInterestBefore,
    totalInterestAfter: consolidated.totalInterest,
    interestSaved,
    accountCount: estimates.length,
    accountEstimates: estimates,
    hasMeaningfulSavings: monthlySavings >= MIN_MEANINGFUL_MONTHLY_SAVINGS,
  };
}

// ── Enrichment helper (called from advisorContext) ──────────────────────────

/**
 * Enrich an array of AdvisorAccountContext by filling in missing estimatedEMI
 * fields using the EMI calculator. Mutates accounts in-place.
 *
 * @returns Total estimated monthly EMI across all active accounts
 */
export function enrichAccountsWithEMI(accounts: AdvisorAccountContext[]): number {
  let totalEMI = 0;

  for (const account of accounts) {
    if (account.status !== 'ACTIVE') continue;
    if ((account.outstandingAmount ?? 0) < MIN_OUTSTANDING_FOR_EMI) continue;

    if ((account.estimatedEMI ?? 0) <= 0) {
      // Calculate and fill in the missing EMI
      const rate = account.interestRate ?? estimateInterestRate(account);
      const tenure = estimateRemainingTenure(account);
      const result = calculateEMI(account.outstandingAmount!, rate, tenure);
      account.estimatedEMI = result.emi;

      // Also fill in interestRate if it was missing (so LLM can reference it)
      if (account.interestRate === null) {
        account.interestRate = rate;
      }
    }

    totalEMI += account.estimatedEMI ?? 0;
  }

  return totalEMI;
}
