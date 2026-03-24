/**
 * Code-Based Evals — Deterministic quality checks for chatbot responses.
 *
 * Each eval returns a binary PASS/FAIL with details on failure.
 * These checks are cheap, fast, and require no LLM calls.
 */

import {
  AdvisorContext,
  ChatResponse,
  ResponseGroundingContext,
  Segment,
} from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EvalResult {
  evalName: string;
  category: EvalCategory;
  passed: boolean;
  details?: string;
}

export type EvalCategory =
  | 'segment_isolation'
  | 'data_accuracy'
  | 'format_compliance'
  | 'redirect_correct'
  | 'tone_language';

// ── Constants ────────────────────────────────────────────────────────────────

/** Programs/terms forbidden per segment */
const SEGMENT_FORBIDDEN_TERMS: Record<string, RegExp[]> = {
  DRP_Eligible: [
    /\bDCP\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
    /\bDEP\b/i,
    /\bdebt\s+elimination\s+program\b/i,
  ],
  DRP_Ineligible: [
    /\bDRP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bDCP\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
    /\bDEP\b/i,
    /\bdebt\s+elimination\s+program\b/i,
  ],
  DCP_Eligible: [
    /\bDRP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bsettlement\s+program\b/i,
    /\bDEP\b/i,
    /\bdebt\s+elimination\s+program\b/i,
  ],
  DCP_Ineligible: [
    /\bDRP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bDCP\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
    /\bDEP\b/i,
    /\bdebt\s+elimination\s+program\b/i,
  ],
  DEP: [
    /\bDRP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bsettlement\s+program\b/i,
    /\bDCP\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
  ],
  NTC: [
    /\bDRP\b/i,
    /\bDCP\b/i,
    /\bDEP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
    /\bdebt\s+elimination\s+program\b/i,
    /\bsettlement\s+program\b/i,
  ],
  Others: [
    /\bDRP\b/i,
    /\bDCP\b/i,
    /\bDEP\b/i,
    /\bdebt\s+resolution\s+program\b/i,
    /\bdebt\s+consolidation\s+program\b/i,
    /\bdebt\s+elimination\s+program\b/i,
    /\bsettlement\s+program\b/i,
  ],
};

/** Redirect routes allowed per segment */
const SEGMENT_ALLOWED_REDIRECTS: Record<string, string[]> = {
  DRP_Eligible: ['/drp', '/freed-shield', '/goal-tracker', '/credit-score', '/dispute'],
  DRP_Ineligible: ['/freed-shield', '/goal-tracker', '/credit-score', '/dispute'],
  DCP_Eligible: ['/dcp', '/goal-tracker', '/credit-score'],
  DCP_Ineligible: ['/goal-tracker', '/credit-score'],
  DEP: ['/dep', '/goal-tracker', '/credit-score'],
  NTC: ['/credit-score', '/goal-tracker', '/'],
  Others: ['/credit-score', '/goal-tracker'],
};

const ALL_ALLOWED_REDIRECTS = ['/dep', '/drp', '/dcp', '/credit-score', '/goal-tracker', '/freed-shield', '/dispute'];

/** Jargon that should be avoided unless user used it first */
const JARGON_PATTERNS: Array<{ pattern: RegExp; plain: string }> = [
  { pattern: /\bFOIR\b/, plain: 'monthly debt-to-income ratio' },
  { pattern: /\bDPD\b/, plain: 'days past due' },
  { pattern: /\bdelinquen(?:t|cy)\b/i, plain: 'overdue / missed payments' },
  { pattern: /\butilization\b/i, plain: 'how much of card limit is used' },
];

const GENERIC_FOLLOW_UP_PATTERNS: RegExp[] = [
  /^yes\b/i,
  /^no\b/i,
  /^show me(?: my)? data\b/i,
  /^show me\b/i,
  /^can you show me\b/i,
  /^tell me more\b/i,
  /^what can i do\b/i,
  /^help me\b/i,
  /^go ahead\b/i,
  /^can we do that\b/i,
  /^i(?:'| a)?d like(?: to)?(?: do that|understand|know more)?\b/i,
  /^okay\b/i,
  /^sure\b/i,
];

const LENDER_MENTION_PATTERN = /\b([A-Z][A-Za-z&.\-]*(?:\s+(?:and|[A-Z][A-Za-z&.\-]*)){0,8}\s+(?:Bank|Finance|Financial|Capital|ARC|Services|Cards?|Housing|FinCorp|Corp|Credit|Private(?:\s+Limited)?|Pvt(?:\s+Ltd)?|Ltd|Limited))\b/g;

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseINR(token: string): number | null {
  const cleaned = token.replace(/₹\s?/, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function lenderKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isKnownLender(mention: string, allowedLenders: string[]): boolean {
  const key = lenderKey(mention);
  if (key.length < 3) return false;
  return allowedLenders.some(l => {
    const lk = lenderKey(l);
    return lk.length >= 3 && (key.includes(lk) || lk.includes(key));
  });
}

// ── Individual Evals ─────────────────────────────────────────────────────────

function evalSegmentIsolation(
  reply: string,
  segment: Segment,
): EvalResult {
  const forbidden = SEGMENT_FORBIDDEN_TERMS[segment] || [];
  const violations: string[] = [];

  for (const pattern of forbidden) {
    const match = reply.match(pattern);
    if (match) {
      violations.push(`"${match[0]}" found in response`);
    }
  }

  return {
    evalName: 'segment_isolation',
    category: 'segment_isolation',
    passed: violations.length === 0,
    details: violations.length > 0
      ? `Forbidden terms for ${segment}: ${violations.join('; ')}`
      : undefined,
  };
}

function evalCreditScoreAccuracy(
  reply: string,
  grounding: ResponseGroundingContext | null,
): EvalResult {
  if (!grounding || grounding.creditScore === null || grounding.creditScore === undefined) {
    return { evalName: 'credit_score_accuracy', category: 'data_accuracy', passed: true, details: 'No credit score to verify' };
  }

  const match = reply.match(/credit score(?:\s*(?:is|of|at|stands at|currently|around|near))?\s*(\d{3})/i);
  if (!match) {
    return { evalName: 'credit_score_accuracy', category: 'data_accuracy', passed: true, details: 'No credit score mentioned in response' };
  }

  const mentioned = Number(match[1]);
  const passed = mentioned === grounding.creditScore;
  return {
    evalName: 'credit_score_accuracy',
    category: 'data_accuracy',
    passed,
    details: passed ? undefined : `Response says ${mentioned}, actual is ${grounding.creditScore}`,
  };
}

function evalLenderAccuracy(
  reply: string,
  grounding: ResponseGroundingContext | null,
): EvalResult {
  if (!grounding || grounding.allowedLenders.length === 0) {
    return { evalName: 'lender_accuracy', category: 'data_accuracy', passed: true, details: 'No lender data to verify' };
  }

  const mentions = [...reply.matchAll(LENDER_MENTION_PATTERN)].map(m => m[1]);
  const unknowns: string[] = [];

  for (const mention of mentions) {
    if (!isKnownLender(mention, grounding.allowedLenders)) {
      unknowns.push(mention);
    }
  }

  return {
    evalName: 'lender_accuracy',
    category: 'data_accuracy',
    passed: unknowns.length === 0,
    details: unknowns.length > 0
      ? `Unknown lenders mentioned: ${unknowns.join(', ')}`
      : undefined,
  };
}

function evalAmountAccuracy(
  reply: string,
  grounding: ResponseGroundingContext | null,
): EvalResult {
  if (!grounding || !grounding.lenderFacts || !grounding.knownNumericFacts) {
    return { evalName: 'amount_accuracy', category: 'data_accuracy', passed: true, details: 'No amount data to verify' };
  }

  let mismatches = 0;
  const issues: string[] = [];

  for (const line of reply.split('\n')) {
    if (!line.trim()) continue;
    const amountTokens = line.match(/₹\s?[\d,]+/g);
    if (!amountTokens) continue;

    const lenderMentions = [...line.matchAll(LENDER_MENTION_PATTERN)].map(m => m[1]);
    if (lenderMentions.length === 0) continue;

    for (const mention of lenderMentions) {
      if (!isKnownLender(mention, grounding.allowedLenders)) continue;

      const mentionK = lenderKey(mention);
      let matchedFacts: { outstandingAmounts: number[]; overdueAmounts: number[]; creditLimits: number[] } | null = null;

      for (const [lender, facts] of Object.entries(grounding.lenderFacts)) {
        const lk = lenderKey(lender);
        if (lk.length >= 3 && (mentionK.includes(lk) || lk.includes(mentionK))) {
          matchedFacts = facts;
          break;
        }
      }

      if (!matchedFacts) continue;

      const validAmounts = [
        ...matchedFacts.outstandingAmounts,
        ...matchedFacts.overdueAmounts,
        ...matchedFacts.creditLimits,
      ].map(v => Math.round(v)).filter(v => v > 0);

      if (validAmounts.length === 0) continue;

      for (const token of amountTokens) {
        const parsed = parseINR(token);
        if (parsed === null || parsed === 0) continue;
        const isNear = validAmounts.some(known => Math.abs(parsed - known) <= Math.max(known * 0.05, 500));
        const isKnownGlobal = grounding.knownNumericFacts.includes(parsed);
        if (!isNear && !isKnownGlobal) {
          mismatches++;
          issues.push(`${mention}: ${token} not found in known amounts`);
        }
      }
    }
  }

  return {
    evalName: 'amount_accuracy',
    category: 'data_accuracy',
    passed: mismatches === 0,
    details: mismatches > 0 ? `${mismatches} amount mismatches: ${issues.slice(0, 3).join('; ')}` : undefined,
  };
}

function evalNoFalseNoLoans(
  reply: string,
  advisorContext: AdvisorContext | null,
): EvalResult {
  if (!advisorContext || advisorContext.activeAccountCount === 0) {
    return { evalName: 'no_false_no_loans', category: 'data_accuracy', passed: true };
  }

  const noLoanPatterns = [
    /\bno\s+(?:active\s+)?loans?\b/i,
    /\bno\s+(?:active\s+)?debt\b/i,
    /\bdon'?t\s+(?:have|owe)\s+any/i,
    /\bzero\s+(?:outstanding|debt|loans?)\b/i,
  ];

  for (const pattern of noLoanPatterns) {
    if (pattern.test(reply)) {
      return {
        evalName: 'no_false_no_loans',
        category: 'data_accuracy',
        passed: false,
        details: `Response claims no loans/debt but user has ${advisorContext.activeAccountCount} active accounts`,
      };
    }
  }

  return { evalName: 'no_false_no_loans', category: 'data_accuracy', passed: true };
}

function evalBusinessLoanLeak(
  reply: string,
  grounding: ResponseGroundingContext | null,
): EvalResult {
  if (!grounding || grounding.likelyCardLenders.length === 0) {
    return { evalName: 'no_business_loan_leak', category: 'data_accuracy', passed: true };
  }

  for (const lender of grounding.likelyCardLenders) {
    const escaped = lender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`${escaped}[^\\n.?!]{0,160}\\bbusiness\\s+loan`, 'i').test(reply)) {
      return {
        evalName: 'no_business_loan_leak',
        category: 'data_accuracy',
        passed: false,
        details: `Card lender "${lender}" mislabeled as business loan`,
      };
    }
  }

  return { evalName: 'no_business_loan_leak', category: 'data_accuracy', passed: true };
}

function evalFollowUpQuality(
  followUps: string[] | undefined,
): EvalResult {
  if (!followUps) {
    return { evalName: 'follow_up_quality', category: 'format_compliance', passed: true, details: 'No follow-ups to check' };
  }

  const issues: string[] = [];

  if (followUps.length !== 3) {
    issues.push(`Expected 3 follow-ups, got ${followUps.length}`);
  }

  for (const fu of followUps) {
    if (fu.length < 8) issues.push(`Follow-up too short: "${fu}"`);
    if (fu.length > 100) issues.push(`Follow-up too long (${fu.length} chars): "${fu.slice(0, 50)}..."`);
    if (GENERIC_FOLLOW_UP_PATTERNS.some(p => p.test(fu.trim()))) {
      issues.push(`Generic follow-up: "${fu}"`);
    }
  }

  return {
    evalName: 'follow_up_quality',
    category: 'format_compliance',
    passed: issues.length === 0,
    details: issues.length > 0 ? issues.join('; ') : undefined,
  };
}

function evalNoEmDashes(reply: string): EvalResult {
  const hasEmDash = /[\u2013\u2014]/.test(reply);
  const hasDoubleDash = /--/.test(reply);

  return {
    evalName: 'no_em_dashes',
    category: 'format_compliance',
    passed: !hasEmDash && !hasDoubleDash,
    details: hasEmDash ? 'Contains em/en dashes' : hasDoubleDash ? 'Contains double hyphens' : undefined,
  };
}

function evalRedirectCorrectness(
  response: ChatResponse,
  segment: Segment,
): EvalResult {
  if (!response.redirectUrl) {
    return { evalName: 'redirect_correct', category: 'redirect_correct', passed: true, details: 'No redirect in response' };
  }

  const allowed = SEGMENT_ALLOWED_REDIRECTS[segment] || [];
  const isAllowedGlobal = ALL_ALLOWED_REDIRECTS.includes(response.redirectUrl);
  const isAllowedForSegment = allowed.includes(response.redirectUrl);

  if (!isAllowedGlobal) {
    return {
      evalName: 'redirect_correct',
      category: 'redirect_correct',
      passed: false,
      details: `Redirect "${response.redirectUrl}" not in global allowed routes`,
    };
  }

  if (!isAllowedForSegment) {
    return {
      evalName: 'redirect_correct',
      category: 'redirect_correct',
      passed: false,
      details: `Redirect "${response.redirectUrl}" not allowed for segment ${segment}. Allowed: ${allowed.join(', ')}`,
    };
  }

  return { evalName: 'redirect_correct', category: 'redirect_correct', passed: true };
}

function evalNoJargon(
  reply: string,
  userMessage: string,
): EvalResult {
  const issues: string[] = [];

  for (const { pattern, plain } of JARGON_PATTERNS) {
    // Skip if user used the term first
    if (pattern.test(userMessage)) continue;
    if (pattern.test(reply)) {
      issues.push(`Jargon "${reply.match(pattern)?.[0]}" found — should use "${plain}"`);
    }
  }

  return {
    evalName: 'no_jargon',
    category: 'tone_language',
    passed: issues.length === 0,
    details: issues.length > 0 ? issues.join('; ') : undefined,
  };
}

function evalUserNameMentioned(
  reply: string,
  userName: string | null,
  messageCount: number,
): EvalResult {
  // Only check on first message
  if (messageCount > 1 || !userName) {
    return { evalName: 'user_name_mentioned', category: 'tone_language', passed: true, details: 'Skipped (not first message or no name)' };
  }

  const namePattern = new RegExp(`\\b${userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const passed = namePattern.test(reply);

  return {
    evalName: 'user_name_mentioned',
    category: 'tone_language',
    passed,
    details: passed ? undefined : `User name "${userName}" not found in first message`,
  };
}

// ── Main Runner ──────────────────────────────────────────────────────────────

export interface CodeEvalInput {
  response: ChatResponse;
  advisorContext: AdvisorContext | null;
  grounding: ResponseGroundingContext | null;
  segment: Segment;
  userMessage: string;
  userName: string | null;
  messageCount: number;
  intentTag?: string;
}

export function runCodeEvals(input: CodeEvalInput): EvalResult[] {
  const { response, advisorContext, grounding, segment, userMessage, userName, messageCount } = input;
  const reply = response.reply || '';

  return [
    evalSegmentIsolation(reply, segment),
    evalCreditScoreAccuracy(reply, grounding),
    evalLenderAccuracy(reply, grounding),
    evalAmountAccuracy(reply, grounding),
    evalNoFalseNoLoans(reply, advisorContext),
    evalBusinessLoanLeak(reply, grounding),
    evalFollowUpQuality(response.followUps),
    evalNoEmDashes(reply),
    evalRedirectCorrectness(response, segment),
    evalNoJargon(reply, userMessage),
    evalUserNameMentioned(reply, userName, messageCount),
  ];
}

/** Aggregate results by category */
export function summarizeResults(results: EvalResult[]): Record<EvalCategory, { passed: number; failed: number; rate: string }> {
  const categories: EvalCategory[] = ['segment_isolation', 'data_accuracy', 'format_compliance', 'redirect_correct', 'tone_language'];
  const summary: Record<string, { passed: number; failed: number; rate: string }> = {};

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const passed = catResults.filter(r => r.passed).length;
    const failed = catResults.filter(r => !r.passed).length;
    const total = passed + failed;
    summary[cat] = {
      passed,
      failed,
      rate: total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : 'N/A',
    };
  }

  return summary as Record<EvalCategory, { passed: number; failed: number; rate: string }>;
}
