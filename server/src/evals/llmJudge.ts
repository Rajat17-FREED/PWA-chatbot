/**
 * LLM-as-Judge Evals — Uses an LLM to evaluate subjective quality.
 *
 * Binary PASS/FAIL verdicts with one-line reasons.
 * Uses gpt-4o-mini for cost efficiency.
 */

import OpenAI from 'openai';
import { AdvisorContext, ChatResponse, Segment } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JudgeResult {
  criterion: string;
  passed: boolean;
  reason: string;
}

export type JudgeCriterion =
  | 'personalization'
  | 'empathy'
  | 'actionability'
  | 'coherence'
  | 'program_pitch';

// ── Judge Prompts ────────────────────────────────────────────────────────────

const JUDGE_PROMPTS: Record<JudgeCriterion, string> = {
  personalization: `You are evaluating whether a financial chatbot response is personalized to the user's specific situation.

CRITERIA:
- The response references at least 2 specific data points from the user's profile (e.g., actual credit score, specific lender names, specific amounts, number of accounts, FOIR percentage)
- The response feels tailored to THIS user, not a generic template that could apply to anyone

Answer PASS if the response references specific user data and feels personalized.
Answer FAIL if the response is generic or could apply to any user.`,

  empathy: `You are evaluating whether a financial chatbot response demonstrates appropriate empathy.

CRITERIA:
- For stress/harassment/delinquency intents: the response acknowledges the user's emotional state
- The tone is warm and supportive without being patronizing or dismissive
- The response does not jump straight into data/solutions without first acknowledging the human element

Answer PASS if the response shows appropriate empathy for the user's situation.
Answer FAIL if the response lacks emotional acknowledgment or feels cold/clinical.
Note: For purely informational queries (score improvement, profile analysis), empathy expectations are lower — a professional, helpful tone is sufficient.`,

  actionability: `You are evaluating whether a financial chatbot response gives clear, actionable next steps.

CRITERIA:
- The response tells the user what they can DO, not just what their situation IS
- There is at least one concrete next step the user can take
- Follow-up suggestions (if present) are specific enough to move the conversation forward
- The user should feel they know what to do after reading the response

Answer PASS if the response provides clear, actionable guidance.
Answer FAIL if the response only describes the situation without providing next steps.`,

  coherence: `You are evaluating whether a multi-turn chatbot response maintains coherence with the conversation.

CRITERIA:
- The response does NOT repeat information that was already covered in prior turns
- The response builds on what was discussed before
- The response acknowledges or relates to the prior conversation context
- There are no contradictions with earlier responses

If this is the first message in the conversation, PASS by default (coherence is only meaningful in multi-turn).

Answer PASS if the response maintains conversational coherence.
Answer FAIL if the response repeats prior information or ignores conversation context.`,

  program_pitch: `You are evaluating whether a financial chatbot introduces a FREED program appropriately.

CRITERIA:
- If a program (DRP, DCP, DEP) is mentioned, it is positioned as a solution to the user's stated problem
- The program is introduced naturally within the conversation flow, not as a hard sell
- The user's actual financial situation justifies the program recommendation
- The pitch does not feel pushy or premature

If no program is mentioned in the response, PASS by default.

Answer PASS if the program introduction (if any) feels natural and justified.
Answer FAIL if the program pitch feels forced, pushy, or unjustified.`,
};

// ── Criteria Selection ───────────────────────────────────────────────────────

/** Determine which judge criteria are relevant for this test case */
export function selectCriteria(
  segment: Segment,
  intentTag?: string,
  turnCount?: number,
): JudgeCriterion[] {
  const criteria: JudgeCriterion[] = ['personalization', 'actionability'];

  // Empathy is most important for stress/harassment intents
  const empathyIntents = [
    'INTENT_DELINQUENCY_STRESS',
    'INTENT_HARASSMENT',
    'INTENT_EMI_STRESS',
  ];
  if (intentTag && empathyIntents.includes(intentTag)) {
    criteria.push('empathy');
  }

  // Coherence only matters for multi-turn
  if (turnCount && turnCount > 1) {
    criteria.push('coherence');
  }

  // Program pitch for eligible segments
  const programSegments: Segment[] = ['DRP_Eligible', 'DCP_Eligible', 'DEP'];
  if (programSegments.includes(segment)) {
    criteria.push('program_pitch');
  }

  return criteria;
}

// ── Judge Execution ──────────────────────────────────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

function buildAdvisorSummary(ctx: AdvisorContext | null): string {
  if (!ctx) return '(no advisor context available)';

  const parts: string[] = [];
  if (ctx.userName) parts.push(`Name: ${ctx.userName}`);
  if (ctx.segment) parts.push(`Segment: ${ctx.segment}`);
  if (ctx.creditScore !== null) parts.push(`Credit Score: ${ctx.creditScore}`);
  if (ctx.activeAccountCount > 0) parts.push(`Active Accounts: ${ctx.activeAccountCount}`);
  if (ctx.delinquentAccountCount > 0) parts.push(`Delinquent: ${ctx.delinquentAccountCount}`);
  if (ctx.totalOutstanding > 0) parts.push(`Total Outstanding: ₹${Math.round(ctx.totalOutstanding).toLocaleString('en-IN')}`);
  if (ctx.monthlyIncome) parts.push(`Monthly Income: ₹${Math.round(ctx.monthlyIncome).toLocaleString('en-IN')}`);
  if (ctx.foirPercentage) parts.push(`FOIR: ${ctx.foirPercentage}%`);
  if (ctx.financialGoal) parts.push(`Goal: ${ctx.financialGoal}`);
  if (ctx.dominantAccounts.length > 0) {
    const top = ctx.dominantAccounts.slice(0, 3).map(a =>
      `${a.lenderName} (${a.debtType}, ₹${Math.round(a.outstandingAmount ?? 0).toLocaleString('en-IN')})`
    ).join(', ');
    parts.push(`Top Accounts: ${top}`);
  }

  return parts.join(' | ');
}

export async function judgeSingle(
  criterion: JudgeCriterion,
  userMessage: string,
  response: ChatResponse,
  segment: Segment,
  advisorContext: AdvisorContext | null,
  intentTag?: string,
  priorHistory?: string,
): Promise<JudgeResult> {
  const systemPrompt = JUDGE_PROMPTS[criterion];
  const advisorSummary = buildAdvisorSummary(advisorContext);

  const userPrompt = [
    `SEGMENT: ${segment}`,
    intentTag ? `INTENT: ${intentTag}` : null,
    `USER CONTEXT: ${advisorSummary}`,
    priorHistory ? `PRIOR CONVERSATION:\n${priorHistory}` : null,
    `USER MESSAGE: "${userMessage}"`,
    `BOT RESPONSE:\n${response.reply}`,
    response.followUps ? `FOLLOW-UPS: ${response.followUps.join(' | ')}` : null,
    response.redirectUrl ? `REDIRECT: ${response.redirectUrl}` : null,
    '',
    'Answer exactly: PASS or FAIL followed by a brief reason (one line).',
  ].filter(Boolean).join('\n');

  try {
    const completion = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 150,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';
    const passed = text.toUpperCase().startsWith('PASS');
    const reason = text.replace(/^(PASS|FAIL)[:\s-]*/i, '').trim() || text;

    return { criterion, passed, reason };
  } catch (err) {
    return {
      criterion,
      passed: false,
      reason: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function judgeResponse(
  userMessage: string,
  response: ChatResponse,
  segment: Segment,
  advisorContext: AdvisorContext | null,
  intentTag?: string,
  priorHistory?: string,
  turnCount?: number,
): Promise<JudgeResult[]> {
  const criteria = selectCriteria(segment, intentTag, turnCount);

  // Run all judges in parallel for speed
  const results = await Promise.all(
    criteria.map(c => judgeSingle(c, userMessage, response, segment, advisorContext, intentTag, priorHistory))
  );

  return results;
}
