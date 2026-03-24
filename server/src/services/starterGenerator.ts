/**
 * Dynamic Starter Generator -generates personalized conversation starters,
 * welcome messages, and context-aware error responses.
 */

import OpenAI from 'openai';
import { AdvisorContext, ConversationStarter, User, Segment } from '../types';
import { conversationStarters, resolveStarterScoreTargets } from '../prompts/segments';

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

// ── Starter Cache (per leadRefId, 30-min TTL) ───────────────────────────────

interface CachedStarters {
  starters: ConversationStarter[];
  timestamp: number;
}

// In-flight promises for deduplication -prevents duplicate API calls
const inflightGenerations = new Map<string, Promise<ConversationStarter[]>>();

const starterCache = new Map<string, CachedStarters>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCachedStarters(leadRefId: string): ConversationStarter[] | null {
  const entry = starterCache.get(leadRefId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    starterCache.delete(leadRefId);
    return null;
  }
  return entry.starters;
}

// ── Valid intent tags and redirect routes ────────────────────────────────────

const VALID_INTENT_TAGS = new Set([
  'INTENT_DELINQUENCY_STRESS', 'INTENT_SCORE_IMPROVEMENT', 'INTENT_SCORE_DIAGNOSIS',
  'INTENT_HARASSMENT', 'INTENT_EMI_OPTIMISATION', 'INTENT_INTEREST_OPTIMISATION',
  'INTENT_LOAN_ELIGIBILITY', 'INTENT_GOAL_TRACKING', 'INTENT_BEHAVIOUR_IMPACT',
  'INTENT_PROFILE_ANALYSIS', 'INTENT_GOAL_BASED_LOAN', 'INTENT_CREDIT_SCORE_TARGET',
  'INTENT_EMI_STRESS', 'INTENT_GOAL_BASED_PATH',
]);

const VALID_REDIRECTS = new Set([
  '/dep', '/drp', '/dcp', '/credit-score', '/goal-tracker', '/freed-shield', '/dispute', '/',
]);

// ── Dynamic Starter Generation ──────────────────────────────────────────────

function segmentContext(segment: string): string {
  switch (segment) {
    case 'DRP_Eligible':
      return 'User has significant overdue accounts and qualifies for FREED\'s Debt Resolution Program (settlement/negotiation). Five conversation flows: (1) credit score improvement, (2) delinquency stress/inability to pay, (3) recovery agent harassment, (4) credit score target path, (5) goal-based loan readiness. Focus on empathy and settlement as primary solution.';
    case 'DRP_Ineligible':
      return 'User has some missed payments but does not currently meet DRP criteria. Five conversation flows: (1) credit score improvement, (2) payment struggles/self-help, (3) recovery agent harassment (FREED Shield only), (4) credit score target, (5) debt management options. Do NOT suggest DRP or settlement.';
    case 'DCP_Eligible':
      return 'User has high EMI burden across multiple lenders (FOIR > 50%, score > 700) and qualifies for debt consolidation. Five conversation flows: (1) credit score improvement, (2) EMI reduction via DCP, (3) EMI stress/multiple payment management, (4) credit score target path, (5) goal-based guidance. Focus on simplifying payments and reducing burden.';
    case 'DCP_Ineligible':
      return 'User has debt but does not qualify for consolidation (score < 700 or amount < ₹1.5L). Five conversation flows: (1) credit score improvement, (2) EMI reduction alternatives, (3) payment stress management, (4) loan eligibility improvement, (5) goal-based path. Focus on what they CAN do to improve.';
    case 'DEP':
      return 'User is managing repayments well (FOIR < 50%). Five conversation flows: (1) credit score improvement, (2) interest/debt reduction via DEP, (3) goal-based loan readiness, (4) credit score target path, (5) full financial profile analysis. Focus on optimization over rescue.';
    default:
      return 'User is focused on general credit health and financial wellness.';
  }
}

function buildStarterPrompt(user: User, ctx: AdvisorContext): string {
  const topRisks = ctx.topRisks.slice(0, 3).map(r => r.detail).join('; ');
  const topOpps = ctx.topOpportunities.slice(0, 2).map(o => o.detail).join('; ');
  const scoreTarget = ctx.nextScoreTarget || 750;

  return `Generate exactly 5 conversation starters for a financial chatbot user.

USER CONTEXT (for your understanding only -- do NOT put numbers, amounts, or scores in the starters):
- Name: ${user.firstName}
- Segment: ${user.segment}
- Segment meaning: ${segmentContext(user.segment)}
- Credit Score Range: ${ctx.creditScore ? (ctx.creditScore >= 750 ? 'good' : ctx.creditScore >= 650 ? 'moderate' : 'needs improvement') : 'unknown'}
- Financial Goal: ${user.financialGoal || 'not specified'}
- Has Overdue Accounts: ${ctx.delinquentAccountCount > 0 ? 'yes' : 'no'}
- Has Multiple Lenders: ${ctx.activeAccountCount > 3 ? 'yes' : 'no'}
- Top Risks: ${topRisks || 'none'}
- Top Opportunities: ${topOpps || 'none'}

STRUCTURE:
${user.segment === 'DRP_Eligible' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: Delinquency stress/unable to pay (INTENT_DELINQUENCY_STRESS, redirect /drp). Example: "Unable to pay my EMI and credit card dues"
- Position 3: Recovery agent harassment (INTENT_HARASSMENT, redirect /freed-shield). Example: "Recovery agents keep calling me"
- Position 4: Score target (INTENT_CREDIT_SCORE_TARGET, redirect /goal-tracker). MUST include the number ${scoreTarget} in the text. Example: "Help me reach ${scoreTarget}"
- Position 5: Goal-based loan readiness (INTENT_GOAL_BASED_LOAN, redirect /drp). Example: "I want to get a loan - what should I do?"` :
user.segment === 'DRP_Ineligible' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: Payment struggles (INTENT_DELINQUENCY_STRESS, redirect /credit-score). Example: "I'm struggling with payments - what can I do?"
- Position 3: Recovery agent harassment (INTENT_HARASSMENT, redirect /freed-shield). Example: "Recovery agents won't stop calling me"
- Position 4: Score target (INTENT_CREDIT_SCORE_TARGET, redirect /goal-tracker). MUST include the number ${scoreTarget} in the text. Example: "Help me reach ${scoreTarget}"
- Position 5: Debt management options (INTENT_GOAL_BASED_LOAN, redirect /credit-score). Example: "What are my options to manage my debt?"` :
user.segment === 'DEP' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: Interest/debt reduction (INTENT_INTEREST_OPTIMISATION, redirect /dep). Example: "Am I paying too much interest on my loans?"
- Position 3: Score target (INTENT_CREDIT_SCORE_TARGET, redirect /goal-tracker). MUST include the number ${scoreTarget} in the text. Example: "Help me reach ${scoreTarget}"
- Position 4: Goal-based loan readiness (INTENT_GOAL_BASED_LOAN, redirect /credit-score). ${user.financialGoal ? `User wants "${user.financialGoal}" -say something like "I want to get the best rate on a ${user.financialGoal}"` : 'Fallback: "I want to get the best rate on my next loan"'}
- Position 5: Profile overview (INTENT_PROFILE_ANALYSIS, redirect /credit-score). Example: "What does my financial profile look like?"` :
user.segment === 'DCP_Eligible' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: EMI reduction via consolidation (INTENT_EMI_OPTIMISATION, redirect /dcp). Example: "I want to reduce my monthly EMI burden"
- Position 3: EMI stress/multiple payments (INTENT_EMI_STRESS, redirect /dcp). Example: "Managing multiple EMI payments is stressful"
- Position 4: Score target (INTENT_CREDIT_SCORE_TARGET, redirect /goal-tracker). MUST include the number ${scoreTarget} in the text. Example: "Help me get my score above ${scoreTarget}"
- Position 5: Goal-based path (INTENT_GOAL_BASED_PATH, redirect /dcp). ${user.financialGoal ? `User wants "${user.financialGoal}" -adapt the starter to reflect this goal` : 'Fallback: "What\'s the best path for my financial goal?"'}` :
user.segment === 'DCP_Ineligible' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: EMI reduction alternatives (INTENT_EMI_OPTIMISATION, redirect /credit-score). Example: "How can I get a lower EMI?"
- Position 3: Payment stress management (INTENT_EMI_STRESS, redirect /credit-score). Example: "Managing multiple payments is overwhelming"
- Position 4: Loan eligibility (INTENT_LOAN_ELIGIBILITY, redirect /credit-score). Example: "My loan applications keep getting rejected"
- Position 5: Goal-based path (INTENT_GOAL_BASED_PATH, redirect /goal-tracker). ${user.financialGoal ? `User wants "${user.financialGoal}" -adapt the starter to reflect this goal` : 'Fallback: "What\'s the best path for my financial goal?"'}` : `- Positions 1-3: Credit and credit score related. Focus on understanding, improving, or diagnosing their credit health. Examples of good angles: "What's pulling my credit score down?", "How can I improve my credit score faster?", "Is my credit utilization hurting me?"
- Positions 4-5: Specific to the user's segment and situation. Financial goals, account management.`}

TONE AND STYLE:
1. All starters must be in first-person user voice (as if the user is asking)
2. Make them feel warm, inviting, and curiosity-driven -- the user should WANT to click them
3. NEVER include specific numbers, amounts, percentages in the text EXCEPT for score targets (Position 4 must include ${scoreTarget})
4. NEVER mention specific lender names in the text
5. NEVER use em dashes (the character \u2014). Use hyphens (-) or commas instead
5. Instead of data, use relatable language: "my credit score", "my overdue accounts", "my EMIs"
6. Avoid starts like "Tell me about", "What is", "Show me" -- prefer curiosity-driven questions like "What's really affecting my score?", "Could I be saving on my EMIs?", "Is there a smarter way to handle my dues?"
7. Keep each starter between 30 and 80 characters
8. Each must map to one of these intentTags: ${[...VALID_INTENT_TAGS].join(', ')}
9. Each must map to one of these redirectTo routes: ${[...VALID_REDIRECTS].join(', ')}

Return JSON with this exact structure:
{
  "starters": [
    { "text": "...", "intentTag": "...", "redirectTo": "..." }
  ]
}`;
}

/**
 * Core generation logic -called internally, returns starters or null on failure.
 * No timeout here -callers handle timeout/fallback.
 */
async function generateStartersFromAPI(
  user: User,
  advisorContext: AdvisorContext
): Promise<ConversationStarter[] | null> {
  const prompt = buildStarterPrompt(user, advisorContext);

  const result = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.7,
  });

  const content = result.choices[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content);
  const starters: ConversationStarter[] = (parsed.starters || [])
    .slice(0, 5)
    .filter((s: any) =>
      s.text && typeof s.text === 'string' &&
      s.intentTag && VALID_INTENT_TAGS.has(s.intentTag) &&
      s.redirectTo && VALID_REDIRECTS.has(s.redirectTo)
    )
    .map((s: any) => ({
      text: s.text.slice(0, 120),
      intentTag: s.intentTag,
      redirectTo: s.redirectTo,
    }));

  return starters.length >= 3 ? starters : null;
}

/**
 * Fire-and-forget: start generating starters in the background.
 * Call this as early as possible (e.g. when user is first identified).
 * Results are cached -later calls to generateDynamicStarters() will hit the cache.
 */
export function prewarmStarters(user: User, advisorContext: AdvisorContext): void {
  // Already cached or already in-flight -skip
  if (getCachedStarters(user.leadRefId) || inflightGenerations.has(user.leadRefId)) {
    return;
  }
  if (!process.env.OPENAI_API_KEY) return;

  const promise = generateStartersFromAPI(user, advisorContext)
    .then(starters => {
      if (starters) {
        starterCache.set(user.leadRefId, { starters, timestamp: Date.now() });
        console.log(`[Starters] Pre-warmed ${starters.length} dynamic starters for ${user.firstName}`);
      }
      return starters || resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
    })
    .catch((err: any) => {
      console.warn('[Starters] Prewarm failed:', err?.message);
      return resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
    })
    .finally(() => {
      inflightGenerations.delete(user.leadRefId);
    });

  inflightGenerations.set(user.leadRefId, promise);
}

/**
 * Generate personalized conversation starters.
 * If prewarm was called earlier, this resolves instantly from cache.
 * Otherwise generates with a 6s timeout and falls back to static.
 */
export async function generateDynamicStarters(
  user: User,
  advisorContext: AdvisorContext
): Promise<ConversationStarter[]> {
  // Check cache first
  const cached = getCachedStarters(user.leadRefId);
  if (cached) return cached;

  // If there's an in-flight generation (from prewarm), wait for it with a timeout
  const inflight = inflightGenerations.get(user.leadRefId);
  if (inflight) {
    const result = await Promise.race([
      inflight,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
    ]);
    if (result) return result;
    // Timed out waiting for prewarm -fall back
    console.log('[Starters] Prewarm still pending -using static starters');
    return resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
  }

  // No cache, no inflight -generate now
  if (!process.env.OPENAI_API_KEY) {
    return resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
  }

  try {
    const result = await Promise.race([
      generateStartersFromAPI(user, advisorContext),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 6000)),
    ]);

    if (result) {
      starterCache.set(user.leadRefId, { starters: result, timestamp: Date.now() });
      console.log(`[Starters] Generated ${result.length} dynamic starters for ${user.firstName}`);
      return result;
    }

    console.log('[Starters] Timeout -falling back to static starters');
    return resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
  } catch (err: any) {
    console.warn('[Starters] Generation failed, using static:', err?.message);
    return resolveStarterScoreTargets(conversationStarters[user.segment] || [], user.creditScore);
  }
}

// ── Dynamic Welcome Message (template-based, no LLM) ───────────────────────

export function buildWelcomeMessage(user: User, ctx: AdvisorContext): string {
  const name = user.firstName;
  const score = ctx?.creditScore;
  const goalText = ctx?.financialGoal;
  const delinquent = ctx?.delinquentAccountCount ?? 0;
  const activeCount = ctx?.activeAccountCount ?? 0;

  // Vary the opening so it doesn't feel templated
  const greetings = [
    `Hey ${name}!`,
    `Hi ${name}!`,
    `Hello ${name}!`,
    `Welcome, ${name}!`,
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];

  // Build a contextual but conversational message
  if (goalText && delinquent > 0) {
    return `${greeting} I see your goal is ${goalText.toLowerCase()}. I can help you figure out the best steps to get there. Pick a topic below or ask me anything.`;
  }
  if (goalText) {
    return `${greeting} Your goal is ${goalText.toLowerCase()}, and I'm here to help you work toward it. Pick a topic below or just ask me anything.`;
  }
  if (delinquent > 0 && activeCount > 0) {
    return `${greeting} I've looked at your credit profile and have some ideas that could help. Pick a topic below or ask me anything.`;
  }
  if (score && activeCount > 0) {
    return `${greeting} I can help you understand what's going on with your credit and how to improve it. Pick a topic below or ask me anything.`;
  }
  return `${greeting} I'm here to help with your credit health. Pick a topic below or ask me anything about your score, accounts, or payments.`;
}

// ── Context-Aware Error Responses (template-based, no LLM) ──────────────────

export function buildErrorResponse(
  userName: string | null,
  advisorContext: AdvisorContext | undefined,
  errorType: '429' | '500'
): string {
  const name = userName || null;
  const ctx = advisorContext;

  // No user context -generic but warm
  if (!name || !ctx) {
    if (errorType === '429') {
      return "I need a moment to catch up -- please try again in a few seconds.";
    }
    return "I'm having a hiccup -- please try again shortly.";
  }

  const score = ctx.creditScore;
  const gap = ctx.scoreGapToTarget;
  const target = ctx.nextScoreTarget;
  const fact = ctx.relevantFacts[0] || null;

  if (errorType === '429') {
    if (score && gap && gap > 0 && target) {
      return `I need a moment to catch up, ${name}. While I reconnect -- your credit score is ${score}, which is ${gap} points from ${target}. Try again in a few seconds.`;
    }
    if (fact) {
      return `I need a moment, ${name}. Quick reminder while I reconnect: ${fact} Try again in a few seconds.`;
    }
    return `I need a moment to catch up, ${name}. Please try again in a few seconds.`;
  }

  // 500 error
  if (fact) {
    return `I'm having a hiccup, ${name}. Quick reminder while I fix this: ${fact} Please try again shortly.`;
  }
  return `I'm having a hiccup, ${name}. Please try again shortly.`;
}
