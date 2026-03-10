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
}

export interface ChatResponse {
  reply: string;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
}
