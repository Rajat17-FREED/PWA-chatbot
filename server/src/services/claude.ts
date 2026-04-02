import OpenAI from 'openai';
import {
  AdvisorContext,
  ChatMessage,
  ChatResponse,
  ResponseGroundingContext,
  StructuredAssistantTurn,
  StructuredFormatMode,
  StructuredRedirect,
  StructuredSection,
  StructuredSectionStyle,
} from '../types';
import {
  ALLOWED_REDIRECT_ROUTES,
  FOLLOW_UP_REPAIR_SCHEMA,
  STRUCTURED_TURN_SCHEMA,
  buildFollowUpRepairPrompt,
  buildStructuredTurnRepairPrompt,
  buildStructuredTurnSystemPrompt,
} from '../prompts/structured';
import { getCurrentUserTurnCount, getLastUserIntentTag } from './conversationContext';

let client: OpenAI | null = null;
const MAX_FOLLOW_UPS = 3;
const REPAIR_BUDGET_MS = 1500;
const ALLOWED_REDIRECT_ROUTE_SET = new Set<string>([...ALLOWED_REDIRECT_ROUTES]);
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
const FORMAT_KEYWORDS = {
  plain: /^(hi|hello|hey|thanks|thank you|ok|okay|alright|sure|yes|no|got it|understood|sounds good)\b/i,
  analysis: /\b(score|overall|improve|eligib|approval|interest rate|loan rate|emi burden|monthly burden|compare|all accounts|full profile|consolidat|reduce debt|plan|portfolio|summary)\b/i,
  guided: /\b(card|credit card|utilization|limit|emi|payment|overdue|dpd|missed|lender|loan|account|balance|amount|delay|score points)\b/i,
};
const EMPATHY_OPENING_PATTERN = /\b(stressful|overwhelming|difficult|challenging|not alone|here to help|let's address this together|i understand|can be incredibly stressful)\b/i;
const PROFILE_SNAPSHOT_PATTERN = /\b(credit score|active accounts?|total outstanding|monthly debt|foir|accounts with missed payments|you have \d+\s+(?:active\s+)?accounts?)\b/i;
const HARASSMENT_OVERVIEW_PATTERN = /\b(you are not alone in this|when it crosses the line|non-stop calls|threatening language|family members|neighbors|colleagues|workplace without warning|assets will be seized)\b/i;
const SHIELD_PATTERN = /\bfreed shield\b/i;

interface StructuredChatRequest {
  history: ChatMessage[];
  userMessage: string;
  messageCount?: number;
  knowledgeBase?: string;
  advisorContext?: AdvisorContext;
  grounding?: ResponseGroundingContext;
  userName?: string | null;
  segment?: string | null;
  intentTag?: string;
}

interface TurnValidation {
  bodyIssues: string[];
  followUpIssues: string[];
}

interface StructuredModelPayload {
  user_message: string;
  expected_format_mode: StructuredFormatMode;
  message_count: number;
  user_name: string | null;
  segment: string | null;
  intent_tag?: string;
  recent_history: Array<{ role: 'user' | 'assistant'; content: string }>;
  topics_already_covered: string[];
  prior_section_headings: string[];
  prior_follow_ups: string[];
  topics_not_yet_explored: string[];
  conversation_state: ConversationState;
  advisor_context: AdvisorContext | null;
  grounding_context: ResponseGroundingContext | null;
  knowledge_snippets: string;
  allowed_redirect_routes: string[];
}

interface ConversationState {
  current_user_turn: number;
  is_follow_up: boolean;
  active_intent_tag: string | null;
  last_user_intent_tag: string | null;
  empathy_already_expressed: boolean;
  profile_snapshot_already_given: boolean;
  harassment_overview_already_given: boolean;
  shield_already_introduced: boolean;
  named_lenders_in_user_message: boolean;
  last_assistant_focus: 'none' | 'profile_snapshot' | 'harassment_overview' | 'shield_actions' | 'solution_recommendation' | 'direct_answer';
  continuation_directive: string;
}

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/[\u2013\u2014]/g, ',')
    .replace(/\s*--\s*/g, ', ')
    .replace(/--/g, ',');
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function sentenceCount(text: string): number {
  return normalizeSpace(text)
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean).length;
}

function stripNextStepsBlock(reply: string): string {
  return reply.replace(/\n?\s*NEXT STEPS YOU CAN EXPLORE[\s\S]*$/i, '').trim();
}

function shortenText(text: string, maxLen: number): string {
  const trimmed = normalizeSpace(stripEmDashes(text));
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 3).trimEnd()}...` : trimmed;
}

function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function parseINR(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function nearestValue(target: number, values: number[]): number | null {
  if (values.length === 0) return null;
  let nearest = values[0];
  let diff = Math.abs(target - nearest);
  for (const value of values.slice(1)) {
    const currentDiff = Math.abs(target - value);
    if (currentDiff < diff) {
      nearest = value;
      diff = currentDiff;
    }
  }
  return nearest;
}

function normalizeDebtType(debtType: string): string {
  return debtType.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalDebtTypeLabel(debtType: string): string {
  const normalized = normalizeDebtType(debtType);
  if (normalized.includes('credit card') || normalized.includes('card')) return 'credit card';
  if (normalized.includes('business loan')) return 'business loan';
  if (normalized.includes('personal loan')) return 'personal loan';
  if (normalized.includes('vehicle loan') || normalized.includes('car loan') || normalized.includes('auto loan')) return 'vehicle loan';
  if (normalized.includes('home loan') || normalized.includes('housing loan') || normalized.includes('mortgage')) return 'home loan';
  if (normalized.includes('consumer loan')) return 'consumer loan';
  if (normalized.includes('loan')) return 'loan';
  return normalized || 'account';
}

function lenderAliases(lender: string): string[] {
  const base = lender.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return [];

  const aliases: string[] = [];
  const push = (value: string) => {
    const candidate = value.replace(/\s+/g, ' ').trim();
    if (!candidate) return;
    if (!aliases.some(item => item.toLowerCase() === candidate.toLowerCase())) {
      aliases.push(candidate);
    }
  };

  push(base);
  push(base.replace(/\b(?:ltd|limited)\b\.?/gi, '').replace(/\s+/g, ' ').trim());
  push(base.replace(/\b(?:private\s+limited|pvt\s+ltd|pvt|private)\b/gi, '').replace(/\s+/g, ' ').trim());

  const parts = base.split(' ');
  if (parts.length >= 2) push(parts.slice(0, 2).join(' '));
  if (parts.length >= 3) push(parts.slice(0, 3).join(' '));
  if (parts[0]) push(parts[0]);

  return aliases.sort((a, b) => b.length - a.length);
}

function lenderKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(?:ltd|limited|private|pvt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericNonLenderPhrase(value: string): boolean {
  const normalized = lenderKey(value);
  if (!normalized) return true;
  const genericPatterns = [
    /^credit cards?$/,
    /^credit card accounts?$/,
    /^credit card companies$/,
    /^loan accounts?$/,
    /^business loans?$/,
    /^personal loans?$/,
    /^secured loans?$/,
    /^unsecured loans?$/,
    /^consumer loans?$/,
    /^home loans?$/,
    /^housing loans?$/,
    /^vehicle loans?$/,
    /^auto loans?$/,
    /^financial services?$/,
    /^financial institutions?$/,
    /^credit institutions?$/,
    /^credit bureau$/,
    /^credit reports?$/,
    /^credit agencies$/,
    /^interest rates?$/,
    /^loan eligibility$/,
    /^credit worthiness$/,
    /^credit history$/,
    /^credit score$/,
    /^credit profiles?$/,
    /^payment history$/,
    /^credit utilization$/,
    /^credit health$/,
    /^credit monitoring$/,
    /^debt consolidation$/,
    /^debt resolution$/,
    /^debt elimination$/,
    /^recovery agents?$/,
    /^collection agents?$/,
    /^reserve bank$/,
    /^rbi$/,
  ];
  return genericPatterns.some(pattern => pattern.test(normalized));
}

function buildAllowedLenderAliasSet(grounding: ResponseGroundingContext): Set<string> {
  const aliases = new Set<string>();
  for (const lender of grounding.allowedLenders) {
    aliases.add(lenderKey(lender));
    for (const alias of lenderAliases(lender)) {
      aliases.add(lenderKey(alias));
    }
  }
  return aliases;
}

/**
 * Check if a lender mention is "known" -either exact alias match or
 * fuzzy match (the mention's key contains or is contained by an alias key).
 */
function isKnownLender(mention: string, allowedAliases: Set<string>): boolean {
  const key = lenderKey(mention);
  if (!key) return true;
  if (allowedAliases.has(key)) return true;
  // Fuzzy: check if mention contains any alias or vice versa
  for (const alias of allowedAliases) {
    if (alias.length >= 3 && (key.includes(alias) || alias.includes(key))) return true;
  }
  return false;
}

function isFactualClaimLine(line: string): boolean {
  return /₹|%|\b(score|loan|card|utilization|overdue|late|dpd|interest|payment|outstanding|account|limit|balance|debt|delay)\b/i.test(line);
}

function stripUnknownLenderClaims(reply: string, grounding: ResponseGroundingContext): string {
  const allowedAliases = buildAllowedLenderAliasSet(grounding);
  const lines = reply.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }

    const matches = [...line.matchAll(LENDER_MENTION_PATTERN)].map(match => match[1]);
    if (matches.length === 0) {
      kept.push(line);
      continue;
    }

    const unknownMentions = matches.filter(name => {
      if (isGenericNonLenderPhrase(name)) return false;
      return !isKnownLender(name, allowedAliases);
    });

    // Only strip if ALL lender mentions on this line are unknown AND it's a factual claim
    // If at least one mention is known, the line is likely valid
    if (unknownMentions.length > 0 && unknownMentions.length === matches.length && isFactualClaimLine(line)) {
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeAmountsNearLenders(reply: string, grounding: ResponseGroundingContext): string {
  let corrected = reply;

  for (const [lender, facts] of Object.entries(grounding.lenderFacts || {})) {
    const validAmounts = [
      ...(facts.outstandingAmounts || []),
      ...(facts.overdueAmounts || []),
      ...(facts.creditLimits || []),
    ]
      .map(value => Math.round(value))
      .filter(value => value > 0);

    if (validAmounts.length === 0) continue;

    for (const alias of lenderAliases(lender)) {
      const nearContextPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,170})`, 'gi');
      corrected = corrected.replace(nearContextPattern, (segment: string) => {
        const amountTokens = segment.match(/₹\s?[\d,]+/g);
        if (!amountTokens || amountTokens.length === 0) return segment;

        let updated = segment;
        for (const token of amountTokens) {
          const parsed = parseINR(token);
          if (parsed === null || validAmounts.includes(parsed)) continue;
          const replacement = nearestValue(parsed, validAmounts);
          if (replacement === null) continue;
          updated = updated.replace(token, formatINR(replacement));
        }
        return updated;
      });
    }
  }

  return corrected;
}

function normalizeUtilizationNearLenders(reply: string, grounding: ResponseGroundingContext): string {
  let corrected = reply;

  for (const [lender, facts] of Object.entries(grounding.lenderFacts || {})) {
    const limits = (facts.creditLimits || []).filter(value => value > 0);
    const outstanding = (facts.outstandingAmounts || []).filter(value => value >= 0);
    if (limits.length === 0 || outstanding.length === 0) continue;

    const validPercents = new Set<number>();
    for (const amount of outstanding) {
      for (const limit of limits) {
        if (limit <= 0) continue;
        validPercents.add(Math.round((amount / limit) * 100));
      }
    }

    const percentValues = [...validPercents].filter(value => value >= 0 && value <= 500);
    if (percentValues.length === 0) continue;

    for (const alias of lenderAliases(lender)) {
      const nearContextPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,170})`, 'gi');
      corrected = corrected.replace(nearContextPattern, (segment: string) => {
        if (!/\b(limit|utilization|used|usage|maxed|maxed out)\b/i.test(segment)) return segment;
        const percentTokens = segment.match(/\b\d{1,3}%\b/g);
        if (!percentTokens || percentTokens.length === 0) return segment;

        let updated = segment;
        for (const token of percentTokens) {
          const parsed = Number(token.replace('%', ''));
          if (!Number.isFinite(parsed) || percentValues.includes(parsed)) continue;
          const replacement = nearestValue(parsed, percentValues);
          if (replacement === null) continue;
          updated = updated.replace(token, `${replacement}%`);
        }
        return updated;
      });
    }
  }

  return corrected;
}

function normalizeCardAccountMentions(reply: string, grounding: ResponseGroundingContext): string {
  let corrected = reply;

  for (const [lender, facts] of Object.entries(grounding.lenderFacts || {})) {
    const debtTypes = (facts.debtTypes || []).map(type => canonicalDebtTypeLabel(type));
    if (!debtTypes.includes('credit card')) continue;

    for (const alias of lenderAliases(lender)) {
      const nearContextPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,170})`, 'gi');
      corrected = corrected.replace(nearContextPattern, (segment: string) => {
        if (/\bcredit\s+card\b/i.test(segment)) return segment;

        const hasAccountWord = /\baccounts?\b/i.test(segment);
        const hasCardSignal =
          /\b(limit|utilization|usage|used|maxed|maxed out|overdue|dpd|delay|payment)\b/i.test(segment) ||
          /\b\d{1,3}%\b/.test(segment);

        if (!hasCardSignal) return segment;

        if (hasAccountWord) {
          return segment.replace(/\baccounts\b/gi, 'credit cards').replace(/\baccount\b/gi, 'credit card');
        }

        return segment.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'), match => `${match} credit card`);
      });
    }
  }

  return corrected;
}

function enforceKnownCreditScore(reply: string, grounding: ResponseGroundingContext): string {
  if (grounding.creditScore === null || grounding.creditScore === undefined) return reply;
  const score = Math.round(grounding.creditScore);
  return reply.replace(/(credit score(?:\s*(?:is|of|at|stands at|currently|around|near))?\s*)(\d{3})/gi, (_match, prefix: string, value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed === score ? `${prefix}${value}` : `${prefix}${score}`;
  });
}

function bestReplacementType(allowed: Set<string>, preferred: string): string {
  if (allowed.has('credit card')) return 'credit card';
  if (preferred && preferred !== 'account') return preferred;
  if (allowed.has('loan')) return 'loan';
  return 'account';
}

function replaceForbiddenTypesInSegment(segment: string, allowed: Set<string>, preferred: string): string {
  let output = segment;
  const replacement = bestReplacementType(allowed, preferred);
  const replacementIsCard = replacement === 'credit card';

  const mappings: Array<{ type: string; regex: RegExp }> = [
    { type: 'business loan', regex: /\bbusiness loans?\b/gi },
    { type: 'personal loan', regex: /\bpersonal loans?\b/gi },
    { type: 'consumer loan', regex: /\bconsumer loans?\b/gi },
    { type: 'vehicle loan', regex: /\b(?:vehicle|car|auto) loans?\b/gi },
    { type: 'home loan', regex: /\b(?:home|housing|mortgage) loans?\b/gi },
    { type: 'credit card', regex: /\bcredit cards?\b/gi },
  ];

  for (const mapping of mappings) {
    if (allowed.has(mapping.type)) continue;
    output = output.replace(mapping.regex, replacement);
  }

  if (replacementIsCard && !allowed.has('loan')) {
    output = output.replace(/\bloan accounts?\b/gi, 'credit card');
    output = output.replace(/\bloans?\b/gi, 'credit card');
  }

  return output;
}

function applyGroundingCorrections(reply: string, grounding?: ResponseGroundingContext): string {
  if (!grounding) return reply;

  const allowedTypeSet = new Set(grounding.allowedDebtTypes.map(type => normalizeDebtType(type)));
  let corrected = reply;

  if (!allowedTypeSet.has('business loan')) {
    corrected = corrected.replace(/\bbusiness loans?\b/gi, match => (/loans\b/i.test(match) ? 'loan accounts' : 'loan account'));
  }

  for (const [lender, debtTypes] of Object.entries(grounding.lenderDebtTypes)) {
    if (!debtTypes || debtTypes.length === 0) continue;
    const allowed = new Set(debtTypes.map(type => canonicalDebtTypeLabel(type)));
    const preferred = canonicalDebtTypeLabel(debtTypes[0]);
    for (const alias of lenderAliases(lender)) {
      const nearContextPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,140})`, 'gi');
      corrected = corrected.replace(nearContextPattern, (segment: string) => replaceForbiddenTypesInSegment(segment, allowed, preferred));
    }
  }

  for (const lender of grounding.likelyCardLenders) {
    for (const alias of lenderAliases(lender)) {
      const cardGuardPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,140})`, 'gi');
      corrected = corrected.replace(cardGuardPattern, (segment: string) =>
        segment
          .replace(/\bbusiness loans?\b/gi, 'credit card')
          .replace(/\bloan accounts?\b/gi, 'credit card')
      );
    }
  }

  corrected = normalizeAmountsNearLenders(corrected, grounding);
  corrected = correctLenderAmountMismatches(corrected, grounding);
  corrected = normalizeUtilizationNearLenders(corrected, grounding);
  corrected = normalizeCardAccountMentions(corrected, grounding);
  corrected = enforceKnownCreditScore(corrected, grounding);
  corrected = stripUnknownLenderClaims(corrected, grounding);
  corrected = fixSettlementSameAmount(corrected);
  corrected = fixSettlementSavings(corrected);

  return corrected;
}

function meaningfulTokens(text: string): string[] {
  const canonicalizeToken = (token: string): string => {
    if (/^approv/.test(token)) return 'approval';
    if (/^improv/.test(token)) return 'improve';
    if (/^score/.test(token)) return 'score';
    if (/^interest/.test(token)) return 'interest';
    if (/^rate/.test(token)) return 'rate';
    if (/^(compare|compar|vers|both)$/.test(token)) return 'compare';
    if (/^(delay|late|dpd|overdue)/.test(token)) return 'delay';
    if (/^(util|usage|used|limit)/.test(token)) return 'usage';
    if (/^(reduc|lower)/.test(token)) return 'reduce';
    if (/^pay/.test(token)) return 'payment';
    if (/^card/.test(token)) return 'card';
    if (/^loan/.test(token)) return 'loan';
    if (/^hist/.test(token)) return 'history';
    if (/^eligib/.test(token)) return 'eligibility';
    if (token.length > 5) return token.replace(/(ing|edly|ed|es|s)$/i, '');
    return token;
  };

  const cleaned = stripNextStepsBlock(stripEmDashes(text))
    .toLowerCase()
    .replace(/[^a-z0-9₹% ]+/g, ' ');
  const stopwords = new Set([
    'the', 'is', 'are', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with',
    'my', 'your', 'our', 'their', 'this', 'that', 'it', 'be', 'as', 'at', 'by', 'from',
    'me', 'you', 'we', 'i', 'do', 'does', 'can', 'should', 'would', 'could', 'what',
    'which', 'how', 'why', 'when', 'where', 'if', 'then', 'just', 'right', 'now',
  ]);

  return cleaned
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 0)
    .filter(token => !stopwords.has(token) && (token.length > 2 || /[₹%0-9]/.test(token)))
    .map(canonicalizeToken);
}

function uniquePush(target: string[], value: string): void {
  const cleaned = value.trim();
  if (!cleaned) return;
  if (!target.some(item => item.toLowerCase() === cleaned.toLowerCase())) {
    target.push(cleaned);
  }
}

function cleanOption(option: string): string {
  return normalizeSpace(
    stripEmDashes(option)
      .replace(/^[^a-zA-Z0-9₹%]+/, '')
      .replace(/[.?!]+$/g, '')
      .replace(/^(?:or|and)\s+/i, '')
      .replace(/^(?:just|simply|primarily|mainly)\s+/i, '')
      .replace(/^(?:planning|aiming|trying)\s+to\s+/i, '')
  );
}

function extractQuestionOptions(question: string | null): string[] {
  if (!question) return [];

  const original = normalizeSpace(stripEmDashes(question)).replace(/\?+$/, '');
  let working = original;
  if (!/\bor\b|,|\/|;| and\/or /i.test(working)) return [];

  let delimiterIndex = -1;
  let delimiterLength = 1;
  const colonIndex = working.lastIndexOf(':');
  if (colonIndex > delimiterIndex) {
    delimiterIndex = colonIndex;
    delimiterLength = 1;
  }
  const dashIndex = working.lastIndexOf(' - ');
  if (dashIndex > delimiterIndex) {
    delimiterIndex = dashIndex;
    delimiterLength = 3;
  }

  if (delimiterIndex >= 0 && delimiterIndex < working.length - delimiterLength) {
    working = working.slice(delimiterIndex + delimiterLength).trim();
  } else if (/^(what|which|who|when|where|why|how|are|is|do|does|did|can|could|would|should|will)\b/i.test(working)) {
    const commaIndex = working.indexOf(',');
    if (commaIndex >= 0 && commaIndex < working.length - 1) {
      working = working.slice(commaIndex + 1).trim();
    }
  }

  const parts = working
    .split(/\s*,\s*|\s+or\s+|\s+and\/or\s+|\/|;/i)
    .map(cleanOption)
    .filter(option => option.length >= 3);

  const options: string[] = [];
  for (const part of parts) {
    uniquePush(options, part);
  }

  if (options.length < 2 && /\s+or\s+/i.test(original)) {
    const rawParts = original.split(/\s+or\s+/i).map(part => cleanOption(part)).filter(Boolean);
    for (const part of rawParts.slice(-2)) {
      uniquePush(options, part);
    }
  }

  return options.slice(0, 3);
}

function normalizeTextValue(text: string, grounding?: ResponseGroundingContext): string {
  const cleaned = normalizeSpace(applyGroundingCorrections(stripMarkdownLinks(stripEmDashes(text)), grounding));
  return cleaned;
}

function normalizeTitle(text: string): string {
  return normalizeSpace(stripMarkdownLinks(stripEmDashes(text)).replace(/[.?!]+$/g, ''));
}

function normalizeFollowUp(text: string, grounding?: ResponseGroundingContext): string {
  const cleaned = normalizeTextValue(
    text
      .replace(/^\s*[-*]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/^['"]|['"]$/g, ''),
    grounding
  ).replace(/[.]+$/g, '');

  return shortenText(cleaned, 120);
}

function normalizeSectionStyle(style: string | undefined, mode: StructuredFormatMode): StructuredSectionStyle {
  if (style === 'paragraph' || style === 'bullet_list' || style === 'numbered_list') {
    return style;
  }

  if (mode === 'plain') return 'paragraph';
  if (mode === 'guided') return 'bullet_list';
  return 'bullet_list';
}

function sanitizeStructuredTurn(turn: StructuredAssistantTurn, grounding?: ResponseGroundingContext): StructuredAssistantTurn {
  const formatMode: StructuredFormatMode = turn.formatMode === 'plain' || turn.formatMode === 'guided' || turn.formatMode === 'analysis'
    ? turn.formatMode
    : 'guided';

  const opening = normalizeTextValue(turn.opening || '', grounding);
  const sections: StructuredSection[] = (turn.sections || [])
    .map(section => {
      const title = section.title ? normalizeTitle(section.title) : undefined;
      const style = normalizeSectionStyle(section.style, formatMode);
      const items = (section.items || [])
        .map(item => normalizeTextValue(item, grounding))
        .filter(item => item.length > 0);
      return { title, style, items };
    })
    .filter(section => section.items.length > 0);

  const followUps: string[] = [];
  for (const followUp of turn.followUps || []) {
    const normalized = normalizeFollowUp(followUp, grounding);
    if (!normalized) continue;
    uniquePush(followUps, normalized);
  }

  let redirect: StructuredRedirect | undefined;
  if (turn.redirect && ALLOWED_REDIRECT_ROUTE_SET.has(turn.redirect.url)) {
    const label = normalizeTextValue(turn.redirect.label || '', grounding);
    if (label) {
      redirect = {
        url: turn.redirect.url,
        label,
      };
    }
  }

  let redirectNudge: string | undefined;
  if (redirect && turn.redirectNudge) {
    redirectNudge = normalizeTextValue(turn.redirectNudge, grounding);
    if (!redirectNudge) redirectNudge = undefined;
  }

  return {
    formatMode,
    opening,
    sections,
    followUps,
    redirect,
    redirectNudge,
  };
}

function containsGenericFollowUp(text: string): boolean {
  return GENERIC_FOLLOW_UP_PATTERNS.some(pattern => pattern.test(text.trim()));
}

function optionCoverage(followUps: string[], options: string[]): { covered: number; hasCombined: boolean } {
  const optionSets = options.map(option => new Set(meaningfulTokens(option)));
  const covered = new Set<number>();
  let hasCombined = false;

  for (const followUp of followUps) {
    const followUpSet = new Set(meaningfulTokens(followUp));
    const matches: number[] = [];

    optionSets.forEach((optionSet, index) => {
      const overlap = [...followUpSet].filter(token => optionSet.has(token)).length;
      if (overlap > 0) {
        covered.add(index);
        matches.push(index);
      }
    });

    if (matches.length >= 2 || /\b(compare|both|difference|vs|versus)\b/i.test(followUp)) {
      hasCombined = true;
    }
  }

  return { covered: covered.size, hasCombined };
}

function buildAdvisorAnchorTokens(advisorContext?: AdvisorContext): Array<Set<string>> {
  if (!advisorContext) return [];
  const anchors: Array<Set<string>> = [];

  const addAnchor = (value: string) => {
    const tokens = meaningfulTokens(value);
    if (tokens.length === 0) return;
    anchors.push(new Set(tokens));
  };

  for (const fact of advisorContext.relevantFacts) addAnchor(fact);
  for (const risk of advisorContext.topRisks.slice(0, 4)) addAnchor(`${risk.label} ${risk.detail}`);
  for (const opportunity of advisorContext.topOpportunities.slice(0, 4)) addAnchor(`${opportunity.label} ${opportunity.detail}`);
  for (const account of advisorContext.relevantAccounts.slice(0, 4)) {
    addAnchor(`${account.lenderName} ${account.debtType} ${account.utilizationPercentage ?? ''} ${account.maxDPD ?? ''}`);
  }

  return anchors;
}

function matchesDistinctAnchors(followUps: string[], advisorContext?: AdvisorContext): boolean {
  const anchors = buildAdvisorAnchorTokens(advisorContext);
  if (anchors.length === 0) return false;

  const matchedAnchorIndexes = new Set<number>();
  for (const followUp of followUps) {
    const followUpTokens = new Set(meaningfulTokens(followUp));
    const index = anchors.findIndex(anchor => [...followUpTokens].some(token => anchor.has(token)));
    if (index >= 0) matchedAnchorIndexes.add(index);
  }

  return matchedAnchorIndexes.size >= Math.min(MAX_FOLLOW_UPS, anchors.length);
}

/**
 * Count lines with completely unknown lender claims (all mentions unknown).
 * A line where at least one lender is known is considered valid.
 */
function countUnknownLenderClaimLines(text: string, grounding?: ResponseGroundingContext): number {
  if (!grounding) return 0;
  const allowedAliases = buildAllowedLenderAliasSet(grounding);
  const lines = text.split('\n');
  let count = 0;

  for (const line of lines) {
    const matches = [...line.matchAll(LENDER_MENTION_PATTERN)].map(match => match[1]);
    if (matches.length === 0 || !isFactualClaimLine(line)) continue;

    const nonGeneric = matches.filter(name => !isGenericNonLenderPhrase(name));
    if (nonGeneric.length === 0) continue;

    // Only flag if ALL non-generic mentions on this line are unknown
    const allUnknown = nonGeneric.every(name => !isKnownLender(name, allowedAliases));
    if (allUnknown) count++;
  }

  return count;
}

function containsUnknownLenderClaim(text: string, grounding?: ResponseGroundingContext): boolean {
  return countUnknownLenderClaimLines(text, grounding) > 0;
}

function hasCardContextWithoutLabel(text: string, grounding?: ResponseGroundingContext): boolean {
  if (!grounding) return false;
  for (const lender of grounding.likelyCardLenders) {
    for (const alias of lenderAliases(lender)) {
      const match = text.match(new RegExp(`${escapeRegExp(alias)}[^\\n.?!]{0,160}`, 'i'))?.[0] || '';
      if (match && /\b(limit|utilization|usage|used|payment|dpd|delay|%)\b/i.test(match) && !/\bcredit\s+card\b/i.test(match)) {
        return true;
      }
    }
  }
  return false;
}

function hasWrongCreditScore(text: string, grounding?: ResponseGroundingContext): boolean {
  if (!grounding || grounding.creditScore === null || grounding.creditScore === undefined) return false;
  const match = text.match(/credit score(?:\s*(?:is|of|at|stands at|currently|around|near))?\s*(\d{3})/i);
  if (!match) return false;
  return Number(match[1]) !== grounding.creditScore;
}

function hasBusinessLoanLeak(text: string, grounding?: ResponseGroundingContext): boolean {
  if (!grounding) return false;
  for (const lender of grounding.likelyCardLenders) {
    for (const alias of lenderAliases(lender)) {
      if (new RegExp(`${escapeRegExp(alias)}[^\\n.?!]{0,160}\\bbusiness\\s+loan`, 'i').test(text)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect lines where a known lender is mentioned alongside an INR amount
 * that does not match any known amount for that lender in the grounding context.
 * Returns the count of such inaccurate lines.
 */
function countLenderAmountMismatches(text: string, grounding?: ResponseGroundingContext): number {
  if (!grounding || !grounding.lenderFacts) return 0;
  const allowedAliases = buildAllowedLenderAliasSet(grounding);
  let mismatches = 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const amountTokens = line.match(/₹\s?[\d,]+/g);
    if (!amountTokens || amountTokens.length === 0) continue;

    const lenderMentions = [...line.matchAll(LENDER_MENTION_PATTERN)].map(m => m[1]);
    if (lenderMentions.length === 0) continue;

    for (const mention of lenderMentions) {
      if (isGenericNonLenderPhrase(mention)) continue;
      if (!isKnownLender(mention, allowedAliases)) continue;

      // Find the matching lender in lenderFacts
      const mentionKey = lenderKey(mention);
      let matchedFacts: typeof grounding.lenderFacts[string] | null = null;
      for (const [lender, facts] of Object.entries(grounding.lenderFacts)) {
        for (const alias of lenderAliases(lender)) {
          const aliasKey = lenderKey(alias);
          if (aliasKey.length >= 3 && (mentionKey.includes(aliasKey) || aliasKey.includes(mentionKey))) {
            matchedFacts = facts;
            break;
          }
        }
        if (matchedFacts) break;
      }

      if (!matchedFacts) continue;

      const validAmounts = [
        ...(matchedFacts.outstandingAmounts || []),
        ...(matchedFacts.overdueAmounts || []),
        ...(matchedFacts.creditLimits || []),
      ].map(v => Math.round(v)).filter(v => v > 0);

      if (validAmounts.length === 0) continue;

      for (const token of amountTokens) {
        const parsed = parseINR(token);
        if (parsed === null || parsed === 0) continue;
        // Check if the amount is close to any known value (within 5% tolerance for rounding)
        const isNear = validAmounts.some(known => {
          const tolerance = Math.max(known * 0.05, 500);
          return Math.abs(parsed - known) <= tolerance;
        });
        // Also check against knownNumericFacts for aggregate numbers that might appear on the same line
        const isKnownGlobal = grounding.knownNumericFacts?.includes(parsed) ?? false;
        if (!isNear && !isKnownGlobal) {
          mismatches++;
        }
      }
    }
  }

  return mismatches;
}

/**
 * Fix lines where a lender is mentioned with an incorrect INR amount
 * by replacing the wrong amount with the nearest known value for that lender.
 */
/**
 * Keywords that indicate a settlement/savings context where amount correction
 * should NOT snap a computed value (like 45% of outstanding) back to the
 * original outstanding amount.
 */
const SETTLEMENT_CONTEXT_KEYWORDS = /\b(settl|reduc|sav|resolv|negotiat|pay(?:ing|ment)?.*(?:around|approximately|estimated)|enrolled.*debt)\b/i;

function correctLenderAmountMismatches(reply: string, grounding: ResponseGroundingContext): string {
  if (!grounding.lenderFacts) return reply;
  let corrected = reply;

  for (const [lender, facts] of Object.entries(grounding.lenderFacts)) {
    const validAmounts = [
      ...(facts.outstandingAmounts || []),
      ...(facts.overdueAmounts || []),
      ...(facts.creditLimits || []),
    ].map(v => Math.round(v)).filter(v => v > 0);

    if (validAmounts.length === 0) continue;

    for (const alias of lenderAliases(lender)) {
      const nearContextPattern = new RegExp(`(\\b${escapeRegExp(alias)}\\b[^\\n.?!]{0,200})`, 'gi');
      corrected = corrected.replace(nearContextPattern, (segment: string) => {
        // Skip correction in settlement contexts — the amount may be a
        // legitimately computed settlement value (e.g. 45% of outstanding)
        if (SETTLEMENT_CONTEXT_KEYWORDS.test(segment)) return segment;

        const amountTokens = segment.match(/₹\s?[\d,]+/g);
        if (!amountTokens || amountTokens.length === 0) return segment;

        let updated = segment;
        for (const token of amountTokens) {
          const parsed = parseINR(token);
          if (parsed === null || parsed === 0 || validAmounts.includes(parsed)) continue;
          // Check global known facts too
          if (grounding.knownNumericFacts?.includes(parsed)) continue;
          const replacement = nearestValue(parsed, validAmounts);
          if (replacement === null) continue;
          // Only correct if reasonably close (within 50% - beyond that, likely referencing something else)
          if (Math.abs(parsed - replacement) / Math.max(parsed, replacement) > 0.5) continue;
          updated = updated.replace(token, formatINR(replacement));
        }
        return updated;
      });
    }
  }

  return corrected;
}

/**
 * Detect and fix settlement amounts that are clearly wrong.
 *
 * Scans for patterns like:
 *   "₹X could be settled for ₹Y"
 *   "₹X to ₹Y"
 *   "₹X ... settled ... for around ₹Y"
 *
 * If Y >= 60% of X (i.e., near-zero savings), recomputes Y as 45% of X.
 * A correct settlement should be ~45% of the original debt.
 */
function fixSettlementSameAmount(reply: string): string {
  // Match any two ₹ amounts within 150 chars. We then check the text between
  // them for settlement-indicating words before applying corrections.
  const amountPairPattern = /(₹\s?[\d,]+)([^₹]{0,150})(₹\s?[\d,]+)/gi;
  const SETTLEMENT_MIDDLE_KEYWORDS = /\b(settl|reduc|resolv|negotiat|to\b|for\b)/i;
  // Exclude EMI/consolidation contexts where a small reduction is legitimate
  const EMI_CONTEXT_KEYWORDS = /\b(EMI|instalment|installment|payment|consolidat|monthly)\b/i;
  return reply.replace(amountPairPattern, (match, origToken: string, middle: string, settledToken: string, offset: number) => {
    // Only apply to settlement contexts, not EMI/consolidation contexts
    if (!SETTLEMENT_MIDDLE_KEYWORDS.test(middle)) return match;
    // Check broader context (100 chars before the match) for EMI keywords
    const contextStart = Math.max(0, offset - 100);
    const broadContext = reply.substring(contextStart, offset + match.length);
    if (EMI_CONTEXT_KEYWORDS.test(broadContext)) return match;

    const origVal = parseINR(origToken);
    const settledVal = parseINR(settledToken);
    if (origVal === null || settledVal === null) return match;
    if (origVal <= 0 || settledVal <= 0) return match;
    // Only fix when the second amount is meant to be LESS than the first
    // (i.e., original debt → settled amount). Skip if second > first.
    if (settledVal > origVal) return match;

    // Settlement amount should be roughly 40-50% of original.
    // If settled >= 60% of original, the math is wrong — recompute.
    const ratio = settledVal / origVal;
    if (ratio >= 0.60) {
      const correctSettlement = Math.round(origVal * 0.45);
      const correctedToken = formatINR(correctSettlement);
      // Replace the LAST occurrence of settledToken in the match
      // (handles the case where origToken and settledToken are identical strings)
      const lastIdx = match.lastIndexOf(settledToken);
      if (lastIdx >= 0) {
        return match.substring(0, lastIdx) + correctedToken + match.substring(lastIdx + settledToken.length);
      }
      return match;
    }
    return match;
  });
}

/**
 * Detect and fix savings amounts that are clearly wrong.
 *
 * Catches: "₹X ... saving you ₹Y" where Y < 30% of X.
 * A correct savings should be ~55% of the original debt.
 */
function fixSettlementSavings(reply: string): string {
  // Pattern: "₹X ... saving ... ₹Y" where Y should be ~55% of X
  const savingsPattern = /(₹\s?[\d,]+)([^₹]{0,120}saving[s]?\s+(?:you\s+)?(?:approximately\s+)?(?:around\s+)?)(₹\s?[\d,]+)/gi;
  return reply.replace(savingsPattern, (match, origToken: string, middle: string, savingsToken: string) => {
    const origVal = parseINR(origToken);
    const savingsVal = parseINR(savingsToken);
    if (origVal === null || savingsVal === null) return match;
    if (origVal <= 0) return match;

    // Savings should be roughly 50-60% of the original amount.
    // If savings < 30% of original, something is wrong — recompute.
    const ratio = savingsVal / origVal;
    if (ratio < 0.30) {
      const correctSavings = Math.round(origVal * 0.55);
      return match.replace(savingsToken, formatINR(correctSavings));
    }
    return match;
  });
}

function determineExpectedFormatMode(userMessage: string, history: ChatMessage[], advisorContext?: AdvisorContext): StructuredFormatMode {
  const normalized = normalizeSpace(stripEmDashes(userMessage));
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const lastAssistant = history.filter(message => message.role === 'assistant').slice(-1)[0]?.content || '';
  const lowered = normalized.toLowerCase();

  if (wordCount <= 12 && FORMAT_KEYWORDS.plain.test(normalized)) {
    return 'plain';
  }

  const specificFocus = !FORMAT_KEYWORDS.analysis.test(normalized) &&
    FORMAT_KEYWORDS.guided.test(normalized) &&
    /\b(my|why|what about|tell me about|explain|problem|issue)\b/i.test(normalized);
  if (specificFocus) {
    return 'guided';
  }

  const broadByMessage = FORMAT_KEYWORDS.analysis.test(normalized);
  const broadByReply = /\b(which|what) (?:goal|priority|focus)|\bcompare\b|\boverall\b/i.test(lastAssistant);
  if (broadByMessage || broadByReply || /\bscore\b/.test(lowered) && /\b(improve|increase|boost|raise|fix|overall)\b/.test(lowered)) {
    return 'analysis';
  }

  if (FORMAT_KEYWORDS.guided.test(normalized)) {
    return 'guided';
  }

  if (wordCount <= 18) {
    return 'guided';
  }

  return 'analysis';
}

function hasNamedLendersInMessage(message: string): boolean {
  if (/\bi(?:'| a)?m facing harassment from\b/i.test(message)) return true;
  return [...message.matchAll(LENDER_MENTION_PATTERN)].some(match => !isGenericNonLenderPhrase(match[1]));
}

function classifyLastAssistantFocus(content: string, activeIntentTag?: string | null): ConversationState['last_assistant_focus'] {
  if (!content.trim()) return 'none';
  if (activeIntentTag === 'INTENT_HARASSMENT' && HARASSMENT_OVERVIEW_PATTERN.test(content)) return 'harassment_overview';
  if (SHIELD_PATTERN.test(content) && /\b(help|protect|report|escalat|rights)\b/i.test(content)) return 'shield_actions';
  if (PROFILE_SNAPSHOT_PATTERN.test(content)) return 'profile_snapshot';
  if (/\b(?:freed shield|goal tracker|credit insights|debt resolution|debt consolidation|debt elimination)\b/i.test(content)) {
    return 'solution_recommendation';
  }
  return 'direct_answer';
}

function buildConversationState(input: StructuredChatRequest, currentUserTurn: number): ConversationState {
  const assistantMessages = input.history
    .filter(message => message.role === 'assistant')
    .map(message => stripMarkdownLinks(stripEmDashes(message.content)));
  const lastAssistant = assistantMessages[assistantMessages.length - 1] || '';
  const activeIntentTag = input.intentTag ?? null;
  const lastUserIntentTag = getLastUserIntentTag(input.history) ?? null;
  const empathyAlreadyExpressed = assistantMessages.some(message => EMPATHY_OPENING_PATTERN.test(message.slice(0, 220)));
  const profileSnapshotAlreadyGiven = assistantMessages.some(message => PROFILE_SNAPSHOT_PATTERN.test(message));
  const harassmentOverviewAlreadyGiven = assistantMessages.some(message => HARASSMENT_OVERVIEW_PATTERN.test(message));
  const shieldAlreadyIntroduced = assistantMessages.some(message => SHIELD_PATTERN.test(message));
  const namedLendersInUserMessage = hasNamedLendersInMessage(input.userMessage);

  let continuationDirective = 'Advance the conversation by adding new value. Do not re-introduce the topic or restate the same summary.';
  if (currentUserTurn <= 1 || input.history.length === 0) {
    continuationDirective = 'Treat this as the first substantive response in a fresh conversation.';
  } else if (activeIntentTag === 'INTENT_HARASSMENT' && harassmentOverviewAlreadyGiven && namedLendersInUserMessage) {
    continuationDirective = 'This is a harassment follow-up after the general overview has already been given. Do not repeat the empathy block, missed-payment snapshot, or generic harassment examples. Move straight to the named lenders, the immediate documentation or escalation steps, and how FREED Shield applies now.';
  } else if (profileSnapshotAlreadyGiven) {
    // Detect if the new question overlaps with what was already answered.
    // Use the content digest to check if the user's new question topic was
    // already covered by a prior response's strategies/headings.
    const digest = extractContentDigest(input.history.slice(-6));
    const msgLower = input.userMessage.toLowerCase();
    const topicOverlap =
      // Score improvement overlap
      (digest.strategies_mentioned.some(s => /payment|avalanche|snowball|utilization|interest/i.test(s)) &&
        /\b(improve|score|750|increase|boost|raise|better|path|cibil)\b/i.test(msgLower)) ||
      // EMI/consolidation overlap
      (digest.strategies_mentioned.some(s => /consolidat/i.test(s)) &&
        /\b(emi|consolidat|combine|single|lower)\b/i.test(msgLower)) ||
      // Harassment overlap
      (digest.strategies_mentioned.some(s => /shield/i.test(s)) &&
        /\b(harass|collection|recovery|call|threat)\b/i.test(msgLower)) ||
      // General heading overlap — prior headings contain keywords matching new question
      (digest.section_headings.some(h => {
        const hWords = h.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        return hWords.some(w => msgLower.includes(w));
      }));

    if (topicOverlap) {
      continuationDirective = 'CRITICAL: The user is asking about a topic you ALREADY covered in detail. Do NOT repeat the profile snapshot, the same improvement tips, or the same section structure. Instead: (1) Skip any overview/snapshot — reference it with "As we discussed..." (2) Go DEEPER with NEW angles: prioritised action sequence, point-by-point breakdown, timeline, trade-offs, specific account-level strategies not yet mentioned. (3) Use completely different section headings.';
    } else {
      continuationDirective = 'A profile snapshot was already given earlier in this conversation. Answer the current question directly and mention prior numbers only when they are essential for the next point.';
    }
  } else if (empathyAlreadyExpressed) {
    continuationDirective = 'Empathy has already been established in this thread. Use at most one brief validating clause, then spend the response on new information.';
  }

  return {
    current_user_turn: currentUserTurn,
    is_follow_up: currentUserTurn > 1,
    active_intent_tag: activeIntentTag,
    last_user_intent_tag: lastUserIntentTag,
    empathy_already_expressed: empathyAlreadyExpressed,
    profile_snapshot_already_given: profileSnapshotAlreadyGiven,
    harassment_overview_already_given: harassmentOverviewAlreadyGiven,
    shield_already_introduced: shieldAlreadyIntroduced,
    named_lenders_in_user_message: namedLendersInUserMessage,
    last_assistant_focus: classifyLastAssistantFocus(lastAssistant, activeIntentTag),
    continuation_directive: continuationDirective,
  };
}

/**
 * Extract section headings used in prior assistant responses so the model
 * knows which structural headings have already been displayed to the user.
 * Matches bold markdown headings (**HEADING**) and plain ALL-CAPS lines.
 */
function extractPriorSectionHeadings(history: ChatMessage[]): string[] {
  const headings: string[] = [];
  for (const message of history) {
    if (message.role !== 'assistant') continue;
    // Match **BOLD HEADINGS** used in structured sections
    const boldMatches = message.content.matchAll(/\*\*([A-Z][A-Z &\-/]+[A-Z])\*\*/g);
    for (const m of boldMatches) {
      const h = m[1].trim();
      if (h.length >= 4 && h.length <= 60) headings.push(h);
    }
    // Match plain ALL-CAPS lines (at least 3 words)
    const lines = message.content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[A-Z][A-Z &\-/]{6,50}$/.test(trimmed) && trimmed.split(/\s+/).length >= 2) {
        if (!headings.includes(trimmed)) headings.push(trimmed);
      }
    }
  }
  return [...new Set(headings)];
}

/**
 * Compress an assistant message to preserve its structural skeleton while
 * removing verbose explanations. This lets the model see WHAT STRUCTURE it
 * used (section headings, key data points, strategies) without consuming
 * too many tokens. Used in native OpenAI turns for multi-turn context.
 */
function compressForHistory(content: string, maxLen: number): string {
  const lines = content.split('\n');
  const skeleton: string[] = [];
  let charBudget = maxLen;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Always keep section headings (bold or ALL-CAPS)
    const isHeading = /^\*\*[A-Z]/.test(trimmed) || /^[A-Z][A-Z &\-/]{4,}$/.test(trimmed);
    // Always keep bullet points (they carry the specific advice)
    const isBullet = /^[-•*]/.test(trimmed) || /^\d+\./.test(trimmed);
    // Keep lines with specific data (₹ amounts, percentages, account counts)
    const hasData = /[₹%]|\b\d{3,}\b|\bactive accounts?\b|\bcredit score\b/i.test(trimmed);

    if (isHeading) {
      // Headings are short — always include
      skeleton.push(trimmed);
      charBudget -= trimmed.length + 1;
    } else if (isBullet || hasData) {
      // Truncate long bullets to their first clause
      const shortened = trimmed.length > 120 ? trimmed.slice(0, 117).trimEnd() + '...' : trimmed;
      if (charBudget - shortened.length > 0) {
        skeleton.push(shortened);
        charBudget -= shortened.length + 1;
      }
    } else if (charBudget > maxLen * 0.3) {
      // Include opening/closing prose only if we have plenty of budget
      const shortened = trimmed.length > 80 ? trimmed.slice(0, 77).trimEnd() + '...' : trimmed;
      skeleton.push(shortened);
      charBudget -= shortened.length + 1;
    }

    if (charBudget <= 0) break;
  }

  return skeleton.join('\n');
}

/**
 * Extract a structured content digest from prior assistant messages.
 * This tells the model specifically what content was already surfaced from
 * the advisor_context — accounts, strategies, data points — so it can
 * generate genuinely new content even when given the same underlying data.
 */
interface ContentDigest {
  section_headings: string[];
  strategies_mentioned: string[];
  lenders_cited: string[];
  data_points_stated: string[];
}

function extractContentDigest(history: ChatMessage[]): ContentDigest {
  const headings = extractPriorSectionHeadings(history);

  const strategies: string[] = [];
  const lenders = new Set<string>();
  const dataPoints: string[] = [];

  const assistantMessages = history
    .filter(m => m.role === 'assistant')
    .map(m => m.content);

  if (assistantMessages.length === 0) {
    return { section_headings: [], strategies_mentioned: [], lenders_cited: [], data_points_stated: [] };
  }

  const combined = assistantMessages.join(' ');

  // Strategies / advice patterns
  if (/avalanche/i.test(combined)) strategies.push('avalanche method');
  if (/snowball/i.test(combined)) strategies.push('snowball method');
  if (/on.?time.*payment|payment.*history|consistent.*payment/i.test(combined)) strategies.push('on-time payment advice');
  if (/highest interest/i.test(combined)) strategies.push('prioritise highest interest accounts');
  if (/utilization|credit.?limit/i.test(combined)) strategies.push('credit utilization advice');
  if (/\bnegotiat/i.test(combined)) strategies.push('negotiation/settlement');
  if (/consolidat/i.test(combined)) strategies.push('debt consolidation');
  if (/\bgoal tracker\b/i.test(combined)) strategies.push('Goal Tracker recommendation');
  if (/\bcredit insights?\b/i.test(combined)) strategies.push('Credit Insights recommendation');
  if (/\bfreed shield\b/i.test(combined)) strategies.push('FREED Shield recommendation');
  if (/\b(?:dep|debt elimination)\b/i.test(combined)) strategies.push('DEP program');
  if (/\b(?:dcp|debt consolidation)\b/i.test(combined)) strategies.push('DCP program');
  if (/\b(?:drp|debt resolution)\b/i.test(combined)) strategies.push('DRP program');
  if (/enquir/i.test(combined)) strategies.push('enquiry management');
  if (/\bdispute\b/i.test(combined)) strategies.push('credit report dispute');

  // Lenders mentioned
  const lenderMatches = combined.matchAll(LENDER_MENTION_PATTERN);
  for (const m of lenderMatches) {
    const name = m[1].trim();
    if (!isGenericNonLenderPhrase(name) && name.length > 3) lenders.add(name);
  }

  // Data points
  if (/credit score\b.*\b\d{3}\b/i.test(combined)) dataPoints.push('credit score value');
  if (/\bactive accounts?\b.*\b\d+\b/i.test(combined) || /\b\d+\s*active accounts?\b/i.test(combined)) dataPoints.push('active account count');
  if (/\bfoir\b.*\b\d+%?/i.test(combined) || /\b\d+%?\s*(?:of (?:your )?income|foir)\b/i.test(combined)) dataPoints.push('FOIR/EMI burden percentage');
  if (/total outstanding\b.*₹/i.test(combined) || /₹[\d,]+.*outstanding/i.test(combined)) dataPoints.push('total outstanding amount');
  if (/utilization\b.*\b\d+%/i.test(combined) || /\b\d+%\s*utilization\b/i.test(combined)) dataPoints.push('card utilization rate');
  if (/on.?time.*\b\d+%/i.test(combined) || /\bpayment.*rate\b.*\b\d+%/i.test(combined)) dataPoints.push('on-time payment rate');
  if (/enquir(?:y|ies)\b.*\b\d+\b/i.test(combined)) dataPoints.push('enquiry count');
  if (/delinquen|overdue.*account/i.test(combined)) dataPoints.push('overdue/delinquent accounts');
  if (EMPATHY_OPENING_PATTERN.test(combined)) dataPoints.push('empathy opening');
  if (HARASSMENT_OVERVIEW_PATTERN.test(combined)) dataPoints.push('harassment overview');

  return {
    section_headings: headings,
    strategies_mentioned: strategies,
    lenders_cited: [...lenders],
    data_points_stated: dataPoints,
  };
}

/**
 * Compute topics from the user's profile that haven't been discussed yet.
 * This helps the LLM diversify follow-ups by suggesting unexplored angles.
 */
function computeUnexploredTopics(
  digest: ContentDigest,
  ctx?: AdvisorContext | null,
): string[] {
  if (!ctx) return [];

  const covered = new Set([
    ...digest.data_points_stated.map(d => d.toLowerCase()),
    ...digest.strategies_mentioned.map(s => s.toLowerCase()),
  ]);
  const combined = [...digest.data_points_stated, ...digest.strategies_mentioned].join(' ').toLowerCase();

  const unexplored: string[] = [];

  // Credit score improvement — if score wasn't discussed yet
  if (ctx.creditScore && !covered.has('credit score value') && !/score/i.test(combined)) {
    unexplored.push(`Credit score analysis (currently ${ctx.creditScore})`);
  }

  // Card utilization — if not discussed and utilization is high
  if ((ctx.overallCardUtilization ?? 0) > 30 && !covered.has('card utilization rate') && !/utilization/i.test(combined)) {
    unexplored.push(`Card usage optimization (currently ${ctx.overallCardUtilization}%)`);
  }

  // Interest rates — if not discussed and accounts have high rates
  if (ctx.avalancheOrder && ctx.avalancheOrder.length > 0 && !/interest/i.test(combined)) {
    unexplored.push(`Interest cost reduction (highest: ${ctx.avalancheOrder[0]})`);
  }

  // Overdue accounts — if not discussed and there are delinquent accounts
  if (ctx.delinquentAccountCount > 0 && !covered.has('overdue/delinquent accounts') && !/overdue|delinquen/i.test(combined)) {
    unexplored.push(`Overdue account clearance (${ctx.delinquentAccountCount} accounts)`);
  }

  // Loan eligibility — if not discussed
  if (!/loan.*eligib|eligib.*loan/i.test(combined)) {
    unexplored.push('New loan eligibility assessment');
  }

  // EMI burden — if not discussed
  if ((ctx.foirPercentage ?? 0) > 20 && !/emi.*burden|foir|obligation/i.test(combined)) {
    unexplored.push(`EMI burden management (${ctx.foirPercentage}% of income)`);
  }

  // FREED programs — if the relevant program wasn't discussed
  const segment = ctx.segment;
  if (segment === 'DEP' && !/dep|debt elimination/i.test(combined)) {
    unexplored.push("FREED's Debt Elimination Program");
  }
  if (segment === 'DCP_Eligible' && !/dcp|consolidation/i.test(combined)) {
    unexplored.push("FREED's Debt Consolidation Program");
  }
  if (segment === 'DRP_Eligible' && !/drp|settlement/i.test(combined)) {
    unexplored.push("FREED's Debt Resolution Program");
  }

  // Payment history / track record — if not discussed
  if ((ctx.overallOnTimeRate ?? 0) > 0 && !/on.?time|payment.*rate/i.test(combined)) {
    unexplored.push(`Payment track record (${ctx.overallOnTimeRate}% on-time)`);
  }

  return unexplored.slice(0, 5); // Cap at 5 suggestions
}

/**
 * Check if a new response is structurally repetitive of the prior response.
 * Returns section indices that are duplicates (for removal or rewrite).
 * This is the post-generation guard that catches what the prompt rules miss.
 */
function detectRepetitiveSections(
  newTurn: StructuredAssistantTurn,
  history: ChatMessage[]
): { isDuplicate: boolean; duplicateSectionIndices: number[]; overlapRatio: number } {
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return { isDuplicate: false, duplicateSectionIndices: [], overlapRatio: 0 };

  const priorContent = lastAssistant.content.toLowerCase();
  const priorHeadings = extractPriorSectionHeadings([lastAssistant]);
  const priorHeadingKeys = new Set(priorHeadings.map(h => h.toLowerCase().replace(/[^a-z ]/g, '').trim()));

  const duplicateIndices: number[] = [];
  let totalItems = 0;
  let repeatedItems = 0;

  for (let i = 0; i < newTurn.sections.length; i++) {
    const section = newTurn.sections[i];
    const titleKey = (section.title || '').toLowerCase().replace(/[^a-z ]/g, '').trim();

    // Check heading reuse
    const headingReused = priorHeadingKeys.has(titleKey) ||
      [...priorHeadingKeys].some(ph => {
        // Fuzzy: shared words > 60%
        const phWords = new Set(ph.split(' ').filter(w => w.length > 2));
        const titleWords = titleKey.split(' ').filter(w => w.length > 2);
        if (phWords.size === 0 || titleWords.length === 0) return false;
        const overlap = titleWords.filter(w => phWords.has(w)).length;
        return overlap / Math.max(phWords.size, titleWords.length) > 0.6;
      });

    // Check item-level content overlap
    let sectionRepeats = 0;
    for (const item of section.items) {
      totalItems++;
      const itemKey = item.toLowerCase().replace(/[^a-z0-9₹% ]/g, '').trim();
      // Check if a significant portion of this bullet appeared in prior response
      const words = itemKey.split(' ').filter(w => w.length > 3);
      if (words.length >= 3) {
        const matchedWords = words.filter(w => priorContent.includes(w));
        if (matchedWords.length / words.length > 0.7) {
          sectionRepeats++;
          repeatedItems++;
        }
      }
    }

    if (headingReused && sectionRepeats > 0) {
      duplicateIndices.push(i);
    }
  }

  const overlapRatio = totalItems > 0 ? repeatedItems / totalItems : 0;
  return {
    isDuplicate: overlapRatio > 0.5 || duplicateIndices.length >= 2,
    duplicateSectionIndices: duplicateIndices,
    overlapRatio,
  };
}

/**
 * Extract topics already covered in prior assistant messages to prevent repetition.
 * Scans assistant messages in history for common data-point patterns and returns
 * a concise list of what's been stated so the LLM knows not to repeat it.
 * @deprecated Use extractContentDigest for richer content awareness.
 */
function extractTopicsCovered(history: ChatMessage[]): string[] {
  const digest = extractContentDigest(history);
  return [...digest.data_points_stated, ...digest.strategies_mentioned.map(s => `strategy: ${s}`)];
}

/**
 * Extract follow-ups from prior assistant messages in the conversation history.
 * These are used to prevent the model from generating the same follow-ups again.
 */
function extractPriorFollowUps(history: ChatMessage[]): string[] {
  const priorFollowUps: string[] = [];
  for (const message of history) {
    if (message.role === 'assistant' && message.followUps && Array.isArray(message.followUps)) {
      for (const fu of message.followUps) {
        if (fu && typeof fu === 'string' && fu.trim()) {
          priorFollowUps.push(fu.trim());
        }
      }
    }
  }
  return priorFollowUps;
}

function buildStructuredPayload(input: StructuredChatRequest, expectedFormatMode: StructuredFormatMode): StructuredModelPayload {
  const currentUserTurn = getCurrentUserTurnCount(input.history, input.messageCount);
  const recentSlice = input.history.slice(-6);

  // Use structure-preserving compression for history in the payload too.
  // Last assistant message gets the most room to aid anti-repetition.
  const historyPreview = recentSlice.map((message, idx) => {
    const cleaned = stripNextStepsBlock(stripMarkdownLinks(stripEmDashes(message.content)));
    if (message.role === 'assistant') {
      const isLastAssistant = idx === recentSlice.length - 1 ||
        (idx === recentSlice.length - 2 && recentSlice[recentSlice.length - 1]?.role === 'user');
      return { role: message.role as 'user' | 'assistant', content: compressForHistory(cleaned, isLastAssistant ? 900 : 500) };
    }
    return { role: message.role as 'user' | 'assistant', content: shortenText(cleaned, 280) };
  });

  // Full content digest: tells the model exactly what content, strategies,
  // lenders, and data points it already surfaced from advisor_context.
  const contentDigest = extractContentDigest(recentSlice);
  const priorFollowUps = extractPriorFollowUps(recentSlice);
  const conversationState = buildConversationState(input, currentUserTurn);

  return {
    user_message: input.userMessage,
    expected_format_mode: expectedFormatMode,
    message_count: currentUserTurn,
    user_name: input.userName ?? input.advisorContext?.userName ?? null,
    segment: input.segment ?? input.advisorContext?.segment ?? null,
    intent_tag: input.intentTag,
    recent_history: historyPreview,
    topics_already_covered: [...contentDigest.data_points_stated, ...contentDigest.strategies_mentioned.map(s => `strategy: ${s}`)],
    prior_section_headings: contentDigest.section_headings,
    prior_follow_ups: priorFollowUps,
    topics_not_yet_explored: computeUnexploredTopics(contentDigest, input.advisorContext),
    conversation_state: conversationState,
    advisor_context: input.advisorContext ?? null,
    grounding_context: input.grounding ?? null,
    knowledge_snippets: (input.knowledgeBase || '').slice(0, 7000),
    allowed_redirect_routes: [...ALLOWED_REDIRECT_ROUTE_SET],
  };
}

function parseJsonObject<T>(content: string): T | null {
  const attempt = (candidate: string): T | null => {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return null;
    }
  };

  const direct = attempt(content.trim());
  if (direct) return direct;

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return attempt(content.slice(start, end + 1));
  }

  return null;
}

async function callModelForJson<T>(args: {
  systemPrompt: string;
  payload: unknown;
  schema: unknown;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<T | null> {
  const response = await getClient().chat.completions.create({
    model: args.model ?? 'gpt-4o',
    temperature: args.temperature ?? 0.2,
    max_tokens: args.maxTokens ?? 900,
    response_format: {
      type: 'json_schema',
      json_schema: args.schema,
    } as never,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: JSON.stringify(args.payload) },
    ],
  } as never);

  const content = response.choices[0]?.message?.content || '';
  return parseJsonObject<T>(content);
}

/**
 * Build native multi-turn messages from conversation history.
 * Instead of cramming history into a JSON blob, we send actual
 * user/assistant turns so the LLM has natural conversational context.
 * Last assistant messages are shortened but kept long enough to preserve meaning.
 */
function buildConversationMessages(
  input: StructuredChatRequest,
  expectedFormatMode: StructuredFormatMode
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemPrompt = buildStructuredTurnSystemPrompt(input.segment, input.intentTag);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Inject recent conversation as native turns (last 8 messages for better context)
  const recentHistory = input.history.slice(-8);
  for (const msg of recentHistory) {
    const cleaned = stripNextStepsBlock(stripMarkdownLinks(stripEmDashes(msg.content)));
    if (msg.role === 'assistant') {
      // Use structure-preserving compression: keeps section headings, bullet
      // points, and data values so the model can see what it already said.
      // 900 chars preserves the full skeleton of a typical response.
      messages.push({
        role: 'assistant',
        content: compressForHistory(cleaned, 900),
      });
    } else {
      const historyContent = msg.intentTag
        ? `[intent: ${msg.intentTag}] ${cleaned}`
        : cleaned;
      messages.push({
        role: 'user',
        content: shortenText(historyContent, 300),
      });
    }
  }

  // Final user message: the full payload with context (but without recent_history
  // since it's now in native turns)
  const payload = buildStructuredPayload(input, expectedFormatMode);
  // Remove recent_history from payload to avoid duplication -it's in native turns now
  const { recent_history: _omit, ...payloadWithoutHistory } = payload;
  messages.push({
    role: 'user',
    content: JSON.stringify(payloadWithoutHistory),
  });

  return messages;
}

async function requestStructuredTurn(input: StructuredChatRequest, expectedFormatMode: StructuredFormatMode): Promise<StructuredAssistantTurn | null> {
  const messages = buildConversationMessages(input, expectedFormatMode);
  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.05,
    max_tokens: 1100,
    response_format: {
      type: 'json_schema',
      json_schema: STRUCTURED_TURN_SCHEMA,
    } as never,
    messages,
  } as never);

  const content = (response as any).choices[0]?.message?.content || '';
  return parseJsonObject<StructuredAssistantTurn>(content);
}

async function repairStructuredTurn(
  input: StructuredChatRequest,
  expectedFormatMode: StructuredFormatMode,
  priorTurn: StructuredAssistantTurn,
  validation: TurnValidation
): Promise<StructuredAssistantTurn | null> {
  const payload = {
    ...buildStructuredPayload(input, expectedFormatMode),
    validation_issues: [...validation.bodyIssues, ...validation.followUpIssues],
    prior_turn: priorTurn,
  };

  return await callModelForJson<StructuredAssistantTurn>({
    systemPrompt: buildStructuredTurnRepairPrompt(),
    payload,
    schema: STRUCTURED_TURN_SCHEMA,
    maxTokens: 1100,
    temperature: 0.1,
    model: 'gpt-4o-mini',
  });
}

async function repairFollowUps(
  input: StructuredChatRequest,
  expectedFormatMode: StructuredFormatMode,
  turn: StructuredAssistantTurn,
  issues: string[]
): Promise<string[] | null> {
  const bodyPreview = renderBodyPreview(turn);
  const payload = {
    ...buildStructuredPayload(input, expectedFormatMode),
    validation_issues: issues,
    reply_body: bodyPreview,
    current_followups: turn.followUps,
  };

  const result = await callModelForJson<{ followUps: string[] }>({
    systemPrompt: buildFollowUpRepairPrompt(),
    payload,
    schema: FOLLOW_UP_REPAIR_SCHEMA,
    maxTokens: 260,
    temperature: 0.15,
    model: 'gpt-4o-mini',
  });

  return result?.followUps ?? null;
}

function renderBodyPreview(turn: StructuredAssistantTurn): string {
  const parts: string[] = [];
  if (turn.opening) parts.push(turn.opening);
  for (const section of turn.sections) {
    if (section.title) parts.push(section.title);
    parts.push(...section.items);
  }
  if (turn.redirectNudge) parts.push(turn.redirectNudge);
  return parts.join('\n');
}

function validateFollowUps(turn: StructuredAssistantTurn, advisorContext?: AdvisorContext): string[] {
  const issues: string[] = [];
  const followUps = turn.followUps.slice(0, MAX_FOLLOW_UPS);
  const replyContextTokens = new Set(meaningfulTokens(renderBodyPreview(turn)));

  if (turn.followUps.length !== MAX_FOLLOW_UPS) {
    issues.push('followUps must contain exactly 3 prompts');
  }

  if (followUps.some(followUp => followUp.length < 8 || followUp.length > 100)) {
    issues.push('followUps must stay specific and concise');
  }

  // Only flag if ALL follow-ups are generic (not just one)
  const genericCount = followUps.filter(containsGenericFollowUp).length;
  if (genericCount === followUps.length && followUps.length > 0) {
    issues.push('followUps contain generic prompts');
  }

  // Relaxed grounding check: require at least 1 follow-up to reference reply content
  // (previously required 2, which triggered too many false positives)
  const contextualCount = followUps.filter(followUp => {
    const tokens = meaningfulTokens(followUp);
    return tokens.some(token => replyContextTokens.has(token));
  }).length;
  if (followUps.length > 0 && contextualCount < 1) {
    issues.push('followUps are not grounded in the reply body');
  }

  // Removed overly strict "distinct anchors" check -it triggered repair too often
  // for follow-ups that were contextually appropriate but didn't token-match advisor facts

  return issues;
}

function validateBody(turn: StructuredAssistantTurn, expectedFormatMode: StructuredFormatMode, grounding?: ResponseGroundingContext): string[] {
  const issues: string[] = [];
  const bodyText = renderBodyPreview(turn);

  if (!turn.opening) {
    issues.push('opening is required');
  }

  if (sentenceCount(turn.opening) > 3) {
    issues.push('opening is too long');
  }

  // Format mode mismatch: log but don't treat as a validation issue.
  // The LLM sometimes picks a better mode than our heuristic, and forcing
  // repair/fallback for this degrades quality more than accepting it.
  if (turn.formatMode !== expectedFormatMode) {
    console.log(`[VALIDATE] Format mode mismatch: expected=${expectedFormatMode}, got=${turn.formatMode} (accepted)`);
  }

  // Format-specific checks: only flag genuinely broken structure, not minor deviations
  if (turn.formatMode === 'plain') {
    if (turn.sections.flatMap(section => section.items).length > 3) {
      issues.push('plain mode must stay brief');
    }
  }

  if (turn.formatMode === 'guided') {
    const listSections = turn.sections.filter(section => section.style === 'bullet_list' || section.style === 'numbered_list');
    const listItemCount = listSections.flatMap(section => section.items).length;
    if (listSections.length === 0 && turn.sections.length > 0) {
      issues.push('guided mode must include one focused list section');
    }
    if (listItemCount > 6) {
      issues.push('guided mode must stay compact');
    }
  }

  if (turn.formatMode === 'analysis') {
    if (turn.sections.length < 1) {
      issues.push('analysis mode must include at least 1 section');
    }
  }

  if (!bodyText.trim()) {
    issues.push('body is empty after sanitization');
  }

  if (containsUnknownLenderClaim(bodyText, grounding)) {
    issues.push('body still contains unsupported lender claims');
  }
  if (hasCardContextWithoutLabel(bodyText, grounding)) {
    issues.push('card context is missing the credit card label');
  }
  if (hasWrongCreditScore(bodyText, grounding)) {
    issues.push('credit score mention does not match grounded data');
  }
  if (hasBusinessLoanLeak(bodyText, grounding)) {
    issues.push('card lender is still described as a business loan');
  }
  const amountMismatches = countLenderAmountMismatches(bodyText, grounding);
  if (amountMismatches > 0) {
    issues.push(`${amountMismatches} lender-amount mismatch(es) found after correction`);
  }

  return issues;
}

function validateStructuredTurn(
  turn: StructuredAssistantTurn,
  expectedFormatMode: StructuredFormatMode,
  advisorContext?: AdvisorContext,
  grounding?: ResponseGroundingContext
): TurnValidation {
  return {
    bodyIssues: validateBody(turn, expectedFormatMode, grounding),
    followUpIssues: validateFollowUps(turn, advisorContext),
  };
}

function renderSection(section: StructuredSection, mode: StructuredFormatMode): string {
  const lines: string[] = [];

  if (mode === 'analysis' && section.title) {
    lines.push(`**${section.title.toUpperCase()}**`);
  }

  if (section.style === 'paragraph' || mode === 'plain') {
    lines.push(...section.items);
    return lines.join('\n\n');
  }

  if (section.style === 'numbered_list') {
    lines.push(...section.items.map((item, index) => `${index + 1}. ${item}`));
    return lines.join('\n');
  }

  lines.push(...section.items.map(item => `- ${item}`));
  return lines.join('\n');
}

/**
 * Deterministic jargon replacement — catches terms the LLM echoes from data
 * field names despite glossary instructions. Case-insensitive, context-aware.
 */
function applyJargonReplacements(text: string): string {
  // "utilization" / "Utilization" → "card usage" (preserve case of first char)
  text = text.replace(/\b[Uu]tilization\b/g, (m) => m[0] === 'U' ? 'Card usage' : 'card usage');
  // "FOIR" → "debt-to-income ratio" (only standalone, not inside a data field ref)
  text = text.replace(/\bFOIR\b/g, 'debt-to-income ratio');
  // "delinquent" / "delinquency" → "overdue"
  text = text.replace(/\b[Dd]elinquen(t|cy)\b/g, (m) => m[0] === 'D' ? 'Overdue' : 'overdue');
  // "DPD" → "days past due"
  text = text.replace(/\bDPD\b/g, 'days past due');
  return text;
}

/**
 * Post-processing EMI sanitizer.
 * Catches the common LLM hallucination where EMI = outstanding amount.
 * EMI is a monthly payment (typically 2-10% of outstanding), so if the LLM
 * writes an EMI figure that equals or nearly equals the outstanding, it's wrong.
 *
 * Strategy: find lines containing both "EMI" and an amount, extract all ₹ amounts,
 * and if the EMI amount matches any other amount on the same line (likely the
 * outstanding), remove the EMI mention from that line.
 */
function sanitizeEMIInResponse(text: string): string {
  const lines = text.split('\n');
  const sanitized: string[] = [];

  for (const line of lines) {
    // Only process lines that mention EMI and contain ₹ amounts
    if (!/EMI/i.test(line) || !/₹/.test(line)) {
      sanitized.push(line);
      continue;
    }

    // Extract all ₹ amounts from the line (e.g., "₹4,78,247" or "**₹4,78,247**" → 478247)
    const amountMatches = [...line.matchAll(/\*{0,2}₹([\d,]+)\*{0,2}/g)];
    if (amountMatches.length < 2) {
      sanitized.push(line);
      continue;
    }

    const amounts = amountMatches.map(m => ({
      raw: m[0],
      value: parseInt(m[1].replace(/,/g, ''), 10),
    }));

    // Check if any two amounts are the same or very close (within 5%)
    let hasDuplicate = false;
    for (let i = 0; i < amounts.length; i++) {
      for (let j = i + 1; j < amounts.length; j++) {
        const ratio = Math.min(amounts[i].value, amounts[j].value) / Math.max(amounts[i].value, amounts[j].value);
        if (ratio > 0.95) {
          hasDuplicate = true;
          break;
        }
      }
      if (hasDuplicate) break;
    }

    if (!hasDuplicate) {
      sanitized.push(line);
      continue;
    }

    // Remove EMI mention patterns from the line (handles bold ** markers)
    let cleaned = line;
    // Pattern: "EMI of **₹X,XX,XXX**" or "EMI of ₹X,XX,XXX" or "EMI: ₹X"
    cleaned = cleaned.replace(/[:,]?\s*EMI\s*(?:of\s*)?\*{0,2}₹[\d,]+\*{0,2}/gi, '');
    // Pattern: "**₹X,XX,XXX** EMI" or "₹X EMI"
    cleaned = cleaned.replace(/\*{0,2}₹[\d,]+\*{0,2}\s*EMI\b/gi, '');
    // Pattern: "estimated EMI: **₹X**" or "estimated EMI of ₹X"
    cleaned = cleaned.replace(/[:,]?\s*estimated\s*EMI\s*(?:of\s*)?\*{0,2}₹[\d,]+\*{0,2}/gi, '');
    // Clean up leftover artifacts
    cleaned = cleaned.replace(/,\s*,/g, ',');
    cleaned = cleaned.replace(/,\s*\./g, '.');
    cleaned = cleaned.replace(/\(\s*,/g, '(');
    cleaned = cleaned.replace(/,\s*\)/g, ')');
    cleaned = cleaned.replace(/\s{2,}/g, ' ');

    if (cleaned.trim() !== line.trim()) {
      console.log(`[EMI-SANITIZE] Fixed: "${line.trim().substring(0, 80)}..." → "${cleaned.trim().substring(0, 80)}..."`);
    }
    sanitized.push(cleaned);
  }

  return sanitized.join('\n');
}

function renderStructuredTurn(turn: StructuredAssistantTurn): ChatResponse {
  const parts: string[] = [];
  if (turn.opening) parts.push(turn.opening);

  for (const section of turn.sections) {
    const rendered = renderSection(section, turn.formatMode);
    if (rendered) parts.push(rendered);
  }

  // Natural product nudge -ties the redirect to the user's specific situation
  if (turn.redirectNudge && turn.redirect) {
    parts.push(turn.redirectNudge);
  }

  // Follow-ups are shown as interactive chips below the message -no need to duplicate them in the body

  let reply = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  // ── Deterministic jargon replacement ──
  // LLMs echo technical field names despite glossary instructions.
  // Replace common jargon terms with plain language as a safety net.
  reply = applyJargonReplacements(reply);

  // ── EMI sanitizer: catch LLM hallucination where EMI = outstanding ──
  reply = sanitizeEMIInResponse(reply);

  const cleanedFollowUps = turn.followUps.slice(0, MAX_FOLLOW_UPS).map(applyJargonReplacements);

  return {
    reply,
    followUps: cleanedFollowUps,
    redirectUrl: turn.redirect?.url,
    redirectLabel: turn.redirect?.label,
  };
}

/**
 * Build contextual follow-ups for the safe turn fallback.
 * Uses the user's actual message to pick relevant follow-ups,
 * then fills remaining slots from general profile-based options.
 * Always returns exactly 3 follow-ups.
 */
/**
 * Build contextual fallback follow-ups derived from the assistant's response body.
 * When we have the response body, extract lender names, topics, and risks mentioned
 * to generate follow-ups that continue the conversation naturally.
 * Only used when LLM follow-ups fail validation entirely.
 */
function buildContextualFollowUps(
  ctx: StructuredChatRequest['advisorContext'],
  userMessage: string,
  responseBody?: string,
): string[] {
  if (!ctx) return [];

  const pool: string[] = [];
  const segment = ctx.segment;

  // ── Extract context from the response body (what was just discussed) ──
  const body = (responseBody || '').toLowerCase();
  const bodyLenders = new Set<string>();
  const bodyTopics = new Set<string>();

  // Extract lender names mentioned in the response
  for (const account of [...(ctx.dominantAccounts || []), ...(ctx.relevantAccounts || [])]) {
    if (account.lenderName && body.includes(account.lenderName.toLowerCase().split(' ')[0])) {
      bodyLenders.add(account.lenderName);
    }
  }

  // Detect topics discussed in response
  if (/utilization|credit card|card usage/i.test(body)) bodyTopics.add('utilization');
  if (/overdue|delay|missed|dpd|delinquen/i.test(body)) bodyTopics.add('overdue');
  if (/emi|payment|obligation|foir|burden/i.test(body)) bodyTopics.add('emi');
  if (/score|cibil|rating/i.test(body)) bodyTopics.add('score');
  if (/interest|roi|rate/i.test(body)) bodyTopics.add('interest');
  if (/settlement|drp|resolve/i.test(body)) bodyTopics.add('settlement');
  if (/harassment|recovery|agent|call/i.test(body)) bodyTopics.add('harassment');
  if (/loan|eligib|approval/i.test(body)) bodyTopics.add('loan');

  // ── Generate follow-ups based on what the response discussed ──

  // Follow-ups anchored to specific lenders mentioned in the response
  const lenderArr = [...bodyLenders];
  if (lenderArr.length > 0) {
    pool.push(`What should I do about ${lenderArr[0]} first?`);
    if (lenderArr.length > 1) {
      pool.push(`Between ${lenderArr[0]} and ${lenderArr[1]}, which is more urgent?`);
    }
  }

  // Follow-ups based on topics discussed
  if (bodyTopics.has('overdue')) {
    pool.push(`How quickly can my score recover once I clear the overdue?`);
    pool.push(`Which overdue account should I prioritize?`);
  }
  if (bodyTopics.has('utilization')) {
    pool.push(`How do I bring my card utilization under control?`);
  }
  if (bodyTopics.has('score')) {
    pool.push(`What's the single biggest thing dragging my score down?`);
    if (ctx.nextScoreTarget) {
      pool.push(`What's the fastest way to reach ${ctx.nextScoreTarget}?`);
    }
  }
  if (bodyTopics.has('emi')) {
    pool.push(`Which account should I pay off first?`);
    if (segment === 'DCP_Eligible' || segment === 'DCP_Ineligible') {
      pool.push(`Can I combine my loans into a single EMI?`);
    }
  }
  if (bodyTopics.has('interest')) {
    pool.push(`Which loan is costing me the most in interest?`);
    pool.push(`Should I prepay my costliest loan first?`);
  }
  if (bodyTopics.has('settlement') && (segment === 'DRP_Eligible')) {
    pool.push(`How much could I save through settlement?`);
    pool.push(`Will settlement affect my credit score?`);
  }
  if (bodyTopics.has('harassment')) {
    pool.push(`Can FREED Shield stop the recovery calls?`);
    pool.push(`What are my rights as a borrower?`);
  }
  if (bodyTopics.has('loan')) {
    pool.push(`What should I fix before applying for a loan?`);
  }

  // ── Fallback: user message topic if response body didn't yield enough ──
  if (pool.length < 3) {
    const lower = (userMessage || '').toLowerCase();
    if (/score|cibil/i.test(lower) && !pool.some(p => /score/i.test(p))) {
      pool.push(`What's hurting my score the most?`);
    }
    if (/overdue|delay|missed/i.test(lower) && !pool.some(p => /overdue/i.test(p))) {
      pool.push(`Are any of my accounts at risk of legal action?`);
    }
    if (/harass|recovery|call/i.test(lower) && !pool.some(p => /shield|rights/i.test(p))) {
      pool.push(`Can FREED Shield stop the recovery calls?`);
    }
  }

  // ── Last resort: profile-based fillers ──
  if (ctx.delinquentAccountCount > 0 && !pool.some(p => /overdue|delinqu|clear/i.test(p))) {
    pool.push(`How do I deal with my overdue accounts?`);
  }
  if (!pool.some(p => /score|improv|hurting/i.test(p))) {
    pool.push(`What can I do to improve my credit score?`);
  }
  if (ctx.activeAccountCount > 3 && !pool.some(p => /focus|first|priorit/i.test(p))) {
    pool.push(`Which account should I focus on first?`);
  }

  // Deduplicate and return exactly 3
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of pool) {
    const key = item.toLowerCase().slice(0, 35);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
    if (unique.length >= 3) break;
  }

  return unique;
}

/**
 * Determine an appropriate redirect for the safe turn based on segment and intent.
 */
function inferSafeRedirect(segment: string | null | undefined, intentTag: string | undefined, userMessage: string): StructuredRedirect | undefined {
  const lower = (userMessage || '').toLowerCase();

  // Intent-based redirect takes priority
  if (intentTag) {
    switch (intentTag) {
      case 'INTENT_HARASSMENT':
        return { url: '/freed-shield', label: 'Explore FREED Shield' };
      case 'INTENT_DELINQUENCY_STRESS':
        if (segment === 'DRP_Eligible') return { url: '/drp', label: 'Explore Debt Resolution' };
        return { url: '/credit-score', label: 'View your credit profile' };
      case 'INTENT_EMI_OPTIMISATION':
        if (segment === 'DCP_Eligible') return { url: '/dcp', label: 'Explore Debt Consolidation' };
        if (segment === 'DEP') return { url: '/dep', label: 'Explore Debt Elimination' };
        return { url: '/credit-score', label: 'View your credit profile' };
      case 'INTENT_INTEREST_OPTIMISATION':
        if (segment === 'DEP') return { url: '/dep', label: 'Explore Debt Elimination' };
        break;
      case 'INTENT_GOAL_BASED_LOAN':
        return { url: '/credit-score', label: 'Check Your Loan Readiness' };
      case 'INTENT_CREDIT_SCORE_TARGET':
        return { url: '/goal-tracker', label: 'Set Your Score Target' };
      case 'INTENT_SCORE_IMPROVEMENT':
      case 'INTENT_GOAL_TRACKING':
        return { url: '/goal-tracker', label: 'Set a score goal' };
      case 'INTENT_SCORE_DIAGNOSIS':
      case 'INTENT_LOAN_ELIGIBILITY':
        return { url: '/credit-score', label: 'View your credit profile' };
    }
  }

  // Message keyword fallback
  if (/harass|recovery|agent|call|threat/i.test(lower)) {
    return { url: '/freed-shield', label: 'Explore FREED Shield' };
  }
  if (/score|cibil|credit.*report/i.test(lower)) {
    return { url: '/credit-score', label: 'View your credit profile' };
  }
  if (/consolidat|combine|single.*emi|multiple.*emi/i.test(lower)) {
    if (segment === 'DCP_Eligible') return { url: '/dcp', label: 'Explore Debt Consolidation' };
  }
  if (/settle|negoti|reduce.*debt|overdue/i.test(lower)) {
    if (segment === 'DRP_Eligible') return { url: '/drp', label: 'Explore Debt Resolution' };
  }

  // Segment-based default
  switch (segment) {
    case 'DRP_Eligible': return { url: '/drp', label: 'Explore Debt Resolution' };
    case 'DCP_Eligible': return { url: '/dcp', label: 'Explore Debt Consolidation' };
    case 'DEP': return { url: '/dep', label: 'Explore Debt Elimination' };
    default: return { url: '/credit-score', label: 'View your credit profile' };
  }
}

function buildSafeRedirectNudge(redirect: StructuredRedirect | undefined, ctx?: AdvisorContext): string | undefined {
  if (!redirect) return undefined;
  const name = ctx?.userName || 'You';

  // Contextual nudge variants to avoid repetition
  switch (redirect.url) {
    case '/drp': {
      const variants = [
        `${name}, FREED's Debt Resolution program can negotiate with your lenders to settle overdue accounts at a reduced amount.`,
        `FREED can help you resolve your overdue accounts through structured settlement. No upfront fees, just a single monthly contribution.`,
      ];
      if (ctx?.delinquentAccountCount && ctx.delinquentAccountCount > 0) {
        variants.push(`With ${ctx.delinquentAccountCount} overdue account${ctx.delinquentAccountCount > 1 ? 's' : ''}, FREED's settlement program could help you get a fresh start.`);
      }
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/dcp': {
      const variants = [
        `${name}, FREED's program can combine your loans into a single, lower EMI, simplifying your payments.`,
        `Explore how FREED can consolidate your EMIs into one manageable payment.`,
      ];
      if (ctx?.activeAccountCount && ctx.activeAccountCount > 2) {
        variants.push(`Managing ${ctx.activeAccountCount} separate EMIs is tough. FREED can help combine them into one.`);
      }
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/dep': {
      const variants = [
        `${name}, FREED's structured repayment plan can help you become debt-free faster while saving on interest.`,
        `Explore FREED's Debt Elimination program to optimize your repayment and save on interest.`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/credit-score': {
      const variants = [
        `${name}, check your detailed credit profile on FREED to see exactly where you stand.`,
        `Your full credit breakdown is available on FREED. See what's helping and hurting your score.`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/goal-tracker': {
      if (ctx?.scoreGapToTarget && ctx?.nextScoreTarget) {
        return `${name}, use FREED's Goal Tracker to monitor your ${ctx.scoreGapToTarget}-point journey to ${ctx.nextScoreTarget}.`;
      }
      const variants = [
        `${name}, set a target score on FREED's Goal Tracker and track your progress over time.`,
        `FREED's Goal Tracker can help you stay on course toward your credit score goals.`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/freed-shield': {
      const variants = [
        `${name}, FREED Shield can help you report harassment, upload evidence, and get complaints escalated to lenders.`,
        `Activate FREED Shield to document harassment incidents and protect your rights as a borrower.`,
        `FREED Shield provides a structured way to report and escalate recovery agent harassment.`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/dispute':
      return `${name}, use FREED's dispute tool to flag and correct errors on your credit report.`;
    default:
      return undefined;
  }
}

function buildMinimalSafeTurn(input: StructuredChatRequest, expectedFormatMode: StructuredFormatMode): StructuredAssistantTurn {
  const name = input.userName ?? input.advisorContext?.userName ?? null;
  const ctx = input.advisorContext;
  const facts = ctx?.relevantFacts.slice(0, expectedFormatMode === 'analysis' ? 4 : 3) || [];
  const opportunities = ctx?.topOpportunities.slice(0, 2).map(item => item.detail) || [];
  const greetingLike = FORMAT_KEYWORDS.plain.test(normalizeSpace(input.userMessage));
  const isFollowUp = getCurrentUserTurnCount(input.history, input.messageCount) > 1 || (input.history?.length ?? 0) > 0;
  // Build response body preview for contextual follow-ups
  const safeTurnBody = [...facts, ...opportunities].join(' ');
  const safeFollowUps = buildContextualFollowUps(ctx, input.userMessage, safeTurnBody);
  const goal = ctx?.financialGoal;
  const redirect = inferSafeRedirect(input.segment, input.intentTag, input.userMessage);
  const redirectNudge = greetingLike ? undefined : buildSafeRedirectNudge(redirect, ctx);

  if (expectedFormatMode === 'plain' && greetingLike) {
    let opening: string;
    if (isFollowUp) {
      opening = name ? `${name}, what would you like to look into next?` : 'What would you like to look into next?';
    } else if (name && goal && ctx?.creditScore) {
      opening = `Hi ${name}! Your score is ${ctx.creditScore} and your goal is ${goal.toLowerCase()}. Let's figure out the best path forward.`;
    } else if (name && ctx?.creditScore) {
      opening = `Hi ${name}! Your credit score is ${ctx.creditScore}. What would you like to explore first?`;
    } else if (name) {
      opening = `Hi ${name}! I'm here to help with your credit health. What would you like to know?`;
    } else {
      opening = 'Hi! I can help you understand your credit health. What would you like to know?';
    }
    return {
      formatMode: 'plain',
      opening,
      sections: [],
      followUps: safeFollowUps,
      redirect,
    };
  }

  if (expectedFormatMode === 'guided') {
    let opening: string;
    if (isFollowUp) {
      opening = name
        ? `${name}, here's what I found on that.`
        : 'Here\'s what I found on that.';
    } else if (name && ctx?.creditScore) {
      opening = `${name}, with a score of ${ctx.creditScore}, here's what stands out.`;
    } else if (name) {
      opening = `${name}, here's what your credit report shows.`;
    } else {
      opening = 'Here are the most relevant details from your credit report.';
    }
    return {
      formatMode: 'guided',
      opening,
      sections: [
        {
          style: 'bullet_list',
          items: facts.length > 0 ? facts.slice(0, 3) : ['I am keeping this answer grounded to the verified data we have for your account.'],
        },
      ],
      followUps: safeFollowUps,
      redirect,
      redirectNudge,
    };
  }

  let opening: string;
  if (isFollowUp) {
    opening = name
      ? `${name}, here's what I see on that.`
      : 'Here\'s what I see on that.';
  } else if (name && ctx?.creditScore) {
    opening = `${name}, your score is ${ctx.creditScore} across ${ctx?.activeAccountCount ?? 0} active accounts. Let me walk you through what matters most.`;
  } else if (name) {
    opening = `${name}, let me walk you through what your credit report shows.`;
  } else {
    opening = 'Let me walk you through what stands out in your credit report.';
  }

  return {
    formatMode: expectedFormatMode,
    opening,
    sections: [
      {
        title: 'What Needs Attention',
        style: 'bullet_list',
        items: facts.length > 0 ? facts.slice(0, 3) : ['I am keeping this answer strictly tied to the verified report data.'],
      },
      {
        title: 'Your Best Next Steps',
        style: 'bullet_list',
        items: opportunities.length > 0 ? opportunities.slice(0, 2) : ['Let me know whether your priority is score improvement, payment pressure, or loan eligibility, and I will narrow down the best next step for you.'],
      },
    ],
    followUps: safeFollowUps,
    redirect,
    redirectNudge,
  };
}

// Issues that indicate factual hallucination -these justify falling back to safe turn
// Issues that ALWAYS warrant safe turn fallback -must be truly broken, not just imperfect
const CRITICAL_BODY_ISSUES = new Set([
  'credit score mention does not match grounded data',
  'body is empty after sanitization',
  'opening is required',
]);

// Issues that warrant repair attempt but NOT safe turn fallback -the LLM response is
// usable even with these, and stripping/sanitization already handled them
const REPAIRABLE_BODY_ISSUES = new Set([
  'body still contains unsupported lender claims',
  'card lender is still described as a business loan',
]);

function hasCriticalBodyIssues(issues: string[]): boolean {
  return issues.some(issue => CRITICAL_BODY_ISSUES.has(issue));
}

function hasRepairableBodyIssues(issues: string[]): boolean {
  return issues.some(issue => REPAIRABLE_BODY_ISSUES.has(issue));
}

async function finalizeStructuredTurn(
  candidate: StructuredAssistantTurn,
  input: StructuredChatRequest,
  allowRepair: boolean
): Promise<ChatResponse> {
  const expectedFormatMode = determineExpectedFormatMode(input.userMessage, input.history, input.advisorContext);
  let turn = sanitizeStructuredTurn(candidate, input.grounding);
  let validation = validateStructuredTurn(turn, expectedFormatMode, input.advisorContext, input.grounding);

  const repairStart = Date.now();

  // Only attempt repair for truly critical issues (wrong score, empty body)
  if (allowRepair && process.env.OPENAI_API_KEY && hasCriticalBodyIssues(validation.bodyIssues)) {
    while (Date.now() - repairStart < REPAIR_BUDGET_MS && hasCriticalBodyIssues(validation.bodyIssues)) {
      const repaired = await repairStructuredTurn(input, expectedFormatMode, turn, validation);
      if (!repaired) break;
      turn = sanitizeStructuredTurn(repaired, input.grounding);
      validation = validateStructuredTurn(turn, expectedFormatMode, input.advisorContext, input.grounding);
    }
  }

  // Only fall back to safe turn for truly critical issues (wrong score, empty body)
  if (hasCriticalBodyIssues(validation.bodyIssues)) {
    console.warn('[PIPELINE] Critical issues after repair -safe turn fallback. Issues:', validation.bodyIssues);
    turn = buildMinimalSafeTurn(input, expectedFormatMode);
    turn = sanitizeStructuredTurn(turn, input.grounding);
    validation = validateStructuredTurn(turn, expectedFormatMode, input.advisorContext, input.grounding);
  } else if (hasRepairableBodyIssues(validation.bodyIssues)) {
    // Lender claim / card label issues -sanitization already stripped the bad lines.
    // Accept the response as-is rather than discarding the entire LLM output.
    console.log('[PIPELINE] Repairable issues (accepted after sanitization):', validation.bodyIssues);
  } else if (validation.bodyIssues.length > 0) {
    console.log('[PIPELINE] Non-critical format issues (accepted):', validation.bodyIssues);
  }

  if (allowRepair && process.env.OPENAI_API_KEY && validation.followUpIssues.length > 0 && Date.now() - repairStart < REPAIR_BUDGET_MS) {
    // One repair attempt for follow-ups, not a loop
    const repairedFollowUps = await repairFollowUps(input, expectedFormatMode, turn, validation.followUpIssues);
    if (repairedFollowUps) {
      turn = sanitizeStructuredTurn({ ...turn, followUps: repairedFollowUps }, input.grounding);
      validation = validateStructuredTurn(turn, expectedFormatMode, input.advisorContext, input.grounding);
    }
  }

  if (validation.followUpIssues.length > 0) {
    // Try to salvage non-generic LLM follow-ups before falling back entirely
    const goodFollowUps = turn.followUps.filter(fu => !containsGenericFollowUp(fu) && fu.length >= 8 && fu.length <= 100);

    if (goodFollowUps.length >= MAX_FOLLOW_UPS) {
      // LLM follow-ups are fine individually -keep them
      console.log('[PIPELINE] Follow-up validation had minor issues -keeping LLM follow-ups');
      turn = { ...turn, followUps: goodFollowUps.slice(0, MAX_FOLLOW_UPS) };
    } else {
      // Supplement with contextual follow-ups derived from the response body
      const responseBody = renderBodyPreview(turn);
      const contextFollowUps = buildContextualFollowUps(input.advisorContext, input.userMessage, responseBody);
      const merged: string[] = [...goodFollowUps];
      for (const safe of contextFollowUps) {
        if (merged.length >= MAX_FOLLOW_UPS) break;
        if (!merged.some(existing => existing.toLowerCase().slice(0, 40) === safe.toLowerCase().slice(0, 40))) {
          merged.push(safe);
        }
      }
      if (merged.length > 0) {
        console.log(`[PIPELINE] Follow-up validation: kept ${goodFollowUps.length} LLM + ${merged.length - goodFollowUps.length} contextual`);
        turn = { ...turn, followUps: merged.slice(0, MAX_FOLLOW_UPS) };
      } else {
        turn = sanitizeStructuredTurn({
          ...turn,
          followUps: [],
        }, input.grounding);
      }
    }
  }

  // ── Post-generation repetition guard ──
  // Compare the new response against prior responses at the section level.
  // If structural repetition is detected, strip duplicate sections and keep
  // only genuinely new content. This is the code-side safety net that catches
  // what prompt rules cannot guarantee.
  const repetitionCheck = detectRepetitiveSections(turn, input.history);
  if (repetitionCheck.isDuplicate && repetitionCheck.duplicateSectionIndices.length > 0) {
    console.log(`[PIPELINE] Repetition guard: ${repetitionCheck.overlapRatio.toFixed(2)} overlap ratio, removing ${repetitionCheck.duplicateSectionIndices.length} duplicate section(s)`);
    const filteredSections = turn.sections.filter((_s, idx) => !repetitionCheck.duplicateSectionIndices.includes(idx));
    // Keep at least one section — if all are duplicates, keep the last one
    // and modify the opening to acknowledge the prior answer
    if (filteredSections.length === 0 && turn.sections.length > 0) {
      const lastSection = turn.sections[turn.sections.length - 1];
      filteredSections.push(lastSection);
    }
    // Adjust opening if we stripped sections — acknowledge continuity
    const name = input.userName ?? input.advisorContext?.userName ?? '';
    const adjustedOpening = filteredSections.length < turn.sections.length
      ? `Building on what we discussed${name ? `, ${name.split(' ')[0]}` : ''}, let me go deeper.`
      : turn.opening;
    turn = { ...turn, sections: filteredSections, opening: adjustedOpening };
  }

  // ── Follow-up deduplication against prior conversation follow-ups ──
  const priorFollowUps = extractPriorFollowUps(input.history.slice(-6));
  if (priorFollowUps.length > 0 && turn.followUps.length > 0) {
    const priorKeys = new Set(priorFollowUps.map(fu => fu.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()));
    const dedupedFollowUps = turn.followUps.filter(fu => {
      const key = fu.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      // Check exact match
      if (priorKeys.has(key)) return false;
      // Check high similarity (shared prefix of 30+ chars)
      for (const priorKey of priorKeys) {
        const minLen = Math.min(key.length, priorKey.length);
        if (minLen >= 30) {
          const prefixLen = Math.min(30, minLen);
          if (key.slice(0, prefixLen) === priorKey.slice(0, prefixLen)) return false;
        }
      }
      return true;
    });

    if (dedupedFollowUps.length < turn.followUps.length) {
      console.log(`[PIPELINE] Follow-up dedup: removed ${turn.followUps.length - dedupedFollowUps.length} duplicate(s) from prior turns`);
      // If we lost follow-ups to dedup, try to fill from contextual follow-ups
      if (dedupedFollowUps.length < MAX_FOLLOW_UPS) {
        const responseBody = renderBodyPreview(turn);
        const contextFollowUps = buildContextualFollowUps(input.advisorContext, input.userMessage, responseBody);
        for (const safe of contextFollowUps) {
          if (dedupedFollowUps.length >= MAX_FOLLOW_UPS) break;
          const safeKey = safe.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
          if (!priorKeys.has(safeKey) && !dedupedFollowUps.some(existing => existing.toLowerCase().slice(0, 40) === safe.toLowerCase().slice(0, 40))) {
            dedupedFollowUps.push(safe);
          }
        }
      }
      turn = { ...turn, followUps: dedupedFollowUps.slice(0, MAX_FOLLOW_UPS) };
    }
  }

  // ── Follow-up decay: reduce follow-ups as conversation deepens ──
  // Early messages (1-4): full 3 follow-ups to guide exploration
  // Mid conversation (5-6): 2 follow-ups — user has context, fewer nudges needed
  // Deep conversation (7-8): 1 follow-up — by now the solution has been pitched
  // Very deep (9+): 0 follow-ups — only the redirect CTA remains
  const depth = getCurrentUserTurnCount(input.history, input.messageCount);
  if (depth >= 9) {
    turn = { ...turn, followUps: [] };
  } else if (depth >= 7) {
    turn = { ...turn, followUps: turn.followUps.slice(0, 1) };
  } else if (depth >= 5) {
    turn = { ...turn, followUps: turn.followUps.slice(0, 2) };
  }

  // ── Delinquent count correction ──
  // The LLM sometimes miscounts overdue accounts by counting from the account list
  // instead of using the authoritative delinquentAccountCount from advisor_context.
  // This deterministic post-processor fixes the number in the rendered output.
  const ctx = input.advisorContext;
  console.log(`[PIPELINE] Delinquent check: ctx=${!!ctx}, count=${ctx?.delinquentAccountCount}, detailAvail=${ctx?.delinquentDetailAvailable}`);
  if (ctx && ctx.delinquentAccountCount > 0) {
    const correctCount = ctx.delinquentAccountCount;
    // Fix patterns like "X overdue accounts" or "**X overdue accounts**"
    // Handles markdown bold (**) around numbers
    const delinqCountPattern = /(\*{0,2})(\d+)(\*{0,2})\s*(overdue|delinquent)\s*(accounts?)/gi;
    const fixDelinqCount = (text: string): string => {
      return text.replace(delinqCountPattern, (match, preBold, num, postBold, adj, noun) => {
        const mentioned = parseInt(num, 10);
        if (mentioned !== correctCount && mentioned > 0) {
          console.log(`[PIPELINE] Delinquent count correction: ${mentioned} → ${correctCount}`);
          return `${preBold}${correctCount}${postBold} ${adj} ${noun}`;
        }
        return match;
      });
    };
    for (const section of turn.sections) {
      section.items = section.items.map(fixDelinqCount);
    }
    if (turn.opening) {
      turn.opening = fixDelinqCount(turn.opening);
    }
  }

  // ── Strip sections that will be replaced by inline widgets ──
  if (input.intentTag === 'INTENT_SCORE_IMPROVEMENT' || input.intentTag === 'INTENT_CREDIT_SCORE_TARGET') {
    turn.sections = turn.sections.filter(s => !/tracking.*progress/i.test(s.title || ''));
  }
  if (input.intentTag === 'INTENT_HARASSMENT') {
    // Force analysis mode for all harassment responses so section titles render as bold headings
    turn = { ...turn, formatMode: 'analysis' };
    // First harassment response: carousel replaces "crosses the line" section
    turn.sections = turn.sections.filter(s => !/crosses.*line/i.test(s.title || ''));

    // Post-lender-selection: strip "what you might be facing" (covered in first response)
    const lenderSelectionRe = /selected.*lender|harassing.*lender|facing harassment from|PayU|WORTGAGE|ARKA|Krazybee/i;
    const hasLenderSelection =
      lenderSelectionRe.test(input.userMessage) ||
      input.history.some((m: any) => m.role === 'user' && lenderSelectionRe.test(m.content));
    if (hasLenderSelection) {
      turn.sections = turn.sections.filter(s =>
        !/what you might be facing/i.test(s.title || '') &&
        !/what counts as harassment/i.test(s.title || '')
      );
    }
  }

  return renderStructuredTurn(turn);
}

export async function finalizeStructuredTurnCandidate(input: {
  candidate: StructuredAssistantTurn;
  context: StructuredChatRequest;
  allowRepair?: boolean;
}): Promise<ChatResponse> {
  return await finalizeStructuredTurn(input.candidate, input.context, input.allowRepair ?? false);
}

export function debugStructuredTurnCandidate(input: {
  candidate: StructuredAssistantTurn;
  context: StructuredChatRequest;
}): {
  expectedFormatMode: StructuredFormatMode;
  sanitized: StructuredAssistantTurn;
  validation: TurnValidation;
} {
  const expectedFormatMode = determineExpectedFormatMode(input.context.userMessage, input.context.history, input.context.advisorContext);
  const sanitized = sanitizeStructuredTurn(input.candidate, input.context.grounding);
  const validation = validateStructuredTurn(sanitized, expectedFormatMode, input.context.advisorContext, input.context.grounding);
  return { expectedFormatMode, sanitized, validation };
}

export function debugStructuredPayload(input: StructuredChatRequest): StructuredModelPayload {
  const expectedFormatMode = determineExpectedFormatMode(input.userMessage, input.history, input.advisorContext);
  return buildStructuredPayload(input, expectedFormatMode);
}

export async function getChatResponse(input: StructuredChatRequest): Promise<ChatResponse> {
  const pipelineStart = Date.now();
  const expectedFormatMode = determineExpectedFormatMode(input.userMessage, input.history, input.advisorContext);
  console.log(`[PIPELINE] formatMode=${expectedFormatMode} message="${input.userMessage.substring(0, 60)}"`);

  if (!process.env.OPENAI_API_KEY) {
    return renderStructuredTurn(buildMinimalSafeTurn(input, expectedFormatMode));
  }

  const llmStart = Date.now();
  const generated = await requestStructuredTurn(input, expectedFormatMode);
  console.log(`[PIPELINE] LLM call: ${Date.now() - llmStart}ms`);
  if (!generated) {
    console.warn('[PIPELINE] LLM returned null -using safe fallback');
    return renderStructuredTurn(buildMinimalSafeTurn(input, expectedFormatMode));
  }

  const result = await finalizeStructuredTurn(generated, input, true);
  console.log(`[PIPELINE] Total: ${Date.now() - pipelineStart}ms`);
  return result;
}
