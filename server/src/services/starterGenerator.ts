/**
 * Dynamic Starter Generator — generates personalized conversation starters,
 * welcome messages, and context-aware error responses.
 */

import OpenAI from 'openai';
import { AdvisorContext, ConversationStarter, User, Segment } from '../types';
import { conversationStarters } from '../prompts/segments';

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

// In-flight promises for deduplication — prevents duplicate API calls
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
]);

const VALID_REDIRECTS = new Set([
  '/dep', '/drp', '/dcp', '/credit-score', '/goal-tracker', '/freed-shield', '/dispute', '/',
]);

// ── Dynamic Starter Generation ──────────────────────────────────────────────

function segmentContext(segment: string): string {
  switch (segment) {
    case 'DRP_Eligible':
      return 'User has significant overdue accounts and may benefit from a debt resolution program (settlement/negotiation).';
    case 'DCP_Eligible':
      return 'User has high EMI burden across multiple lenders and may benefit from debt consolidation into a single payment.';
    case 'DEP':
      return 'User is managing repayments well (FOIR < 50%). Five conversation flows: (1) credit score improvement, (2) interest/debt reduction via DEP, (3) goal-based loan readiness, (4) credit score target path, (5) full financial profile analysis. Focus on optimization over rescue.';
    default:
      return 'User is focused on general credit health and financial wellness.';
  }
}

function buildStarterPrompt(user: User, ctx: AdvisorContext): string {
  const topRisks = ctx.topRisks.slice(0, 3).map(r => r.detail).join('; ');
  const topOpps = ctx.topOpportunities.slice(0, 2).map(o => o.detail).join('; ');

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
${user.segment === 'DEP' ? `- Position 1: Credit score improvement (INTENT_SCORE_IMPROVEMENT, redirect /goal-tracker). Example: "How can I improve my credit score?"
- Position 2: Interest/debt reduction (INTENT_INTEREST_OPTIMISATION, redirect /dep). Example: "Am I paying too much interest on my loans?"
- Position 3: Score target (INTENT_CREDIT_SCORE_TARGET, redirect /goal-tracker). Adapt based on score range: if score < 750 say "How do I get my score above 750?", if >= 750 say "How do I push my score above 800?"
- Position 4: Goal-based loan readiness (INTENT_GOAL_BASED_LOAN, redirect /credit-score). ${user.financialGoal ? `User wants "${user.financialGoal}" — say something like "I want to get the best rate on a ${user.financialGoal}"` : 'Fallback: "I want to get the best rate on my next loan"'}
- Position 5: Profile overview (INTENT_PROFILE_ANALYSIS, redirect /credit-score). Example: "What does my financial profile look like?"` : `- Positions 1-3: Credit and credit score related. Focus on understanding, improving, or diagnosing their credit health. Examples of good angles: "What's pulling my credit score down?", "How can I improve my credit score faster?", "Is my credit utilization hurting me?"
- Positions 4-5: Specific to the user's segment and situation. For DRP_Eligible: debt resolution, settlement options, dealing with overdue stress. For DCP_Eligible: EMI management, consolidation benefits. For others: financial goals, account management.`}

TONE AND STYLE:
1. All starters must be in first-person user voice (as if the user is asking)
2. Make them feel warm, inviting, and curiosity-driven -- the user should WANT to click them
3. NEVER include specific numbers, amounts, percentages, or scores in the text
4. NEVER mention specific lender names in the text
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
 * Core generation logic — called internally, returns starters or null on failure.
 * No timeout here — callers handle timeout/fallback.
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
 * Results are cached — later calls to generateDynamicStarters() will hit the cache.
 */
export function prewarmStarters(user: User, advisorContext: AdvisorContext): void {
  // Already cached or already in-flight — skip
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
      return starters || conversationStarters[user.segment] || [];
    })
    .catch((err: any) => {
      console.warn('[Starters] Prewarm failed:', err?.message);
      return conversationStarters[user.segment] || [];
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
    // Timed out waiting for prewarm — fall back
    console.log('[Starters] Prewarm still pending — using static starters');
    return conversationStarters[user.segment] || [];
  }

  // No cache, no inflight — generate now
  if (!process.env.OPENAI_API_KEY) {
    return conversationStarters[user.segment] || [];
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

    console.log('[Starters] Timeout — falling back to static starters');
    return conversationStarters[user.segment] || [];
  } catch (err: any) {
    console.warn('[Starters] Generation failed, using static:', err?.message);
    return conversationStarters[user.segment] || [];
  }
}

// ── Dynamic Welcome Message (template-based, no LLM) ───────────────────────

export function buildWelcomeMessage(user: User, ctx: AdvisorContext): string {
  const name = user.firstName;

  return `Hi ${name}, welcome! I've got your profile ready. Pick a topic below or ask me anything.`;
}

// ── Context-Aware Error Responses (template-based, no LLM) ──────────────────

export function buildErrorResponse(
  userName: string | null,
  advisorContext: AdvisorContext | undefined,
  errorType: '429' | '500'
): string {
  const name = userName || null;
  const ctx = advisorContext;

  // No user context — generic but warm
  if (!name || !ctx) {
    if (errorType === '429') {
      return "I need a moment to catch up -- please try again in a few seconds.";
    }
    return "I'm having a hiccup -- please try again shortly.";
  }

  const score = ctx.creditScore;
  const gap = ctx.scoreGapTo750;
  const fact = ctx.relevantFacts[0] || null;

  if (errorType === '429') {
    if (score && gap && gap > 0) {
      return `I need a moment to catch up, ${name}. While I reconnect -- your credit score is ${score}, which is ${gap} points from 750. Try again in a few seconds.`;
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
