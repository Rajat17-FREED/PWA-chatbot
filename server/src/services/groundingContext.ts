import { CreditorAccount, CreditPullSummary, EnrichedCreditReport, ResponseGroundingContext, User } from '../types';
import { normalizeDebtTypeLabel } from '../utils/debtTypeNormalization';

function uniquePushCI(target: string[], value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  if (!target.some(v => v.trim().toLowerCase() === normalized)) {
    target.push(value.trim());
  }
}

function addKnownNumber(target: Set<number>, value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) return;
  if (value < 0) return;
  target.add(Math.round(value));
}

interface MutableLenderFacts {
  debtTypes: Set<string>;
  outstandingAmounts: Set<number>;
  overdueAmounts: Set<number>;
  creditLimits: Set<number>;
  maxDPD: number;
}

function getOrCreateFacts(
  map: Map<string, MutableLenderFacts>,
  lender: string
): MutableLenderFacts {
  let facts = map.get(lender);
  if (!facts) {
    facts = {
      debtTypes: new Set<string>(),
      outstandingAmounts: new Set<number>(),
      overdueAmounts: new Set<number>(),
      creditLimits: new Set<number>(),
      maxDPD: 0,
    };
    map.set(lender, facts);
  }
  return facts;
}

export function buildResponseGroundingContext(
  report: EnrichedCreditReport | null,
  creditorAccounts: CreditorAccount[],
  user?: User | null
): ResponseGroundingContext | undefined {
  const allowedLenders: string[] = [];
  const allowedDebtTypes: string[] = [];
  const likelyCardLenders: string[] = [];
  const lenderDebtTypeSets = new Map<string, Set<string>>();
  const lenderFactsMap = new Map<string, MutableLenderFacts>();
  const knownNumbers = new Set<number>();

  const register = (input: {
    lenderName: string;
    debtType: string;
    likelyCard: boolean;
    outstandingAmount?: number | null;
    overdueAmount?: number | null;
    creditLimit?: number | null;
    maxDPD?: number | null;
    extraNumbers?: Array<number | null | undefined>;
  }) => {
    const lender = (input.lenderName || '').trim();
    const type = (input.debtType || '').trim();
    if (!lender) return;

    uniquePushCI(allowedLenders, lender);
    if (type) uniquePushCI(allowedDebtTypes, type);
    if (input.likelyCard) uniquePushCI(likelyCardLenders, lender);

    if (!lenderDebtTypeSets.has(lender)) lenderDebtTypeSets.set(lender, new Set());
    if (type) lenderDebtTypeSets.get(lender)!.add(type);

    const facts = getOrCreateFacts(lenderFactsMap, lender);
    if (type) facts.debtTypes.add(type);

    const outstanding = input.outstandingAmount ?? null;
    const overdue = input.overdueAmount ?? null;
    const limit = input.creditLimit ?? null;
    const maxDPD = input.maxDPD ?? null;

    if ((outstanding ?? 0) > 0) facts.outstandingAmounts.add(Math.round(outstanding!));
    if ((overdue ?? 0) > 0) facts.overdueAmounts.add(Math.round(overdue!));
    if ((limit ?? 0) > 0) facts.creditLimits.add(Math.round(limit!));
    if ((maxDPD ?? 0) > facts.maxDPD) facts.maxDPD = Math.round(maxDPD!);

    addKnownNumber(knownNumbers, outstanding);
    addKnownNumber(knownNumbers, overdue);
    addKnownNumber(knownNumbers, limit);
    addKnownNumber(knownNumbers, maxDPD);
    for (const n of input.extraNumbers || []) addKnownNumber(knownNumbers, n);
  };

  if (report && report.accounts.length > 0) {
    addKnownNumber(knownNumbers, report.creditScore);
    addKnownNumber(knownNumbers, report.summary.totalOutstanding);
    addKnownNumber(knownNumbers, report.summary.unsecuredOutstanding);
    addKnownNumber(knownNumbers, report.summary.securedOutstanding);
    addKnownNumber(knownNumbers, report.summary.activeCount);
    addKnownNumber(knownNumbers, report.summary.closedCount);
    addKnownNumber(knownNumbers, report.summary.delinquentCount);
    addKnownNumber(knownNumbers, report.summary.creditCardCount);
    addKnownNumber(knownNumbers, report.summary.personalLoanCount);
    addKnownNumber(knownNumbers, report.summary.largestDebt?.amount ?? null);
    addKnownNumber(knownNumbers, report.summary.worstDPDAccount?.maxDPD ?? null);

    for (const account of report.accounts) {
      const normalizedDebtType = normalizeDebtTypeLabel({
        debtType: account.debtType,
        creditLimit: account.creditLimit,
        lenderName: account.lenderName,
      });
      const likelyCard = (account.creditLimit ?? 0) > 0 || normalizedDebtType.toLowerCase().includes('card');
      const isClosed = account.status.toUpperCase() === 'CLOSED';
      register({
        lenderName: account.lenderName,
        debtType: normalizedDebtType,
        likelyCard,
        outstandingAmount: account.outstandingAmount,
        // Only register delinquency data for ACTIVE accounts with non-zero outstanding
        overdueAmount: (isClosed || (account.outstandingAmount ?? 0) === 0) ? null : account.overdueAmount,
        creditLimit: account.creditLimit,
        maxDPD: (isClosed || (account.outstandingAmount ?? 0) === 0) ? null : account.dpd.maxDPD,
        extraNumbers: [
          account.sanctionedAmount,
          account.estimatedEMI,
          account.repaymentTenure,
          account.roi,
        ],
      });
    }
  } else {
    for (const account of creditorAccounts) {
      const normalizedDebtType = normalizeDebtTypeLabel({
        debtType: account.debtType,
        creditLimit: account.creditLimitAmount,
        lenderName: account.lenderName,
      });
      const likelyCard = (account.creditLimitAmount ?? 0) > 0 || normalizedDebtType.toLowerCase().includes('card');
      const isClosed = (account.accountStatus || '').toUpperCase() === 'CLOSED';
      register({
        lenderName: account.lenderName,
        debtType: normalizedDebtType,
        likelyCard,
        outstandingAmount: account.outstandingAmount,
        overdueAmount: (isClosed || (account.outstandingAmount ?? 0) === 0) ? null : account.overdueAmount,
        creditLimit: account.creditLimitAmount,
        maxDPD: (isClosed || (account.outstandingAmount ?? 0) === 0) ? null : account.delinquency,
        extraNumbers: [
          account.sanctionedAmount,
          account.repaymentTenure,
          account.tenurePaid,
          account.settlementAmount,
          account.roi,
        ],
      });
    }
  }

  // When no account-level data exists, ground with CreditPull aggregate numbers
  if (allowedLenders.length === 0 && allowedDebtTypes.length === 0) {
    const cp = user?.creditPull;
    if (cp) {
      const cpNumbers = new Set<number>();
      addKnownNumber(cpNumbers, cp.creditScore);
      addKnownNumber(cpNumbers, cp.accountsActiveCount);
      addKnownNumber(cpNumbers, cp.accountsClosedCount);
      addKnownNumber(cpNumbers, cp.accountsDelinquentCount);
      addKnownNumber(cpNumbers, cp.accountsTotalOutstanding);
      addKnownNumber(cpNumbers, cp.unsecuredAccountsTotalOutstanding);
      addKnownNumber(cpNumbers, cp.securedAccountsTotalOutstanding);
      addKnownNumber(cpNumbers, cp.unsecuredAccountsActiveCount);
      addKnownNumber(cpNumbers, cp.unsecuredAccountsDelinquentCount);
      addKnownNumber(cpNumbers, user?.monthlyIncome ?? null);
      addKnownNumber(cpNumbers, user?.monthlyObligation ?? null);
      addKnownNumber(cpNumbers, user?.creditScore ?? null);
      if (cpNumbers.size > 0) {
        return {
          allowedLenders: [],
          allowedDebtTypes: [],
          lenderDebtTypes: {},
          likelyCardLenders: [],
          lenderFacts: {},
          knownNumericFacts: [...cpNumbers].sort((a, b) => a - b),
          creditScore: cp.creditScore ?? user?.creditScore ?? null,
        };
      }
    }
    return undefined;
  }

  const lenderDebtTypes: Record<string, string[]> = {};
  for (const [lender, types] of lenderDebtTypeSets.entries()) {
    lenderDebtTypes[lender] = [...types];
  }

  const lenderFacts: ResponseGroundingContext['lenderFacts'] = {};
  for (const [lender, facts] of lenderFactsMap.entries()) {
    lenderFacts[lender] = {
      debtTypes: [...facts.debtTypes],
      outstandingAmounts: [...facts.outstandingAmounts].sort((a, b) => b - a),
      overdueAmounts: [...facts.overdueAmounts].sort((a, b) => b - a),
      creditLimits: [...facts.creditLimits].sort((a, b) => b - a),
      maxDPD: facts.maxDPD,
    };
  }

  return {
    allowedLenders,
    allowedDebtTypes,
    lenderDebtTypes,
    likelyCardLenders,
    lenderFacts,
    knownNumericFacts: [...knownNumbers].sort((a, b) => a - b),
    creditScore: report?.creditScore ?? null,
  };
}
