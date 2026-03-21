import {
  AdvisorAccountContext,
  AdvisorContext,
  AdvisorInsight,
  CreditorAccount,
  EnrichedCreditReport,
  User,
} from '../types';
import { normalizeDebtTypeLabel } from '../utils/debtTypeNormalization';
import { enrichAccountsWithEMI, projectConsolidation, ConsolidationProjection } from './emiCalculator';
import { matchServiceableCreditor, isDebtTypeServiceable } from './serviceableCreditorLookup';

function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '₹0';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function uniquePush(target: string[], value: string): void {
  const cleaned = value.trim();
  if (!cleaned) return;
  if (!target.some(item => item.toLowerCase() === cleaned.toLowerCase())) {
    target.push(cleaned);
  }
}

function percentUsed(outstanding: number | null | undefined, limit: number | null | undefined): number | null {
  if ((outstanding ?? 0) < 0 || (limit ?? 0) <= 0) return null;
  return Math.round(((outstanding ?? 0) / (limit ?? 1)) * 100);
}

function enrichWithServiceability(account: AdvisorAccountContext): void {
  const creditor = matchServiceableCreditor(account.lenderName);
  if (creditor) {
    account.isServicedByFreed = creditor.isServicedByFreed && !creditor.isDebarred;
    account.serviceableForThisDebtType = account.isServicedByFreed
      ? isDebtTypeServiceable(creditor, account.debtType)
      : false;
    account.creditorCategory = creditor.category || null;
    account.pressureScore = creditor.pressureScore;
    account.isDebarred = creditor.isDebarred;
  } else {
    account.isServicedByFreed = false;
    account.serviceableForThisDebtType = false;
    account.creditorCategory = null;
    account.pressureScore = null;
    account.isDebarred = false;
  }
}

function buildSignals(account: AdvisorAccountContext): string[] {
  const signals: string[] = [];

  if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) >= 100) {
    signals.push('card_over_limit');
  } else if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) >= 80) {
    signals.push('high_card_utilization');
  } else if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) >= 30) {
    signals.push('moderate_card_utilization');
  }

  if ((account.overdueAmount ?? 0) > 0) {
    signals.push('current_overdue');
  }

  if ((account.maxDPD ?? 0) >= 90) {
    signals.push('severe_dpd_history');
  } else if ((account.maxDPD ?? 0) > 0) {
    signals.push('dpd_history');
  }

  if ((account.outstandingAmount ?? 0) >= 100000) {
    signals.push('large_balance');
  }

  if ((account.estimatedEMI ?? 0) > 0) {
    signals.push('known_emi');
  }

  if (account.isServicedByFreed) {
    signals.push('freed_serviceable');
  } else if ((account.overdueAmount ?? 0) > 0 || (account.maxDPD ?? 0) > 0) {
    signals.push('freed_not_serviceable');
  }

  if ((account.pressureScore ?? 0) >= 7) {
    signals.push('high_collection_pressure');
  }

  return signals;
}

function computeAccountAge(openDate: string | null | undefined): number | null {
  if (!openDate) return null;
  const opened = new Date(openDate);
  if (isNaN(opened.getTime())) return null;
  const now = new Date();
  const months = (now.getFullYear() - opened.getFullYear()) * 12 + (now.getMonth() - opened.getMonth());
  return Math.max(0, months);
}

function computeRepaymentPercentage(sanctioned: number | null | undefined, outstanding: number | null | undefined): number | null {
  if (!sanctioned || sanctioned <= 0) return null;
  const out = outstanding ?? 0;
  if (out > sanctioned) return 0; // hasn't started paying down yet or accrued interest
  return Math.round(((sanctioned - out) / sanctioned) * 100);
}

function computeOnTimeRate(dpd: { totalMonths: number; monthsWithDPD: number }): number | null {
  if (!dpd || dpd.totalMonths === 0) return null;
  return Math.round(((dpd.totalMonths - dpd.monthsWithDPD) / dpd.totalMonths) * 100);
}

function computePaymentTrend(dpd: { improving: boolean; recentTrend: number[]; monthsWithDPD: number }): 'improving' | 'stable' | 'worsening' | null {
  if (!dpd || dpd.recentTrend.length === 0) return null;
  if (dpd.monthsWithDPD === 0) return 'stable'; // no delays at all
  if (dpd.improving) return 'improving';
  // Check if recent trend is worsening (newer months have higher DPD)
  const recent = dpd.recentTrend.slice(0, 3);
  if (recent.length >= 2 && recent[0] > recent[recent.length - 1]) return 'worsening';
  return 'stable';
}

function accountFromReport(report: EnrichedCreditReport): AdvisorAccountContext[] {
  return report.accounts.map(account => {
    const debtType = normalizeDebtTypeLabel({
      debtType: account.debtType,
      creditLimit: account.creditLimit,
      lenderName: account.lenderName,
    });

    const normalized: AdvisorAccountContext = {
      lenderName: account.lenderName,
      debtType,
      status: account.status,
      outstandingAmount: account.outstandingAmount ?? null,
      overdueAmount: account.overdueAmount ?? null,
      creditLimit: account.creditLimit ?? null,
      utilizationPercentage: percentUsed(account.outstandingAmount, account.creditLimit),
      maxDPD: Math.max(account.dpd.maxDPD ?? 0, account.delinquency ?? 0) || null,
      interestRate: account.roi ?? null,
      estimatedEMI: account.estimatedEMI ?? null,
      repaymentTenure: account.repaymentTenure ?? null,
      signals: [],
      sanctionedAmount: account.sanctionedAmount ?? null,
      repaymentPercentage: computeRepaymentPercentage(account.sanctionedAmount, account.outstandingAmount),
      accountAgeMonths: computeAccountAge(account.openDate),
      onTimePaymentRate: computeOnTimeRate(account.dpd),
      paymentTrend: computePaymentTrend(account.dpd),
      recentDPDTrend: account.dpd.recentTrend.length > 0 ? account.dpd.recentTrend.slice(0, 6) : null,
      // Serviceability defaults (enriched below)
      isServicedByFreed: false,
      serviceableForThisDebtType: false,
      creditorCategory: null,
      pressureScore: null,
      isDebarred: false,
    };

    enrichWithServiceability(normalized);
    normalized.signals = buildSignals(normalized);
    return normalized;
  });
}

function accountFromCreditor(accounts: CreditorAccount[]): AdvisorAccountContext[] {
  return accounts.map(account => {
    const debtType = normalizeDebtTypeLabel({
      debtType: account.debtType,
      creditLimit: account.creditLimitAmount,
      lenderName: account.lenderName,
    });

    const normalized: AdvisorAccountContext = {
      lenderName: account.lenderName,
      debtType,
      status: account.accountStatus || 'UNKNOWN',
      outstandingAmount: account.outstandingAmount ?? null,
      overdueAmount: account.overdueAmount ?? null,
      creditLimit: account.creditLimitAmount ?? null,
      utilizationPercentage: percentUsed(account.outstandingAmount, account.creditLimitAmount),
      maxDPD: Math.max(0, account.delinquency ?? 0) || null,
      interestRate: account.roi ?? null,
      estimatedEMI: null,
      repaymentTenure: account.repaymentTenure ?? null,
      signals: [],
      sanctionedAmount: account.sanctionedAmount ?? null,
      repaymentPercentage: computeRepaymentPercentage(account.sanctionedAmount, account.outstandingAmount),
      accountAgeMonths: computeAccountAge(account.openDate),
      onTimePaymentRate: null,
      paymentTrend: null,
      recentDPDTrend: null,
      // Serviceability defaults (enriched below)
      isServicedByFreed: false,
      serviceableForThisDebtType: false,
      creditorCategory: null,
      pressureScore: null,
      isDebarred: false,
    };

    enrichWithServiceability(normalized);
    normalized.signals = buildSignals(normalized);
    return normalized;
  });
}

function insightKey(insight: AdvisorInsight): string {
  return `${insight.label.toLowerCase()}|${(insight.lenderName || '').toLowerCase()}|${(insight.detail || '').toLowerCase()}`;
}

function dedupeInsights(insights: AdvisorInsight[]): AdvisorInsight[] {
  const seen = new Set<string>();
  const output: AdvisorInsight[] = [];

  for (const insight of insights) {
    const key = insightKey(insight);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(insight);
  }

  return output;
}

function buildRiskInsights(accounts: AdvisorAccountContext[], user: User | null): AdvisorInsight[] {
  const insights: AdvisorInsight[] = [];

  for (const account of accounts) {
    if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) >= 80) {
      insights.push({
        label: 'High credit card utilization',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} is at ${account.utilizationPercentage}% of its ${formatINR(account.creditLimit)} limit with ${formatINR(account.outstandingAmount)} outstanding.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        amount: account.outstandingAmount,
        percentage: account.utilizationPercentage,
      });
    }

    if ((account.overdueAmount ?? 0) > 0) {
      insights.push({
        label: 'Current overdue amount',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} still shows ${formatINR(account.overdueAmount)} overdue.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        amount: account.overdueAmount,
      });
    }

    if ((account.maxDPD ?? 0) > 0) {
      insights.push({
        label: 'Delayed payment history',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} has a recorded peak delay of ${account.maxDPD} days.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        dpd: account.maxDPD,
      });
    }
  }

  const sortedByOutstanding = [...accounts]
    .filter(account => (account.outstandingAmount ?? 0) > 0)
    .sort((a, b) => (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0));

  if (sortedByOutstanding[0]) {
    const account = sortedByOutstanding[0];
    insights.push({
      label: 'Largest active balance',
      detail: `${account.lenderName} ${account.debtType.toLowerCase()} is the largest active balance at ${formatINR(account.outstandingAmount)}.`,
      lenderName: account.lenderName,
      debtType: account.debtType,
      amount: account.outstandingAmount,
    });
  }

  if ((user?.foirPercentage ?? 0) >= 35) {
    insights.push({
      label: 'High monthly repayment pressure',
      detail: `${user?.foirPercentage}% of monthly income is already committed to obligations.`,
      percentage: user?.foirPercentage ?? null,
    });
  }

  // Worsening payment trend
  for (const account of accounts) {
    if (account.paymentTrend === 'worsening') {
      insights.push({
        label: 'Worsening payment trend',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} shows a worsening payment pattern -recent delays are increasing.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
      });
    }
  }

  // High interest rate accounts
  const highInterest = accounts
    .filter(a => (a.interestRate ?? 0) > 18 && (a.outstandingAmount ?? 0) > 0)
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));
  for (const account of highInterest.slice(0, 3)) {
    insights.push({
      label: 'High interest rate',
      detail: `${account.lenderName} ${account.debtType.toLowerCase()} carries a ${account.interestRate}% interest rate on ${formatINR(account.outstandingAmount)} outstanding -this is one of your most expensive debts.`,
      lenderName: account.lenderName,
      debtType: account.debtType,
      amount: account.outstandingAmount,
      percentage: account.interestRate,
    });
  }

  // New account opened recently (could indicate credit-seeking behavior)
  for (const account of accounts) {
    if (account.accountAgeMonths !== null && account.accountAgeMonths <= 3 && (account.outstandingAmount ?? 0) > 50000) {
      insights.push({
        label: 'Recent new account',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} was opened ${account.accountAgeMonths === 0 ? 'this month' : `${account.accountAgeMonths} month${account.accountAgeMonths > 1 ? 's' : ''} ago`} with ${formatINR(account.outstandingAmount)} outstanding.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        amount: account.outstandingAmount,
      });
    }
  }

  return dedupeInsights(insights);
}

function buildOpportunityInsights(accounts: AdvisorAccountContext[], score: number | null): AdvisorInsight[] {
  const insights: AdvisorInsight[] = [];

  for (const account of accounts) {
    if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) >= 30) {
      insights.push({
        label: 'Utilization reduction opportunity',
        detail: `Bringing ${account.lenderName} ${account.debtType.toLowerCase()} below 30% utilization would reduce pressure from one of your highest-used revolving accounts.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        percentage: account.utilizationPercentage,
      });
    }

    if ((account.overdueAmount ?? 0) > 0) {
      insights.push({
        label: 'Overdue clearance opportunity',
        detail: `Clearing the overdue on ${account.lenderName} would remove an active payment issue from your file.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        amount: account.overdueAmount,
      });
    }

    if ((account.maxDPD ?? 0) > 0) {
      insights.push({
        label: 'Fresh on-time history matters',
        detail: `Keeping ${account.lenderName} current every month helps older delays lose weight over time.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        dpd: account.maxDPD,
      });
    }
  }

  if (score !== null && score < 750) {
    insights.push({
      label: 'Score headroom remains',
      detail: `Your current score is ${score}, so even one or two well-targeted improvements can still create visible movement.`,
    });
  }

  // Repayment progress -positive reinforcement
  for (const account of accounts) {
    if ((account.repaymentPercentage ?? 0) >= 50 && (account.sanctionedAmount ?? 0) > 0) {
      insights.push({
        label: 'Strong repayment progress',
        detail: `You've already repaid ${account.repaymentPercentage}% of your ${account.lenderName} ${account.debtType.toLowerCase()} (${formatINR(account.outstandingAmount)} of ${formatINR(account.sanctionedAmount)} remaining).`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        percentage: account.repaymentPercentage,
      });
    }
  }

  // Improving payment trends
  for (const account of accounts) {
    if (account.paymentTrend === 'improving' && (account.maxDPD ?? 0) > 0) {
      insights.push({
        label: 'Improving payment behavior',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} had delays but is now showing an improving trend -keep it up.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
      });
    }
  }

  // Interest rate optimization -refinancing opportunity
  const refinanceCandidates = accounts
    .filter(a => (a.interestRate ?? 0) > 15 && (a.outstandingAmount ?? 0) > 20000)
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));
  if (refinanceCandidates.length > 0) {
    const top = refinanceCandidates[0];
    insights.push({
      label: 'Interest rate optimization',
      detail: `${top.lenderName} ${top.debtType.toLowerCase()} at ${top.interestRate}% with ${formatINR(top.outstandingAmount)} outstanding could benefit from refinancing or accelerated repayment to save on interest.`,
      lenderName: top.lenderName,
      debtType: top.debtType,
      amount: top.outstandingAmount,
      percentage: top.interestRate,
    });
  }

  // Low utilization cards -good for credit mix
  for (const account of accounts) {
    if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) < 10 && (account.utilizationPercentage ?? 0) >= 0) {
      insights.push({
        label: 'Low utilization card',
        detail: `${account.lenderName} ${account.debtType.toLowerCase()} is at just ${account.utilizationPercentage}% utilization -great for your score.`,
        lenderName: account.lenderName,
        debtType: account.debtType,
        percentage: account.utilizationPercentage,
      });
    }
  }

  return dedupeInsights(insights);
}

function relevanceScore(account: AdvisorAccountContext, message: string): number {
  const tokens = new Set(tokenize(message));
  if (tokens.size === 0) return 0;

  let score = 0;
  const lenderTokens = tokenize(account.lenderName);
  const debtTokens = tokenize(account.debtType);

  for (const token of lenderTokens) {
    if (token.length > 2 && tokens.has(token)) score += 5;
  }

  for (const token of debtTokens) {
    if (token.length > 2 && tokens.has(token)) score += 3;
  }

  if ((tokens.has('card') || tokens.has('credit') || tokens.has('utilization') || tokens.has('limit')) && (account.creditLimit ?? 0) > 0) {
    score += 4;
  }

  if ((tokens.has('emi') || tokens.has('burden') || tokens.has('payment') || tokens.has('payments')) && (account.outstandingAmount ?? 0) > 0) {
    score += 2;
  }

  if ((tokens.has('late') || tokens.has('delay') || tokens.has('overdue') || tokens.has('dpd') || tokens.has('missed')) && ((account.maxDPD ?? 0) > 0 || (account.overdueAmount ?? 0) > 0)) {
    score += 4;
  }

  if ((tokens.has('score') || tokens.has('approval') || tokens.has('eligible') || tokens.has('interest')) && ((account.maxDPD ?? 0) > 0 || (account.utilizationPercentage ?? 0) >= 80)) {
    score += 3;
  }

  if ((tokens.has('consolidate') || tokens.has('single') || tokens.has('simplify') || tokens.has('combine')) && (account.outstandingAmount ?? 0) > 0) {
    score += 2;
  }

  return score;
}

function sortAccountsForDominance(accounts: AdvisorAccountContext[]): AdvisorAccountContext[] {
  return [...accounts].sort((a, b) => {
    const signalGap = b.signals.length - a.signals.length;
    if (signalGap !== 0) return signalGap;
    return (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0);
  });
}

function selectRelevantAccounts(accounts: AdvisorAccountContext[], message: string): AdvisorAccountContext[] {
  const withScores = accounts.map(account => ({ account, score: relevanceScore(account, message) }));
  const matched = withScores.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  if (matched.length > 0) {
    return matched.slice(0, 4).map(entry => entry.account);
  }

  return sortAccountsForDominance(accounts).slice(0, 4);
}

/**
 * Build risk insights from CreditPull aggregates when no account-level data exists.
 * This ensures the LLM receives non-empty risk signals even without Creditor.csv or credit report data.
 */
function buildCreditPullRiskInsights(user: User): AdvisorInsight[] {
  const cp = user.creditPull;
  if (!cp) return [];
  const insights: AdvisorInsight[] = [];

  if ((cp.accountsDelinquentCount ?? 0) > 0) {
    insights.push({
      label: 'Accounts with missed payments',
      detail: `${cp.accountsDelinquentCount} of your ${cp.accountsActiveCount} active accounts show missed payments on your credit report.`,
    });
  }

  if ((cp.accountsTotalOutstanding ?? 0) > 0) {
    insights.push({
      label: 'Total outstanding balance',
      detail: `Your total outstanding balance across all active accounts is ${formatINR(cp.accountsTotalOutstanding)}.`,
      amount: cp.accountsTotalOutstanding,
    });
  }

  if ((user.foirPercentage ?? 0) >= 35) {
    insights.push({
      label: 'High monthly repayment pressure',
      detail: `${user.foirPercentage}% of your monthly income is already committed to loan obligations.`,
      percentage: user.foirPercentage ?? null,
    });
  }

  if ((cp.unsecuredAccountsTotalOutstanding ?? 0) > 0 && (cp.securedAccountsTotalOutstanding ?? 0) === 0) {
    insights.push({
      label: 'Entirely unsecured debt',
      detail: `Your entire outstanding of ${formatINR(cp.unsecuredAccountsTotalOutstanding)} is unsecured debt, which typically carries higher interest rates.`,
      amount: cp.unsecuredAccountsTotalOutstanding,
    });
  }

  return insights;
}

/**
 * Build opportunity insights from CreditPull aggregates when no account-level data exists.
 */
function buildCreditPullOpportunityInsights(user: User): AdvisorInsight[] {
  const cp = user.creditPull;
  if (!cp) return [];
  const insights: AdvisorInsight[] = [];
  const score = cp.creditScore ?? user.creditScore ?? null;

  if (score !== null && score < 750) {
    insights.push({
      label: 'Score headroom remains',
      detail: `Your current score is ${score}, which is ${750 - score} points from 750. Even one or two well-targeted improvements can create visible movement.`,
    });
  } else if (score !== null && score >= 750) {
    insights.push({
      label: 'Strong credit score',
      detail: `Your score of ${score} is already above 750. Focus on maintaining and optimizing your financial profile.`,
    });
  }

  if ((cp.accountsDelinquentCount ?? 0) > 0) {
    insights.push({
      label: 'Overdue clearance opportunity',
      detail: `Clearing overdue amounts on your ${cp.accountsDelinquentCount} delinquent account${(cp.accountsDelinquentCount ?? 0) > 1 ? 's' : ''} would directly improve your credit score.`,
    });
  }

  if ((cp.unsecuredDRPServicableAccountsTotalOutstanding ?? 0) > 0 && user.segment === 'DEP') {
    insights.push({
      label: 'Debt optimization potential',
      detail: `You have ${formatINR(cp.unsecuredDRPServicableAccountsTotalOutstanding)} in unsecured debt that could potentially be optimized through interest reduction or faster repayment strategies.`,
      amount: cp.unsecuredDRPServicableAccountsTotalOutstanding,
    });
  }

  return insights;
}

function buildRelevantFacts(input: {
  user: User | null;
  creditScore: number | null;
  scoreGapTo750: number | null;
  nextScoreTarget: number | null;
  scoreGapToTarget: number | null;
  totalOutstanding: number;
  relevantAccounts: AdvisorAccountContext[];
  topRisks: AdvisorInsight[];
  topOpportunities: AdvisorInsight[];
  overallOnTimeRate?: number | null;
  overallCardUtilization?: number | null;
  totalCreditLimit?: number | null;
  enquiryCount?: number | null;
  oldestAccountAgeMonths?: number | null;
  repaymentHighlights?: AdvisorInsight[];
}): string[] {
  const facts: string[] = [];

  if (input.creditScore !== null) {
    if (input.nextScoreTarget !== null && (input.scoreGapToTarget ?? 0) > 0) {
      facts.push(`Your credit score is ${input.creditScore}, which is ${input.scoreGapToTarget} points below your next target of ${input.nextScoreTarget}.`);
    } else {
      facts.push(`Your credit score is ${input.creditScore}.`);
    }
  }

  if (input.totalOutstanding > 0) {
    facts.push(`Your active outstanding balance is ${formatINR(input.totalOutstanding)}.`);
  }

  if ((input.user?.foirPercentage ?? 0) > 0) {
    facts.push(`${input.user?.foirPercentage}% of your monthly income is currently going toward obligations.`);
  }

  // CreditPull summary facts (available for ALL users, even without account-level data)
  const cp = input.user?.creditPull;
  if (cp && input.relevantAccounts.length === 0) {
    // No account-level data -use CreditPull aggregates as the primary data source
    if ((cp.accountsActiveCount ?? 0) > 0) {
      facts.push(`You have ${cp.accountsActiveCount} active loan/credit account${(cp.accountsActiveCount ?? 0) > 1 ? 's' : ''} on your credit report.`);
    }
    if ((cp.accountsDelinquentCount ?? 0) > 0) {
      facts.push(`${cp.accountsDelinquentCount} of your active accounts show missed payments.`);
    }
    if ((cp.accountsClosedCount ?? 0) > 0) {
      facts.push(`You have ${cp.accountsClosedCount} closed account${(cp.accountsClosedCount ?? 0) > 1 ? 's' : ''} in your credit history.`);
    }
    if ((cp.unsecuredAccountsTotalOutstanding ?? 0) > 0) {
      facts.push(`Your total unsecured outstanding is ${formatINR(cp.unsecuredAccountsTotalOutstanding)}.`);
    }
    if ((cp.securedAccountsTotalOutstanding ?? 0) > 0) {
      facts.push(`Your total secured outstanding is ${formatINR(cp.securedAccountsTotalOutstanding)}.`);
    }
    if ((cp.unsecuredAccountsActiveCount ?? 0) > 0) {
      facts.push(`You have ${cp.unsecuredAccountsActiveCount} active unsecured account${(cp.unsecuredAccountsActiveCount ?? 0) > 1 ? 's' : ''}.`);
    }
  }

  // Enriched facts from credit report
  if (input.overallOnTimeRate !== null && input.overallOnTimeRate !== undefined) {
    facts.push(`Your overall on-time payment rate is ${input.overallOnTimeRate}% across all accounts.`);
  }

  if (input.overallCardUtilization !== null && input.overallCardUtilization !== undefined && input.totalCreditLimit) {
    facts.push(`Your overall credit card utilization is ${input.overallCardUtilization}% across ${formatINR(input.totalCreditLimit)} total limit.`);
  }

  if (input.oldestAccountAgeMonths !== null && input.oldestAccountAgeMonths !== undefined) {
    const years = Math.floor(input.oldestAccountAgeMonths / 12);
    const months = input.oldestAccountAgeMonths % 12;
    const ageStr = years > 0 ? `${years} year${years > 1 ? 's' : ''}${months > 0 ? ` ${months} month${months > 1 ? 's' : ''}` : ''}` : `${months} month${months > 1 ? 's' : ''}`;
    facts.push(`Your oldest active account is ${ageStr} old.`);
  }

  if (input.enquiryCount !== null && input.enquiryCount !== undefined && input.enquiryCount > 0) {
    facts.push(`You have ${input.enquiryCount} recent credit enquir${input.enquiryCount === 1 ? 'y' : 'ies'} on your report.`);
  }

  // Interest rate facts
  const accountsWithROI = input.relevantAccounts.filter(a => (a.interestRate ?? 0) > 0 && (a.outstandingAmount ?? 0) > 0);
  if (accountsWithROI.length > 0) {
    const sorted = [...accountsWithROI].sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0));
    const highest = sorted[0];
    facts.push(`Your highest interest rate is ${highest.interestRate}% on ${highest.lenderName} ${highest.debtType.toLowerCase()} (${formatINR(highest.outstandingAmount)} outstanding).`);
    if (sorted.length > 1) {
      const lowest = sorted[sorted.length - 1];
      if (lowest.interestRate !== highest.interestRate) {
        facts.push(`Your lowest interest rate is ${lowest.interestRate}% on ${lowest.lenderName} ${lowest.debtType.toLowerCase()}.`);
      }
    }
  }

  // Serviceability facts (from serviceable_creditors.csv)
  const serviceableRelevant = input.relevantAccounts.filter(a => a.isServicedByFreed && a.serviceableForThisDebtType);
  const nonServiceableRelevant = input.relevantAccounts.filter(a => !a.isServicedByFreed || !a.serviceableForThisDebtType);
  if (serviceableRelevant.length > 0) {
    const names = serviceableRelevant.map(a => a.lenderName).join(', ');
    uniquePush(facts, `FREED can help settle/negotiate with: ${names}.`);
  }
  if (nonServiceableRelevant.length > 0 && serviceableRelevant.length > 0) {
    const names = nonServiceableRelevant.map(a => a.lenderName).join(', ');
    uniquePush(facts, `FREED cannot currently settle with: ${names}.`);
  }
  const highPressure = input.relevantAccounts.filter(a => (a.pressureScore ?? 0) >= 7 && (a.overdueAmount ?? 0) > 0);
  if (highPressure.length > 0) {
    const names = highPressure.map(a => a.lenderName).join(', ');
    uniquePush(facts, `${names} ${highPressure.length === 1 ? 'is' : 'are'} known for aggressive collection practices.`);
  }

  // Repayment progress (motivational for DEP users)
  if (input.repaymentHighlights && input.repaymentHighlights.length > 0) {
    uniquePush(facts, input.repaymentHighlights[0].detail);
  }

  for (const risk of input.topRisks.slice(0, 3)) {
    uniquePush(facts, risk.detail);
  }

  for (const account of input.relevantAccounts.slice(0, 3)) {
    if ((account.creditLimit ?? 0) > 0 && (account.utilizationPercentage ?? 0) > 0) {
      uniquePush(
        facts,
        `${account.lenderName} ${account.debtType.toLowerCase()} is using ${account.utilizationPercentage}% of its ${formatINR(account.creditLimit)} limit.`
      );
      continue;
    }

    if ((account.maxDPD ?? 0) > 0) {
      uniquePush(
        facts,
        `${account.lenderName} ${account.debtType.toLowerCase()} has a maximum recorded delay of ${account.maxDPD} days.`
      );
      continue;
    }

    if ((account.outstandingAmount ?? 0) > 0) {
      uniquePush(
        facts,
        `${account.lenderName} ${account.debtType.toLowerCase()} has ${formatINR(account.outstandingAmount)} outstanding.`
      );
    }
  }

  for (const opportunity of input.topOpportunities.slice(0, 2)) {
    uniquePush(facts, opportunity.detail);
  }

  return facts.slice(0, 12);
}

/**
 * Cross-check computed totals against individual account data.
 * When discrepancies are found, recompute from account-level source of truth.
 * Also verifies CreditPull aggregates against account data when both exist.
 */
function verifyDataConsistency(
  ctx: AdvisorContext,
  activeAccounts: AdvisorAccountContext[],
  user: User | null,
): void {
  if (activeAccounts.length === 0) return;

  // ── Verify totalOutstanding matches sum of active accounts ──
  const computedTotal = activeAccounts.reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0);
  if (ctx.totalOutstanding !== computedTotal) {
    console.warn(`[DataVerify] totalOutstanding mismatch: ctx=${ctx.totalOutstanding}, computed=${computedTotal}. Fixing.`);
    ctx.totalOutstanding = computedTotal;
  }

  // ── Verify unsecured + secured = total ──
  const computedUnsecured = activeAccounts
    .filter(a => !/home loan|vehicle loan|mortgage|secured/i.test(a.debtType))
    .reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0);
  const computedSecured = computedTotal - computedUnsecured;
  if (ctx.unsecuredOutstanding !== computedUnsecured) {
    ctx.unsecuredOutstanding = computedUnsecured;
    ctx.securedOutstanding = computedSecured;
  }

  // ── Verify account counts ──
  const computedActive = activeAccounts.length;
  if (ctx.activeAccountCount !== computedActive) {
    console.warn(`[DataVerify] activeAccountCount mismatch: ctx=${ctx.activeAccountCount}, computed=${computedActive}. Fixing.`);
    ctx.activeAccountCount = computedActive;
  }

  const computedDelinquent = activeAccounts.filter(a => (a.maxDPD ?? 0) > 0 || (a.overdueAmount ?? 0) > 0).length;
  if (ctx.delinquentAccountCount !== computedDelinquent) {
    console.warn(`[DataVerify] delinquentAccountCount mismatch: ctx=${ctx.delinquentAccountCount}, computed=${computedDelinquent}. Fixing.`);
    ctx.delinquentAccountCount = computedDelinquent;
  }

  // ── Verify serviceability totals ──
  const computedServiceable = activeAccounts
    .filter(a => a.isServicedByFreed && a.serviceableForThisDebtType)
    .reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0);
  if (ctx.serviceableTotalOutstanding !== computedServiceable) {
    ctx.serviceableTotalOutstanding = computedServiceable;
  }

  // ── Cross-check with CreditPull if available ──
  const cp = user?.creditPull;
  if (cp && computedActive > 0) {
    // Log significant discrepancies between CreditPull and account data
    if (cp.accountsTotalOutstanding !== null && cp.accountsTotalOutstanding !== undefined) {
      const diff = Math.abs(computedTotal - cp.accountsTotalOutstanding);
      const threshold = Math.max(computedTotal, cp.accountsTotalOutstanding) * 0.15;
      if (diff > threshold && diff > 5000) {
        console.warn(
          `[DataVerify] CreditPull vs account total: CreditPull=${cp.accountsTotalOutstanding}, accounts=${computedTotal} (diff=${diff}). Using account-level data as source of truth.`
        );
      }
    }
  }
}

export function buildAdvisorContext(input: {
  user: User | null;
  report: EnrichedCreditReport | null;
  creditorAccounts: CreditorAccount[];
  userMessage: string;
}): AdvisorContext {
  const { user, report, creditorAccounts, userMessage } = input;
  const source = report ? 'report' : (creditorAccounts.length > 0 ? 'creditor' : 'general');
  const accounts = report ? accountFromReport(report) : accountFromCreditor(creditorAccounts);

  const activeAccounts = accounts.filter(account => account.status.toUpperCase() === 'ACTIVE' || account.status.trim() === '');
  const closedAccounts = accounts.filter(account => !activeAccounts.includes(account));

  // ── CreditPull fallback: when we have no account-level data, derive from User object ──
  const cp = user?.creditPull;
  const hasAccountData = activeAccounts.length > 0;
  const hasCreditPullData = !!(cp && ((cp.accountsActiveCount ?? 0) > 0 || (cp.accountsTotalOutstanding ?? 0) > 0));
  const dataCompleteness = hasAccountData ? 'full' : (hasCreditPullData || (user?.monthlyObligation ?? 0) > 0 ? 'summary' : 'none');

  // Use account-level totals when available, otherwise fall back to CreditPull/User aggregates
  const totalOutstanding = hasAccountData
    ? activeAccounts.reduce((sum, account) => sum + (account.outstandingAmount ?? 0), 0)
    : (cp?.accountsTotalOutstanding ?? 0);
  const unsecuredOutstanding = hasAccountData
    ? activeAccounts
        .filter(account => !/home loan|vehicle loan|mortgage|secured/i.test(account.debtType))
        .reduce((sum, account) => sum + (account.outstandingAmount ?? 0), 0)
    : (cp?.unsecuredAccountsTotalOutstanding ?? 0);
  const securedOutstanding = Math.max(0, totalOutstanding - unsecuredOutstanding);

  const creditCardCount = hasAccountData
    ? activeAccounts.filter(account => /credit card/i.test(account.debtType)).length
    : 0;
  const personalLoanCount = hasAccountData
    ? activeAccounts.filter(account => /personal loan/i.test(account.debtType)).length
    : 0;

  // Active/closed/delinquent counts: prefer account data, fall back to CreditPull
  const activeAccountCount = hasAccountData
    ? activeAccounts.length
    : (cp?.accountsActiveCount ?? 0);
  const closedAccountCount = hasAccountData
    ? closedAccounts.length
    : (cp?.accountsClosedCount ?? 0);
  const delinquentAccountCount = hasAccountData
    ? activeAccounts.filter(account => (account.maxDPD ?? 0) > 0 || (account.overdueAmount ?? 0) > 0).length
    : (cp?.accountsDelinquentCount ?? 0);

  const creditScore = report?.creditScore ?? user?.creditScore ?? null;
  const scoreGapTo750 = creditScore === null ? null : Math.max(0, 750 - creditScore);

  // Dynamic score target: intermediate milestones based on current score
  let nextScoreTarget: number | null = null;
  let scoreGapToTarget: number | null = null;
  if (creditScore !== null) {
    if (creditScore < 650) nextScoreTarget = 700;
    else if (creditScore < 750) nextScoreTarget = 750;
    else if (creditScore < 800) nextScoreTarget = 800;
    else nextScoreTarget = 850;
    scoreGapToTarget = nextScoreTarget - creditScore;
  }
  // ── EMI enrichment: fill missing estimatedEMI using the EMI calculator ───
  // This must run BEFORE dominantAccounts/insights so all downstream logic sees EMI data.
  const calculatedTotalEMI = hasAccountData ? enrichAccountsWithEMI(activeAccounts) : 0;

  // ── Consolidation projection (for DCP-eligible/ineligible segments) ─────
  let consolidationProjection: ConsolidationProjection | null = null;
  if (hasAccountData && activeAccounts.length >= 2) {
    consolidationProjection = projectConsolidation(activeAccounts);
  }

  const dominantAccounts = sortAccountsForDominance(activeAccounts).slice(0, 5);
  const relevantAccounts = selectRelevantAccounts(activeAccounts, userMessage);

  // When no account-level data exists but CreditPull has data, use CreditPull-derived insights
  const topRisks = hasAccountData
    ? buildRiskInsights(activeAccounts, user).slice(0, 5)
    : (hasCreditPullData && user ? buildCreditPullRiskInsights(user).slice(0, 5) : []);
  const topOpportunities = hasAccountData
    ? buildOpportunityInsights(activeAccounts, creditScore).slice(0, 5)
    : (hasCreditPullData && user ? buildCreditPullOpportunityInsights(user).slice(0, 5) : []);
  const overdueHighlights = topRisks.filter(insight => /overdue|delay|missed/i.test(insight.label)).slice(0, 3);
  const cardUtilizationHighlights = topRisks.filter(insight => /utilization/i.test(insight.label)).slice(0, 3);

  // ── Enriched credit report aggregates ─────────────────────────────────────
  // Aggregate on-time payment rate across all accounts with payment history
  const accountsWithHistory = accounts.filter(a => a.onTimePaymentRate !== null);
  const overallOnTimeRate = accountsWithHistory.length > 0
    ? Math.round(accountsWithHistory.reduce((sum, a) => sum + (a.onTimePaymentRate ?? 0), 0) / accountsWithHistory.length)
    : null;

  // Aggregate card utilization (total used / total limit across all cards)
  const cardAccounts = activeAccounts.filter(a => (a.creditLimit ?? 0) > 0);
  const totalCreditLimit = cardAccounts.length > 0
    ? cardAccounts.reduce((sum, a) => sum + (a.creditLimit ?? 0), 0)
    : null;
  const totalCreditUsed = cardAccounts.length > 0
    ? cardAccounts.reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0)
    : null;
  const overallCardUtilization = totalCreditLimit && totalCreditLimit > 0
    ? Math.round(((totalCreditUsed ?? 0) / totalCreditLimit) * 100)
    : null;

  // Enquiry count
  const enquiryCount = report?.enquiries?.length ?? null;

  // Account ages
  const activeAges = activeAccounts.map(a => a.accountAgeMonths).filter((a): a is number => a !== null);
  const oldestAccountAgeMonths = activeAges.length > 0 ? Math.max(...activeAges) : null;
  const newestAccountAgeMonths = activeAges.length > 0 ? Math.min(...activeAges) : null;

  // Closed account quality
  const closedCleanCount = closedAccounts.filter(a => (a.maxDPD ?? 0) === 0 && (a.overdueAmount ?? 0) === 0).length;
  const closedWithIssuesCount = closedAccounts.length - closedCleanCount;

  // Accounts with improving payment trends
  const accountsImproving = accounts
    .filter(a => a.paymentTrend === 'improving')
    .map(a => a.lenderName);

  // Report date
  const reportDate = report?.reportDate ?? null;

  // Repayment progress highlights (accounts where user has made notable progress)
  const repaymentHighlights: AdvisorInsight[] = activeAccounts
    .filter(a => (a.repaymentPercentage ?? 0) >= 20 && (a.sanctionedAmount ?? 0) > 0)
    .sort((a, b) => (b.repaymentPercentage ?? 0) - (a.repaymentPercentage ?? 0))
    .slice(0, 3)
    .map(a => ({
      label: 'Repayment progress',
      detail: `${a.lenderName} ${a.debtType.toLowerCase()}: ${a.repaymentPercentage}% of ${formatINR(a.sanctionedAmount)} already repaid (${formatINR(a.outstandingAmount)} remaining).`,
      lenderName: a.lenderName,
      debtType: a.debtType,
      amount: a.outstandingAmount,
      percentage: a.repaymentPercentage,
    }));

  // ── Serviceability aggregates ────────────────────────────────────────────
  const serviceableAccounts = activeAccounts.filter(a => a.isServicedByFreed && a.serviceableForThisDebtType);
  const nonServiceableAccounts = activeAccounts.filter(a => !a.isServicedByFreed || !a.serviceableForThisDebtType);
  const serviceableAccountCount = serviceableAccounts.length;
  const nonServiceableAccountCount = nonServiceableAccounts.length;
  const serviceableTotalOutstanding = serviceableAccounts.reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0);
  const nonServiceableTotalOutstanding = nonServiceableAccounts.reduce((sum, a) => sum + (a.outstandingAmount ?? 0), 0);
  const highPressureLenders = activeAccounts
    .filter(a => (a.pressureScore ?? 0) >= 7 && (a.overdueAmount ?? 0) > 0)
    .sort((a, b) => (b.pressureScore ?? 0) - (a.pressureScore ?? 0))
    .map(a => a.lenderName);

  const relevantFacts = buildRelevantFacts({
    user,
    creditScore,
    scoreGapTo750,
    nextScoreTarget,
    scoreGapToTarget,
    totalOutstanding,
    relevantAccounts,
    topRisks,
    topOpportunities,
    overallOnTimeRate,
    overallCardUtilization,
    totalCreditLimit,
    enquiryCount,
    oldestAccountAgeMonths,
    repaymentHighlights,
  });

  const result: AdvisorContext = {
    source,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
    financialGoal: user?.financialGoal ?? null,
    creditScore,
    scoreGapTo750,
    nextScoreTarget,
    scoreGapToTarget,
    monthlyIncome: user?.monthlyIncome ?? null,
    monthlyObligation: user?.monthlyObligation ?? null,
    foirPercentage: user?.foirPercentage ?? null,
    activeAccountCount,
    closedAccountCount,
    delinquentAccountCount,
    totalOutstanding,
    unsecuredOutstanding,
    securedOutstanding,
    creditCardCount,
    personalLoanCount,
    dominantAccounts,
    relevantAccounts,
    topRisks,
    topOpportunities,
    overdueHighlights,
    cardUtilizationHighlights,
    relevantFacts,
    overallOnTimeRate,
    overallCardUtilization,
    totalCreditLimit,
    totalCreditUsed,
    enquiryCount,
    oldestAccountAgeMonths,
    newestAccountAgeMonths,
    closedCleanCount,
    closedWithIssuesCount,
    accountsImproving,
    reportDate,
    repaymentHighlights,
    dataCompleteness,
    calculatedTotalEMI: calculatedTotalEMI > 0 ? calculatedTotalEMI : null,
    consolidationProjection,
    // Serviceability aggregates
    serviceableAccountCount,
    nonServiceableAccountCount,
    serviceableTotalOutstanding,
    nonServiceableTotalOutstanding,
    highPressureLenders,
  };

  // ── Data consistency verification ──────────────────────────────────────
  verifyDataConsistency(result, activeAccounts, user);

  return result;
}
