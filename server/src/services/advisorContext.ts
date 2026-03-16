import {
  AdvisorAccountContext,
  AdvisorContext,
  AdvisorInsight,
  CreditorAccount,
  EnrichedCreditReport,
  User,
} from '../types';
import { normalizeDebtTypeLabel } from '../utils/debtTypeNormalization';

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

  return signals;
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
      maxDPD: account.dpd.maxDPD ?? account.delinquency ?? null,
      interestRate: account.roi ?? null,
      estimatedEMI: account.estimatedEMI ?? null,
      repaymentTenure: account.repaymentTenure ?? null,
      signals: [],
    };

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
      maxDPD: account.delinquency ?? null,
      interestRate: null,
      estimatedEMI: null,
      repaymentTenure: account.repaymentTenure ?? null,
      signals: [],
    };

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

function buildRelevantFacts(input: {
  user: User | null;
  creditScore: number | null;
  scoreGapTo750: number | null;
  totalOutstanding: number;
  relevantAccounts: AdvisorAccountContext[];
  topRisks: AdvisorInsight[];
  topOpportunities: AdvisorInsight[];
}): string[] {
  const facts: string[] = [];

  if (input.creditScore !== null) {
    if ((input.scoreGapTo750 ?? 0) > 0) {
      facts.push(`Your credit score is ${input.creditScore}, which is ${input.scoreGapTo750} points below 750.`);
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

  return facts.slice(0, 8);
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
  const totalOutstanding = activeAccounts.reduce((sum, account) => sum + (account.outstandingAmount ?? 0), 0);
  const unsecuredOutstanding = activeAccounts
    .filter(account => !/home loan|vehicle loan|mortgage|secured/i.test(account.debtType))
    .reduce((sum, account) => sum + (account.outstandingAmount ?? 0), 0);
  const securedOutstanding = Math.max(0, totalOutstanding - unsecuredOutstanding);
  const creditCardCount = activeAccounts.filter(account => /credit card/i.test(account.debtType)).length;
  const personalLoanCount = activeAccounts.filter(account => /personal loan/i.test(account.debtType)).length;
  const delinquentAccountCount = activeAccounts.filter(account => (account.maxDPD ?? 0) > 0 || (account.overdueAmount ?? 0) > 0).length;
  const creditScore = report?.creditScore ?? user?.creditScore ?? null;
  const scoreGapTo750 = creditScore === null ? null : Math.max(0, 750 - creditScore);
  const dominantAccounts = sortAccountsForDominance(activeAccounts).slice(0, 5);
  const relevantAccounts = selectRelevantAccounts(activeAccounts, userMessage);
  const topRisks = buildRiskInsights(activeAccounts, user).slice(0, 5);
  const topOpportunities = buildOpportunityInsights(activeAccounts, creditScore).slice(0, 5);
  const overdueHighlights = topRisks.filter(insight => /overdue|delay/i.test(insight.label)).slice(0, 3);
  const cardUtilizationHighlights = topRisks.filter(insight => /utilization/i.test(insight.label)).slice(0, 3);
  const relevantFacts = buildRelevantFacts({
    user,
    creditScore,
    scoreGapTo750,
    totalOutstanding,
    relevantAccounts,
    topRisks,
    topOpportunities,
  });

  return {
    source,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
    financialGoal: user?.financialGoal ?? null,
    creditScore,
    scoreGapTo750,
    monthlyIncome: user?.monthlyIncome ?? null,
    monthlyObligation: user?.monthlyObligation ?? null,
    foirPercentage: user?.foirPercentage ?? null,
    activeAccountCount: activeAccounts.length,
    closedAccountCount: closedAccounts.length,
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
  };
}
