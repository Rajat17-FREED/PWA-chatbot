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
}

export interface ConversationStarter {
  text: string;
  intentTag: string;
  redirectTo: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
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

export interface ChatResponse {
  reply: string;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
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
