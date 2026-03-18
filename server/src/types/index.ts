export type Segment =
  | 'DRP_Eligible'
  | 'DRP_Ineligible'
  | 'DCP_Eligible'
  | 'DCP_Ineligible'
  | 'DEP'
  | 'NTC'
  | 'Others';

export interface CreditPullSummary {
  pulledDate: string;
  creditScore: number | null;
  accountsActiveCount: number | null;
  accountsDelinquentCount: number | null;
  accountsClosedCount: number | null;
  accountsTotalOutstanding: number | null;
  unsecuredAccountsTotalOutstanding: number | null;
  securedAccountsTotalOutstanding: number | null;
  unsecuredDRPServicableAccountsTotalOutstanding: number | null;
  unsecuredAccountsActiveCount: number | null;
  unsecuredAccountsDelinquentCount: number | null;
}

/** Credit score key factor breakdown from credit-insights-key-factors.csv */
export interface CreditInsights {
  creditScore: number | null;
  paymentHistory: {
    onTimeCount: number | null;
    onTimePercentage: number | null;
    lateCount: number | null;
    impact: string;  // "High" | "Medium" | "Low"
    status: string;  // "Excellent" | "Good" | "Average" | "Poor"
  };
  creditUtilization: {
    totalLimit: number | null;
    utilizationPercentage: number | null;
    onTimePercentage: number | null;
    totalUsed: number | null;
    impact: string;
    status: string;
  };
  creditAge: {
    ageLabel: string;       // e.g. "20y 6m"
    ageCount: number | null;
    activeAccounts: number | null;
    impact: string;
    status: string;
  };
  creditMix: {
    mixPercentage: number | null;
    activeAccounts: number | null;
    activeSecuredAccounts: number | null;
    activeUnsecuredAccounts: number | null;
    impact: string;
    status: string;
  };
  inquiries: {
    total: number | null;
    creditCard: number | null;
    loan: number | null;
    impact: string;
    status: string;
  };
}

export interface User {
  leadRefId: string;
  firstName: string;
  lastName: string;
  segment: Segment;
  leadSourceCode: string;
  creditScore: number | null;
  monthlyIncome: number | null;
  monthlyObligation: number | null;
  emiMissed: number | null;
  foirPercentage: number | null;
  financialGoal: string | null;
  creditPull: CreditPullSummary | null;
}

export interface UsersData {
  users: User[];
  nameIndex: Record<string, string[]>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface IdentifyRequest {
  name: string;
}

export interface IdentifyResponse {
  status: 'found' | 'multiple' | 'not_found';
  user?: User;
  candidates?: Array<{ leadRefId: string; firstName: string; lastName: string; segment: Segment }>;
  starters?: ConversationStarter[];
  message: string;
}

export interface ConversationStarter {
  text: string;
  intentTag: string;
  redirectTo: string;
}

export interface ChatRequest {
  message: string;
  leadRefId: string;
  history: ChatMessage[];
  messageCount?: number; // total messages in conversation so far (for early redirect)
  intentTag?: string;   // intent from the clicked starter chip (e.g. INTENT_HARASSMENT)
}

export interface CreditorAccount {
  lenderName: string;
  accountStatus: string;
  accountType: string;
  debtType: string;
  outstandingAmount: number | null;
  overdueAmount: number | null;
  delinquency: number | null;
  creditLimitAmount: number | null;
  sanctionedAmount: number | null;
  openDate: string;
  closedDate: string;
  lastPaymentDate: string;
  reportedDate: string;
  repaymentTenure: number | null;
  tenurePaid: number | null;
  settlementAmount: number | null;
  suitFiledWilfulDefault: string;
  roi: number | null;              // interest rate % (from Creditor.csv)
}

// ── Enriched Credit Report (extracted from full bureau JSON) ────────────────

/** Compact DPD (Days Past Due) summary for a single account */
export interface DPDSummary {
  maxDPD: number;              // worst-ever DPD (e.g. 90 = 3 months late)
  currentDPD: number;          // most recent month's DPD
  monthsWithDPD: number;       // total months where DPD > 0
  totalMonths: number;         // total history length
  recentTrend: number[];       // last 6 months DPD [newest → oldest]
  improving: boolean;          // is DPD trending downward?
  worstPeriod: string | null;  // e.g. "2023-05" — month of worst DPD
}

/** A single account from the enriched credit report — stripped of PII */
export interface EnrichedAccount {
  lenderName: string;
  status: 'ACTIVE' | 'CLOSED' | string;
  accountType: string;         // UNSECURED / SECURED / OTHERS
  debtType: string;            // Personal Loan, Credit Card, Consumer Loan, etc.
  outstandingAmount: number | null;
  overdueAmount: number | null;
  creditLimit: number | null;  // for credit cards — utilization calc
  sanctionedAmount: number | null;
  roi: number | null;          // interest rate %
  repaymentTenure: number | null;
  estimatedEMI: number | null; // sanctioned / tenure (rough estimate)
  openDate: string | null;
  closedDate: string | null;
  lastPaymentDate: string | null;
  delinquency: number | null;
  writtenOffStatus: string | null;
  suitFiled: string | null;
  dpd: DPDSummary;             // compact DPD history (replaces raw accountHistoryList)
}

/** Pre-computed portfolio-level summaries */
export interface PortfolioSummary {
  activeCount: number;
  closedCount: number;
  delinquentCount: number;
  totalOutstanding: number;
  securedOutstanding: number;
  unsecuredOutstanding: number;
  securedActiveCount: number;
  unsecuredActiveCount: number;
  creditCardCount: number;
  personalLoanCount: number;
  highestROI: { lender: string; rate: number } | null;
  lowestROI: { lender: string; rate: number } | null;
  largestDebt: { lender: string; amount: number; type: string } | null;
  worstDPDAccount: { lender: string; maxDPD: number; type: string } | null;
}

/** The complete enriched credit report for one user */
export interface EnrichedCreditReport {
  creditScore: number | null;
  bureau: string;
  reportDate: string;
  summary: PortfolioSummary;
  accounts: EnrichedAccount[];          // ACTIVE accounts first, sorted by outstanding desc
  enquiries: Array<{ reason: string; amount: number | null }>;
}

/** Detailed info for a single account in a tooltip hover group */
export interface TooltipAccountDetail {
  name: string;                    // e.g. "HDFC Bank Ltd"
  debtType?: string;               // e.g. "Personal Loan", "Credit Card"
  outstanding?: number | null;     // outstanding amount
  overdue?: number | null;         // overdue amount (for missed-payment groups)
  maxDPD?: number | null;          // worst days past due (for delinquent accounts)
}

/** A named group of accounts shown on hover over a bold number in the chat */
export interface TooltipGroup {
  label: string;       // e.g. "Accounts with missed payments"
  accounts: string[];  // simple name list (backward compat)
  details?: TooltipAccountDetail[];  // richer data for enhanced tooltip display
  rawCount?: number;   // pre-dedup account count (AI may reference this number)
}

/** Tooltip lookup keyed by account category — sent alongside each chat reply */
export interface MessageTooltips {
  overdue?: TooltipGroup;    // accounts with overdueAmount > 0
  active?: TooltipGroup;     // open (non-closed) accounts
  secured?: TooltipGroup;    // home / vehicle / mortgage loans
  unsecured?: TooltipGroup;  // personal loans, credit cards
}

/** Source-of-truth constraints used to validate/sanitize model output text. */
export interface LenderGroundingFacts {
  debtTypes: string[];
  outstandingAmounts: number[];
  overdueAmounts: number[];
  creditLimits: number[];
  maxDPD: number;
}

export interface ResponseGroundingContext {
  allowedLenders: string[];
  allowedDebtTypes: string[];
  lenderDebtTypes: Record<string, string[]>;
  likelyCardLenders: string[];
  lenderFacts: Record<string, LenderGroundingFacts>;
  knownNumericFacts: number[];
  creditScore: number | null;
}

export type StructuredFormatMode = 'plain' | 'guided' | 'analysis';

export type StructuredSectionStyle = 'paragraph' | 'bullet_list' | 'numbered_list';

export interface ClosingQuestionContract {
  text: string;
  options: string[];
}

export interface StructuredSection {
  title?: string;
  style: StructuredSectionStyle;
  items: string[];
}

export interface StructuredRedirect {
  url: string;
  label: string;
}

export interface StructuredAssistantTurn {
  formatMode: StructuredFormatMode;
  opening: string;
  sections: StructuredSection[];
  closingQuestion?: ClosingQuestionContract;
  followUps: string[];
  redirect?: StructuredRedirect;
  redirectNudge?: string;
}

export interface AdvisorAccountContext {
  lenderName: string;
  debtType: string;
  status: string;
  outstandingAmount: number | null;
  overdueAmount: number | null;
  creditLimit: number | null;
  utilizationPercentage: number | null;
  maxDPD: number | null;
  interestRate: number | null;
  estimatedEMI: number | null;
  repaymentTenure: number | null;
  signals: string[];
  sanctionedAmount: number | null;
  repaymentPercentage: number | null;      // % of sanctioned amount already repaid
  accountAgeMonths: number | null;         // months since openDate
  onTimePaymentRate: number | null;        // % of months with 0 DPD
  paymentTrend: 'improving' | 'stable' | 'worsening' | null;
  recentDPDTrend: number[] | null;         // last 6 months DPD [newest→oldest]
}

export interface AdvisorInsight {
  label: string;
  detail: string;
  lenderName?: string;
  debtType?: string;
  amount?: number | null;
  percentage?: number | null;
  dpd?: number | null;
}

export interface AdvisorContext {
  source: 'report' | 'creditor' | 'general';
  userName: string | null;
  segment: Segment | null;
  financialGoal: string | null;
  creditScore: number | null;
  scoreGapTo750: number | null;
  monthlyIncome: number | null;
  monthlyObligation: number | null;
  foirPercentage: number | null;
  activeAccountCount: number;
  closedAccountCount: number;
  delinquentAccountCount: number;
  totalOutstanding: number;
  unsecuredOutstanding: number;
  securedOutstanding: number;
  creditCardCount: number;
  personalLoanCount: number;
  dominantAccounts: AdvisorAccountContext[];
  relevantAccounts: AdvisorAccountContext[];
  topRisks: AdvisorInsight[];
  topOpportunities: AdvisorInsight[];
  overdueHighlights: AdvisorInsight[];
  cardUtilizationHighlights: AdvisorInsight[];
  relevantFacts: string[];
  // Enriched credit report fields (null when no credit report available)
  overallOnTimeRate: number | null;        // aggregate on-time payment % across all accounts
  overallCardUtilization: number | null;   // aggregate credit card utilization %
  totalCreditLimit: number | null;         // sum of all credit card limits
  totalCreditUsed: number | null;          // sum of all credit card outstanding
  enquiryCount: number | null;             // recent credit enquiries
  oldestAccountAgeMonths: number | null;   // age of oldest active account
  newestAccountAgeMonths: number | null;   // age of newest active account
  closedCleanCount: number;                // closed accounts with no DPD history
  closedWithIssuesCount: number;           // closed accounts that had DPD or overdue
  accountsImproving: string[];             // lender names of accounts with improving DPD trend
  reportDate: string | null;               // credit report date for freshness context
  repaymentHighlights: AdvisorInsight[];   // accounts with notable repayment progress
  dataCompleteness: 'full' | 'summary' | 'none';  // 'full' = account-level data, 'summary' = only User/CreditPull aggregates, 'none' = no financial data
}

export interface RenderedTurn {
  reply: string;
  followUps: string[];
  redirectUrl?: string;
  redirectLabel?: string;
}

export interface ChatResponse {
  reply: string;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
  tooltips?: MessageTooltips;
}
