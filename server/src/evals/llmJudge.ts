/**
 * LLM-as-Judge Evals — Configurable criteria loaded from judge-criteria.json.
 *
 * Binary PASS/FAIL verdicts with evidence-backed reasons.
 * Criteria are fully configurable: add, edit, enable/disable from dashboard.
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { AdvisorContext, ChatResponse, Segment } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JudgeResult {
  criterion: string;
  passed: boolean;
  reason: string;
  source?: 'pre-check' | 'llm-judge';
}

export interface CriterionConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;        // quality | accuracy | format | custom
  appliesWhen: {
    segments: string[];    // ["*"] = all, or specific segment names
    intents: string[];     // ["*"] = all, or specific intent tags
    minTurn: number;       // minimum turn number (1 = first turn, 2 = multi-turn only)
  };
  prompt: string;          // system prompt for the LLM judge
  preCheck: string | null; // pre-check function name, or null for LLM-only
}

export interface JudgeCriteriaConfig {
  version: number;
  model: string;
  temperature: number;
  maxTokens: number;
  criteria: CriterionConfig[];
}

// For backward compat — union of all known criterion IDs
export type JudgeCriterion = string;

// ── Config Loading ──────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'judge-criteria.json');

let cachedConfig: JudgeCriteriaConfig | null = null;
let configMtime: number = 0;

export function loadCriteriaConfig(): JudgeCriteriaConfig {
  const stat = fs.statSync(CONFIG_PATH);
  if (cachedConfig && stat.mtimeMs === configMtime) return cachedConfig;

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  cachedConfig = JSON.parse(raw) as JudgeCriteriaConfig;
  configMtime = stat.mtimeMs;
  return cachedConfig;
}

export function saveCriteriaConfig(config: JudgeCriteriaConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  cachedConfig = config;
  configMtime = Date.now();
}

export function getCriteriaList(): CriterionConfig[] {
  return loadCriteriaConfig().criteria;
}

// ── Criteria Selection ───────────────────────────────────────────────────────

/** Determine which criteria apply for a given test case context */
export function selectCriteria(
  segment: Segment,
  intentTag?: string,
  turnCount?: number,
): CriterionConfig[] {
  const config = loadCriteriaConfig();
  const turn = turnCount ?? 1;

  return config.criteria.filter(c => {
    if (!c.enabled) return false;

    // Check minTurn
    if (turn < c.appliesWhen.minTurn) return false;

    // Check segment match
    const segMatch = c.appliesWhen.segments.includes('*') || c.appliesWhen.segments.includes(segment);
    if (!segMatch) return false;

    // Check intent match
    if (!c.appliesWhen.intents.includes('*')) {
      // Intent-specific criterion — only apply if intent matches
      if (!intentTag || !c.appliesWhen.intents.includes(intentTag)) return false;
    }

    return true;
  });
}

// ── Deterministic Pre-checks ─────────────────────────────────────────────────

function preCheckPersonalization(response: ChatResponse, ctx: AdvisorContext | null): JudgeResult | null {
  if (!ctx) return null;
  const text = response.reply;
  let signals = 0;

  const amountMatches = text.match(/₹\s?[\d,]+/g);
  if (amountMatches) signals += amountMatches.length;

  const pctMatches = text.match(/\d+(\.\d+)?%/g);
  if (pctMatches) signals += pctMatches.length;

  const boldMatches = text.match(/\*\*[^*]+\*\*/g);
  if (boldMatches) signals += Math.min(boldMatches.length, 3);

  if (ctx.userName && text.toLowerCase().includes(ctx.userName.toLowerCase())) signals += 1;

  if (signals >= 4) {
    return { criterion: 'personalization', passed: true, reason: `Pre-check PASS: ${signals} specific data points detected (amounts, percentages, names)`, source: 'pre-check' };
  }
  return null;
}

function preCheckActionability(response: ChatResponse): JudgeResult | null {
  const text = response.reply;
  let signals = 0;

  const actionVerbs = /\b(explore|check|visit|apply|start|begin|reach out|contact|call|sign up|try|consider|review|look into|take a look)\b/gi;
  const verbMatches = text.match(actionVerbs);
  if (verbMatches) signals += Math.min(verbMatches.length, 3);

  const numberedItems = text.match(/^\s*\d+\.\s/gm);
  if (numberedItems) signals += numberedItems.length;

  const actionHeadings = /\*\*(next steps?|what you can do|action|how to|getting started|here'?s what)/i;
  if (actionHeadings.test(text)) signals += 2;

  if (response.redirectUrl) signals += 1;
  if (response.followUps && response.followUps.length >= 2) signals += 1;

  if (signals >= 4) {
    return { criterion: 'actionability', passed: true, reason: `Pre-check PASS: ${signals} actionability signals (verbs, steps, CTAs)`, source: 'pre-check' };
  }
  return null;
}

function preCheckEmpathy(response: ChatResponse): JudgeResult | null {
  const text = response.reply;
  const empathyKeywords = /\b(understand|tough|difficult|stress|challenging|overwhelming|worry|worries|concerned|sorry to hear|here for you|not alone|can be hard|natural to feel|completely understandable)\b/i;

  const empathyMatch = text.match(empathyKeywords);
  const amountMatch = text.match(/₹\s?[\d,]+/);

  if (empathyMatch) {
    const empathyPos = text.indexOf(empathyMatch[0]);
    const amountPos = amountMatch ? text.indexOf(amountMatch[0]) : text.length;
    if (empathyPos < amountPos && empathyPos < 200) {
      return { criterion: 'empathy', passed: true, reason: `Pre-check PASS: empathy keyword "${empathyMatch[0]}" found early in response (pos ${empathyPos})`, source: 'pre-check' };
    }
  }
  return null;
}

const PRE_CHECK_MAP: Record<string, (response: ChatResponse, ctx: AdvisorContext | null) => JudgeResult | null> = {
  personalization: preCheckPersonalization,
  actionability: (r) => preCheckActionability(r),
  empathy: (r) => preCheckEmpathy(r),
};

function runPreCheck(
  criterion: CriterionConfig,
  response: ChatResponse,
  advisorContext: AdvisorContext | null,
): JudgeResult | null {
  if (!criterion.preCheck) return null;
  const fn = PRE_CHECK_MAP[criterion.preCheck];
  if (!fn) return null;
  return fn(response, advisorContext);
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
  criterion: CriterionConfig,
  userMessage: string,
  response: ChatResponse,
  segment: Segment,
  advisorContext: AdvisorContext | null,
  intentTag?: string,
  priorHistory?: string,
): Promise<JudgeResult> {
  const config = loadCriteriaConfig();
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
    'First, quote the specific text from the bot response that informs your verdict (1-2 short quotes).',
    'Then answer exactly: PASS or FAIL followed by a brief reason (one line).',
  ].filter(Boolean).join('\n');

  try {
    const completion = await getClient().chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: criterion.prompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';

    // The judge uses chain-of-thought: quotes evidence first, then verdict.
    // Prefer "Verdict: PASS/FAIL" pattern, fall back to standalone PASS/FAIL.
    const verdictLine = text.match(/Verdict:\s*(PASS|FAIL)/i);
    const standalone = text.match(/^(PASS|FAIL)\b/im);
    const verdict = verdictLine?.[1] || standalone?.[1];
    const passed = verdict ? verdict.toUpperCase() === 'PASS' : false;
    const reason = text;

    return { criterion: criterion.id, passed, reason, source: 'llm-judge' };
  } catch (err) {
    return {
      criterion: criterion.id,
      passed: false,
      reason: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
      source: 'llm-judge',
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

  // Run deterministic pre-checks first, then LLM judge for remaining
  const results: JudgeResult[] = [];
  const needsLLM: CriterionConfig[] = [];

  for (const c of criteria) {
    const preResult = runPreCheck(c, response, advisorContext);
    if (preResult) {
      results.push(preResult);
    } else {
      needsLLM.push(c);
    }
  }

  // Run remaining judges in parallel
  if (needsLLM.length > 0) {
    const llmResults = await Promise.all(
      needsLLM.map(c => judgeSingle(c, userMessage, response, segment, advisorContext, intentTag, priorHistory))
    );
    results.push(...llmResults);
  }

  return results;
}
