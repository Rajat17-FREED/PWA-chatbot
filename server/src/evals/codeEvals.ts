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

// ── Required Terms (complement of segment isolation) ─────────────────────────

/** For eligible segments, certain intents MUST produce program mentions */
const SEGMENT_REQUIRED_TERMS: Record<string, { intents: string[]; patterns: RegExp[]; label: string }> = {
  DRP_Eligible: {
    intents: ['INTENT_DELINQUENCY_STRESS', 'INTENT_HARASSMENT', 'INTENT_GOAL_BASED_LOAN'],
    patterns: [/\bDRP\b/i, /\bdebt\s+resolution\b/i, /\bsettlement\b/i, /\bFREED['']?s?\s+(?:program|plan)\b/i],
    label: 'DRP/settlement mention',
  },
  DCP_Eligible: {
    intents: ['INTENT_EMI_OPTIMISATION', 'INTENT_EMI_STRESS', 'INTENT_GOAL_BASED_PATH'],
    patterns: [/\bDCP\b/i, /\bdebt\s+consolidation\b/i, /\bconsolidat(?:e|ion|ing)\b/i],
    label: 'DCP/consolidation mention',
  },
  DEP: {
    intents: ['INTENT_INTEREST_OPTIMISATION', 'INTENT_GOAL_BASED_PATH'],
    patterns: [/\bDEP\b/i, /\baccelerat(?:e|ed|ing)\s+(?:repayment|debt|pay)/i, /\bdebt\s+elimination\b/i, /\bfaster\s+repayment\b/i, /\bpay(?:ing)?\s+off\s+(?:\w+\s+)?faster\b/i, /\bFREED['']?s?\s+(?:approach|program|plan)\b/i],
    label: 'DEP/accelerated repayment mention',
  },
};

function evalRequiredTerms(
  reply: string,
  segment: Segment,
  intentTag?: string,
): EvalResult {
  const req = SEGMENT_REQUIRED_TERMS[segment];

  // Only applies to eligible segments with specific intents
  if (!req || !intentTag || !req.intents.includes(intentTag)) {
    return { evalName: 'required_terms', category: 'segment_isolation', passed: true, details: 'Not applicable for this segment/intent' };
  }

  const found = req.patterns.some(p => p.test(reply));
  return {
    evalName: 'required_terms',
    category: 'segment_isolation',
    passed: found,
    details: found ? undefined : `Expected ${req.label} for ${segment} + ${intentTag} but none found in response`,
  };
}

// ── Ineligibility Secrecy ────────────────────────────────────────────────────

/** Ineligible segments must NEVER use words like "eligible", "ineligible", "qualify" */
const INELIGIBLE_SEGMENTS: Segment[] = ['DRP_Ineligible', 'DCP_Ineligible'];
const ELIGIBILITY_LEAK_PATTERNS: RegExp[] = [
  /\b(?:in)?eligibl(?:e|ity)\b/i,
  /\bqualif(?:y|ied|ies|ication)\b/i,
  /\bnot\s+(?:currently\s+)?eligible\b/i,
  /\bdon'?t\s+qualify\b/i,
];

function evalIneligibilitySecrecy(
  reply: string,
  segment: Segment,
): EvalResult {
  if (!INELIGIBLE_SEGMENTS.includes(segment)) {
    return { evalName: 'ineligibility_secrecy', category: 'segment_isolation', passed: true, details: 'Not applicable for this segment' };
  }

  const leaks: string[] = [];
  for (const pattern of ELIGIBILITY_LEAK_PATTERNS) {
    const match = reply.match(pattern);
    if (match) leaks.push(`"${match[0]}"`);
  }

  return {
    evalName: 'ineligibility_secrecy',
    category: 'segment_isolation',
    passed: leaks.length === 0,
    details: leaks.length > 0 ? `Eligibility language leaked for ${segment}: ${leaks.join(', ')}` : undefined,
  };
}

// ── Greeting Suppression (turn 2+) ──────────────────────────────────────────

const GREETING_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey)\s/i,
  /^(?:great|good|excellent)\s+question/i,
  /^absolutely[!,]/i,
  /^sure[!,]/i,
  /^of\s+course[!,]/i,
];

function evalGreetingSuppression(
  reply: string,
  messageCount: number,
): EvalResult {
  if (messageCount <= 1) {
    return { evalName: 'greeting_suppression', category: 'tone_language', passed: true, details: 'First turn — greeting allowed' };
  }

  const violations: string[] = [];
  for (const pattern of GREETING_PATTERNS) {
    const match = reply.match(pattern);
    if (match) violations.push(`"${match[0]}"`);
  }

  return {
    evalName: 'greeting_suppression',
    category: 'tone_language',
    passed: violations.length === 0,
    details: violations.length > 0 ? `Turn ${messageCount} starts with greeting: ${violations.join(', ')}` : undefined,
  };
}

// ── Bold Formatting Check ───────────────────────────────────────────────────

function evalBoldFormatting(
  reply: string,
  messageCount: number,
): EvalResult {
  // Only check on detailed responses (first turn, non-greeting)
  if (messageCount > 1) {
    return { evalName: 'bold_formatting', category: 'format_compliance', passed: true, details: 'Skipped for follow-up turns' };
  }

  // Short responses (greetings) don't need bold
  if (reply.length < 200) {
    return { evalName: 'bold_formatting', category: 'format_compliance', passed: true, details: 'Short response — bold not required' };
  }

  const hasAmounts = /₹\s?[\d,]+/.test(reply);
  const hasBoldAmounts = /\*\*₹\s?[\d,]+/.test(reply) || /₹\s?[\d,]+\*\*/.test(reply);
  const boldCount = (reply.match(/\*\*[^*]+\*\*/g) || []).length;

  // If response has amounts but none are bolded, that's a formatting issue
  if (hasAmounts && !hasBoldAmounts && boldCount === 0) {
    return {
      evalName: 'bold_formatting',
      category: 'format_compliance',
      passed: false,
      details: 'Response contains amounts but no bold formatting at all',
    };
  }

  return { evalName: 'bold_formatting', category: 'format_compliance', passed: true };
}

// ── Follow-Up Deduplication Across Turns ──────────────────────────────────────

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function evalFollowUpDeduplication(
  followUps: string[] | undefined,
  priorFollowUps: string[],
): EvalResult {
  if (!followUps || followUps.length === 0 || priorFollowUps.length === 0) {
    return { evalName: 'follow_up_dedup', category: 'format_compliance', passed: true, details: 'No prior follow-ups to check against' };
  }

  const priorNormalized = priorFollowUps.map(normalizeForComparison);
  const duplicates: string[] = [];

  for (const fu of followUps) {
    const fuNorm = normalizeForComparison(fu);

    // Check exact match
    if (priorNormalized.includes(fuNorm)) {
      duplicates.push(`"${fu}" (exact match)`);
      continue;
    }

    // Check high similarity: shared prefix of 30+ chars
    for (const prior of priorNormalized) {
      const minLen = Math.min(fuNorm.length, prior.length);
      if (minLen >= 25) {
        const prefixLen = Math.min(25, minLen);
        if (fuNorm.slice(0, prefixLen) === prior.slice(0, prefixLen)) {
          duplicates.push(`"${fu}" (similar to prior)`);
          break;
        }
      }
    }
  }

  return {
    evalName: 'follow_up_dedup',
    category: 'format_compliance',
    passed: duplicates.length === 0,
    details: duplicates.length > 0
      ? `${duplicates.length} follow-up(s) duplicated from prior turns: ${duplicates.join('; ')}`
      : undefined,
  };
}

// ── Response Content Repetition Across Turns ─────────────────────────────────

function evalResponseDeduplication(
  reply: string,
  priorResponses: string[],
  messageCount: number,
): EvalResult {
  if (messageCount <= 1 || priorResponses.length === 0) {
    return { evalName: 'response_dedup', category: 'format_compliance', passed: true, details: 'First turn — no prior responses' };
  }

  const issues: string[] = [];

  // Extract bullet points / key phrases from current response
  const currentBullets = reply
    .split('\n')
    .map(line => line.replace(/^[\s*•\-\d.]+/, '').trim())
    .filter(line => line.length > 30);

  // Check each bullet against prior responses
  let repeatedBullets = 0;
  for (const bullet of currentBullets) {
    const bulletNorm = normalizeForComparison(bullet);
    for (const prior of priorResponses) {
      const priorNorm = normalizeForComparison(prior);
      // Check if this bullet appears verbatim (or nearly) in a prior response
      if (priorNorm.includes(bulletNorm.slice(0, Math.min(60, bulletNorm.length)))) {
        repeatedBullets++;
        break;
      }
    }
  }

  // More than 40% of substantial bullets are repeated → fail
  const repeatRate = currentBullets.length > 0 ? repeatedBullets / currentBullets.length : 0;
  if (repeatRate > 0.4 && repeatedBullets >= 3) {
    issues.push(`${repeatedBullets}/${currentBullets.length} content lines (${(repeatRate * 100).toFixed(0)}%) appear in prior responses`);
  }

  // Check section heading reuse
  const headingPattern = /^[A-Z][A-Z ]{3,}$/gm;
  const currentHeadings = [...reply.matchAll(headingPattern)].map(m => m[0].trim());
  for (const prior of priorResponses) {
    const priorHeadings = [...prior.matchAll(headingPattern)].map(m => m[0].trim());
    const sharedHeadings = currentHeadings.filter(h => priorHeadings.includes(h));
    if (sharedHeadings.length >= 2) {
      issues.push(`Reused ${sharedHeadings.length} section headings from prior response: ${sharedHeadings.join(', ')}`);
    }
  }

  return {
    evalName: 'response_dedup',
    category: 'format_compliance',
    passed: issues.length === 0,
    details: issues.length > 0 ? issues.join('; ') : undefined,
  };
}

// ── DRP Data Richness (numerical data when listing serviceable accounts) ────

function evalDrpDataRichness(
  reply: string,
  segment: Segment,
  intentTag?: string,
): EvalResult {
  // Only applies to DRP_Eligible when discussing settlement/serviceable accounts
  if (segment !== 'DRP_Eligible') {
    return { evalName: 'drp_data_richness', category: 'data_accuracy', passed: true, details: 'Not DRP_Eligible' };
  }

  // Only check if response lists lenders in context of settlement/DRP
  const mentionsSettlement = /settl(?:e|ement|ing)|DRP|debt resolution|serviceable/i.test(reply);
  if (!mentionsSettlement) {
    return { evalName: 'drp_data_richness', category: 'data_accuracy', passed: true, details: 'No settlement context' };
  }

  // Count lender mentions that have amounts vs those without
  const lenderMentions = [...reply.matchAll(LENDER_MENTION_PATTERN)].map(m => m[1]);
  if (lenderMentions.length === 0) {
    return { evalName: 'drp_data_richness', category: 'data_accuracy', passed: true, details: 'No lender mentions' };
  }

  // Check if lender mentions are accompanied by amounts (₹ within 150 chars)
  let lendersWithAmounts = 0;
  for (const lender of lenderMentions) {
    const lenderIdx = reply.indexOf(lender);
    const surroundingText = reply.slice(Math.max(0, lenderIdx - 20), lenderIdx + lender.length + 150);
    if (/₹\s?[\d,]+/.test(surroundingText)) {
      lendersWithAmounts++;
    }
  }

  const ratio = lendersWithAmounts / lenderMentions.length;
  const passed = ratio >= 0.5 || lenderMentions.length <= 1;

  return {
    evalName: 'drp_data_richness',
    category: 'data_accuracy',
    passed,
    details: !passed
      ? `Only ${lendersWithAmounts}/${lenderMentions.length} lender mentions include numerical data in settlement context`
      : undefined,
  };
}

// ── DCP EMI Data Usage ──────────────────────────────────────────────────────

/**
 * For DCP_Eligible users asking about EMI, the response should use monthlyObligation
 * data instead of stopping to ask the user for their EMI amount.
 */
function evalDcpEmiDataUsage(reply: string, segment: Segment, intentTag?: string): EvalResult {
  // Only applies to DCP_Eligible with EMI-related intents
  if (segment !== 'DCP_Eligible' ||
    (intentTag !== 'INTENT_EMI_OPTIMISATION' && intentTag !== 'INTENT_EMI_STRESS')) {
    return { evalName: 'dcp_emi_data_usage', category: 'data_accuracy', passed: true };
  }

  // Check if the response stops to ask for EMI instead of providing info
  const asksForEmi = /could you share your.{0,30}(total|monthly|approximate).{0,20}emi/i.test(reply) ||
    /share your.{0,20}emi/i.test(reply) ||
    /what is your.{0,20}(total|monthly).{0,20}emi/i.test(reply);

  return {
    evalName: 'dcp_emi_data_usage',
    category: 'data_accuracy',
    passed: !asksForEmi,
    details: asksForEmi
      ? 'Response asks user for EMI amount instead of using monthlyObligation data. Should use available data and provide substantive advice.'
      : undefined,
  };
}

// ── Follow-Up Naturalness ───────────────────────────────────────────────────

/**
 * Follow-ups should sound natural and conversational, not robotic.
 */
function evalFollowUpNaturalness(followUps: string[] | undefined): EvalResult {
  if (!followUps || followUps.length === 0) {
    return { evalName: 'followup_naturalness', category: 'tone_language', passed: true };
  }

  const roboticPatterns = [
    /^how can i get a /i,
    /^what is (?:the |my |a )(?:best|exact|optimal|ideal|right|correct) /i,
    /^what is (?:a |an |the )?(?:FOIR|DPD|NPA|EMI ratio)\b/i,
    /^show me /i,
    /^tell me (?:about |more about )/i,
    /^can you show me /i,
    /^can you tell me /i,
  ];

  const roboticFollowUps = followUps.filter(fu =>
    roboticPatterns.some(p => p.test(fu.trim()))
  );

  const passed = roboticFollowUps.length === 0;
  return {
    evalName: 'followup_naturalness',
    category: 'tone_language',
    passed,
    details: !passed
      ? `${roboticFollowUps.length} follow-up(s) use robotic phrasing: "${roboticFollowUps[0]}". Use conversational phrasing instead.`
      : undefined,
  };
}

// ── Market Rate Hallucination Check ──────────────────────────────────────────

/**
 * DEP/interest-related responses should NOT cite specific market interest rate
 * ranges from LLM training data (e.g. "9.5% to 21%", "11% to 28%").
 * Only rates from user's actual account data are acceptable.
 */
function evalNoMarketRateHallucination(
  reply: string,
  segment: Segment,
  intentTag?: string,
): EvalResult {
  // Only check interest/loan-related intents
  if (!intentTag || !['INTENT_INTEREST_OPTIMISATION', 'INTENT_GOAL_BASED_LOAN'].includes(intentTag)) {
    return { evalName: 'no_market_rate_hallucination', category: 'data_accuracy', passed: true, details: 'Not applicable' };
  }

  // Pattern: "X% to Y%" or "between X% and Y%" suggesting rate ranges
  const rateRangePattern = /\b(\d{1,2}(?:\.\d+)?)\s*%\s*to\s*(\d{1,2}(?:\.\d+)?)\s*%/gi;
  const betweenPattern = /between\s+(\d{1,2}(?:\.\d+)?)\s*%\s*(?:and|to)\s*(\d{1,2}(?:\.\d+)?)\s*%/gi;

  const ranges: string[] = [];
  let match;
  while ((match = rateRangePattern.exec(reply)) !== null) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    // Rate ranges spanning more than 5% are likely market generalizations, not user data
    if (high - low > 5) {
      ranges.push(match[0]);
    }
  }
  while ((match = betweenPattern.exec(reply)) !== null) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    if (high - low > 5) {
      ranges.push(match[0]);
    }
  }

  const passed = ranges.length === 0;
  return {
    evalName: 'no_market_rate_hallucination',
    category: 'data_accuracy',
    passed,
    details: !passed
      ? `Response contains likely hallucinated market rate ranges: ${ranges.join(', ')}. Use qualitative language instead.`
      : undefined,
  };
}

// ── Debt Amount Context Check ───────────────────────────────────────────────

/**
 * When a sub-amount (like DRP serviceable outstanding) is mentioned that is
 * LESS than totalOutstanding, it should be presented in context with the total,
 * not as a standalone unexplained figure.
 */
function evalDebtAmountContext(
  reply: string,
  segment: Segment,
  advisorContext: AdvisorContext | null,
): EvalResult {
  if (segment !== 'DEP' || !advisorContext) {
    return { evalName: 'debt_amount_context', category: 'data_accuracy', passed: true, details: 'Not applicable' };
  }

  // Find the optimization amount from topOpportunities
  const optInsight = advisorContext.topOpportunities?.find(
    (o: { label: string; amount?: number | null }) => o.label === 'Debt optimization potential' && o.amount
  );
  if (!optInsight || !optInsight.amount) {
    return { evalName: 'debt_amount_context', category: 'data_accuracy', passed: true, details: 'No sub-amount to check' };
  }

  const total = advisorContext.totalOutstanding ?? 0;
  const subAmount = optInsight.amount;

  // If sub-amount equals total, no context issue
  if (Math.abs(subAmount - total) < 100) {
    return { evalName: 'debt_amount_context', category: 'data_accuracy', passed: true };
  }

  // Check if the sub-amount appears in the reply
  const subAmountStr = subAmount.toLocaleString('en-IN');
  if (!reply.includes(subAmountStr) && !reply.includes(String(subAmount))) {
    return { evalName: 'debt_amount_context', category: 'data_accuracy', passed: true, details: 'Sub-amount not mentioned' };
  }

  // If sub-amount is mentioned, total should also be mentioned nearby
  const totalStr = total.toLocaleString('en-IN');
  const totalMentioned = reply.includes(totalStr) || reply.includes(String(total));

  return {
    evalName: 'debt_amount_context',
    category: 'data_accuracy',
    passed: totalMentioned,
    details: !totalMentioned
      ? `₹${subAmountStr} (optimization amount) mentioned without ₹${totalStr} (total outstanding) for context. Sub-amounts should be presented alongside the total.`
      : undefined,
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
  priorFollowUps?: string[];
  priorResponses?: string[];
}

export function runCodeEvals(input: CodeEvalInput): EvalResult[] {
  const { response, advisorContext, grounding, segment, userMessage, userName, messageCount, intentTag, priorFollowUps, priorResponses } = input;
  const reply = response.reply || '';

  return [
    evalSegmentIsolation(reply, segment),
    evalRequiredTerms(reply, segment, intentTag),
    evalCreditScoreAccuracy(reply, grounding),
    evalLenderAccuracy(reply, grounding),
    evalAmountAccuracy(reply, grounding),
    evalNoFalseNoLoans(reply, advisorContext),
    evalBusinessLoanLeak(reply, grounding),
    evalFollowUpQuality(response.followUps),
    evalFollowUpDeduplication(response.followUps, priorFollowUps || []),
    evalResponseDeduplication(reply, priorResponses || [], messageCount),
    evalDrpDataRichness(reply, segment, intentTag),
    evalDcpEmiDataUsage(reply, segment, intentTag),
    evalNoMarketRateHallucination(reply, segment, intentTag),
    evalDebtAmountContext(reply, segment, advisorContext),
    evalFollowUpNaturalness(response.followUps),
    evalNoEmDashes(reply),
    evalRedirectCorrectness(response, segment),
    evalNoJargon(reply, userMessage),
    evalUserNameMentioned(reply, userName, messageCount),
    evalIneligibilitySecrecy(reply, segment),
    evalGreetingSuppression(reply, messageCount),
    evalBoldFormatting(reply, messageCount),
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
