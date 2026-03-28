import { ChatMessage } from '../types';

const DIRECT_INTENT_PATTERNS: Array<{ intentTag: string; pattern: RegExp }> = [
  {
    intentTag: 'INTENT_HARASSMENT',
    pattern: /\b(harass|recovery agent|recovery call|collection call|keep calling|threat|abuse|abusive|visit(?:ing)? (?:my )?(?:home|office|workplace)|family members?|colleagues?|neighbou?rs?|borrower rights|rbi guideline|i(?:'| a)?m facing harassment from)\b/i,
  },
  {
    intentTag: 'INTENT_CREDIT_SCORE_TARGET',
    pattern: /\b(?:reach|get to|raise(?: it)? to|push past|score of)\s+\d{3}\b/i,
  },
  {
    intentTag: 'INTENT_SCORE_IMPROVEMENT',
    pattern: /\b(improve|increase|boost|raise|fix)\b.{0,24}\b(?:credit score|cibil|score)\b/i,
  },
  {
    intentTag: 'INTENT_SCORE_DIAGNOSIS',
    pattern: /\b(?:what'?s affecting|what'?s hurting|why is|pulling down)\b.{0,40}\b(?:credit score|cibil|score)\b/i,
  },
  {
    intentTag: 'INTENT_EMI_OPTIMISATION',
    pattern: /\b(?:lower|reduce|bring down|cut)\b.{0,24}\bemi\b|\bsingle emi\b|\bcombine\b.{0,20}\b(?:loan|emi)s?\b|\bconsolidat(?:e|ion)\b/i,
  },
  {
    intentTag: 'INTENT_EMI_STRESS',
    pattern: /\bmultiple (?:emi|payments?)\b|\bstressful\b.{0,20}\b(?:emi|payment)\b|\boverwhelming\b.{0,24}\b(?:payment|emi)\b/i,
  },
  {
    intentTag: 'INTENT_INTEREST_OPTIMISATION',
    pattern: /\btoo much interest\b|\binterest rate\b|\bsaving on interest\b|\binterest cost\b/i,
  },
  {
    intentTag: 'INTENT_DELINQUENCY_STRESS',
    pattern: /\b(unable|struggling|can'?t|cannot|missed|overdue|dues?)\b.{0,28}\b(pay|payment|emi|credit card)\b|\bpayment pressure\b/i,
  },
  {
    intentTag: 'INTENT_GOAL_BASED_LOAN',
    pattern: /\b(?:get|need|want)\b.{0,20}\bloan\b|\bloan approved\b|\bbest rate\b|\bloan readiness\b/i,
  },
  {
    intentTag: 'INTENT_LOAN_ELIGIBILITY',
    pattern: /\bloan applications? keep getting rejected\b|\bloan eligibility\b|\bwhy was my loan rejected\b/i,
  },
  {
    intentTag: 'INTENT_PROFILE_ANALYSIS',
    pattern: /\bfinancial profile\b|\bprofile analysis\b|\bfull profile\b|\boverall picture\b|\bwhat does my profile look like\b/i,
  },
  {
    intentTag: 'INTENT_GOAL_TRACKING',
    pattern: /\bgoal tracker\b|\btrack my (?:score|progress)\b/i,
  },
];

const CONTINUATION_PATTERNS = [
  /\b(this|that|it|them|those|these|again|still|more|exactly|first|next)\b/i,
  /\bwhat about\b/i,
  /\bhow about\b/i,
  /\bwhich one\b/i,
  /\bwhich ones\b/i,
  /\bcan you\b/i,
  /\bshould i\b/i,
  /\bwill that\b/i,
  /\bhow much\b/i,
];

export function getCurrentUserTurnCount(history: ChatMessage[], messageCount?: number): number {
  const priorUserTurns = history.filter(message => message.role === 'user').length;
  const currentTurn = priorUserTurns + 1;
  if (typeof messageCount !== 'number' || !Number.isFinite(messageCount)) {
    return currentTurn;
  }
  return Math.max(messageCount, currentTurn);
}

export function getLastUserIntentTag(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role === 'user' && message.intentTag) return message.intentTag;
  }
  return undefined;
}

export function inferDirectIntentTag(message: string): string | undefined {
  const normalized = message.trim();
  if (!normalized) return undefined;

  const match = DIRECT_INTENT_PATTERNS.find(rule => rule.pattern.test(normalized));
  return match?.intentTag;
}

function looksLikeContinuationMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 12) return true;

  return CONTINUATION_PATTERNS.some(pattern => pattern.test(normalized));
}

export function resolveConversationIntentTag(
  message: string,
  history: ChatMessage[],
  explicitIntentTag?: string
): string | undefined {
  if (explicitIntentTag) return explicitIntentTag;

  const directIntent = inferDirectIntentTag(message);
  if (directIntent) return directIntent;

  const priorIntent = getLastUserIntentTag(history);
  if (!priorIntent) return undefined;

  return looksLikeContinuationMessage(message) ? priorIntent : undefined;
}
