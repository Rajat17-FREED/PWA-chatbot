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
  accountsTotalOutstanding: number | null;
  unsecuredAccountsTotalOutstanding: number | null;
  securedAccountsTotalOutstanding: number | null;
}

export interface AccountHighlight {
  id: string;
  lenderName: string;
  debtType: string | null;
  accountType: string | null;
  outstandingAmount: number | null;
  overdueAmount: number | null;
  interestRate: number | null;
  isDelinquent: boolean;
  maxDPD: number | null;
  status: string | null;
  category: 'secured' | 'unsecured' | 'credit_card' | 'other';
  isSettlementEligible: boolean;
}

export interface User {
  leadRefId: string;
  firstName: string;
  lastName: string;
  segment: Segment;
  creditScore: number | null;
  monthlyIncome: number | null;
  monthlyObligation: number | null;
  foirPercentage: number | null;
  creditPull: CreditPullSummary | null;
  accountHighlights?: AccountHighlight[];
}

export interface ConversationStarter {
  text: string;
  intentTag: string;
  redirectTo: string;
}

/** Detailed info for a single account in a tooltip hover group */
export interface TooltipAccountDetail {
  name: string;
  debtType?: string;
  outstanding?: number | null;
  overdue?: number | null;
  maxDPD?: number | null;          // worst days past due (for delinquent accounts)
}

/** A named group of accounts shown on hover over a bold number */
export interface TooltipGroup {
  label: string;       // e.g. "Accounts with missed payments"
  accounts: string[];  // e.g. ["HDFC Bank Ltd", "Bajaj Finance"]
  details?: TooltipAccountDetail[];  // richer data for enhanced display
  rawCount?: number;   // pre-dedup account count (AI may reference this number)
}

/** Per-message tooltip lookup by account category */
export interface MessageTooltips {
  overdue?: TooltipGroup;
  active?: TooltipGroup;
  secured?: TooltipGroup;
  unsecured?: TooltipGroup;
}

/** Inline widget variants rendered within chat responses */
export type InlineWidget =
  | { type: 'goalTracker'; currentScore: number; targetScore: number; delta: number; steps: string[] }
  | { type: 'drpSavings'; totalDebt: number; settlementAmount: number; savings: number; debtFreeMonths: number }
  | { type: 'dcpSavings'; currentTotalEMI: number; consolidatedEMI: number; emiSavings: number; tenureMonths: number }
  | { type: 'carousel'; items: Array<{ title: string; description: string }> }
  | { type: 'youtubeEmbed'; videoId: string; title?: string };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intentTag?: string;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
  tooltips?: MessageTooltips;
  lenderSelector?: LenderSelector;
  inlineWidgets?: InlineWidget[];
  retryText?: string;
  retryIntentTag?: string;
}

export interface IdentifyResponse {
  status: 'found' | 'multiple' | 'not_found';
  user?: User;
  candidates?: Array<{
    leadRefId: string;
    firstName: string;
    lastName: string;
    segment: Segment;
  }>;
  starters?: ConversationStarter[];
  message: string;
}

/** Option for the interactive lender selector (harassment flow) */
export interface LenderSelectorOption {
  name: string;
  debtType?: string;
  overdueAmount?: number | null;
  maxDPD?: number | null;
}

/** Interactive lender checkbox selector — injected into harassment first-response */
export interface LenderSelector {
  prompt: string;
  lenders: LenderSelectorOption[];
  allowOther: boolean;
}

export interface ChatResponse {
  reply: string;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
  tooltips?: MessageTooltips;
  lenderSelector?: LenderSelector;
  inlineWidgets?: InlineWidget[];
}

export type ChatPhase =
  | 'greeting'
  | 'identifying'
  | 'disambiguating'
  | 'starters'
  | 'chatting';

export interface ChatState {
  phase: ChatPhase;
  user: User | null;
  messages: Message[];
  isLoading: boolean;
  candidates: Array<{
    leadRefId: string;
    firstName: string;
    lastName: string;
    segment: Segment;
  }>;
  starters: ConversationStarter[];
}
