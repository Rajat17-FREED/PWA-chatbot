import OpenAI from 'openai';
import {
  AdvisorContext,
  ChatMessage,
  ChatResponse,
  ClosingQuestionContract,
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
  advisor_context: AdvisorContext | null;
  grounding_context: ResponseGroundingContext | null;
  knowledge_snippets: string;
  allowed_redirect_routes: string[];
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
  return text.replace(/\s*[\u2013\u2014]\s*/g, ' - ').replace(/[\u2013\u2014]/g, '-');
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
  corrected = normalizeUtilizationNearLenders(corrected, grounding);
  corrected = normalizeCardAccountMentions(corrected, grounding);
  corrected = enforceKnownCreditScore(corrected, grounding);
  corrected = stripUnknownLenderClaims(corrected, grounding);

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

function normalizeClosingQuestion(question: ClosingQuestionContract | undefined, grounding?: ResponseGroundingContext): ClosingQuestionContract | undefined {
  if (!question) return undefined;

  let text = normalizeTextValue(question.text || '', grounding);
  const providedOptions = (question.options || []).map(option => cleanOption(normalizeTextValue(option, grounding))).filter(Boolean);
  const options: string[] = [];
  for (const option of providedOptions) uniquePush(options, option);
  if (options.length < 2) {
    for (const option of extractQuestionOptions(text)) {
      uniquePush(options, option);
    }
  }

  if (!text || options.length < 2) return undefined;
  if (!text.endsWith('?')) text = `${text}?`;

  return {
    text,
    options: options.slice(0, 3),
  };
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

  const closingQuestion = normalizeClosingQuestion(turn.closingQuestion, grounding);
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
    closingQuestion,
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

/**
 * Extract topics already covered in prior assistant messages to prevent repetition.
 * Scans assistant messages in history for common data-point patterns and returns
 * a concise list of what's been stated so the LLM knows not to repeat it.
 */
function extractTopicsCovered(history: ChatMessage[]): string[] {
  const assistantMessages = history
    .filter(m => m.role === 'assistant')
    .map(m => m.content);

  if (assistantMessages.length === 0) return [];

  const topics: string[] = [];
  const combined = assistantMessages.join(' ');

  // Detect profile snapshot patterns
  if (/credit score\b.*\b\d{3}\b/i.test(combined)) topics.push('credit score value');
  if (/\bactive accounts?\b.*\b\d+\b/i.test(combined) || /\b\d+\s*active accounts?\b/i.test(combined)) topics.push('active account count');
  if (/\bfoir\b.*\b\d+%?/i.test(combined) || /\b\d+%?\s*(?:of (?:your )?income|foir)\b/i.test(combined)) topics.push('FOIR percentage');
  if (/total outstanding\b.*₹/i.test(combined) || /₹[\d,]+.*outstanding/i.test(combined)) topics.push('total outstanding amount');
  if (/utilization\b.*\b\d+%/i.test(combined) || /\b\d+%\s*utilization\b/i.test(combined)) topics.push('card utilization');
  if (/on.?time.*\b\d+%/i.test(combined) || /payment.*history/i.test(combined)) topics.push('payment history');
  if (/enquir(?:y|ies)\b.*\b\d+\b/i.test(combined)) topics.push('enquiry count');
  if (/delinquen|overdue.*account/i.test(combined)) topics.push('overdue/delinquent accounts');
  if (/\bgoal tracker\b/i.test(combined)) topics.push('Goal Tracker recommendation');
  if (/\bcredit insights?\b/i.test(combined)) topics.push('Credit Insights recommendation');
  if (/\bfreed shield\b/i.test(combined)) topics.push('FREED Shield recommendation');
  if (/\b(?:dep|debt elimination)\b/i.test(combined)) topics.push('DEP program');
  if (/\b(?:dcp|debt consolidation)\b/i.test(combined)) topics.push('DCP program');
  if (/\b(?:drp|debt resolution)\b/i.test(combined)) topics.push('DRP program');
  if (/consolidation.*(?:emi|save|₹)/i.test(combined)) topics.push('consolidation savings calculation');

  return topics;
}

function buildStructuredPayload(input: StructuredChatRequest, expectedFormatMode: StructuredFormatMode): StructuredModelPayload {
  const historyPreview = input.history.slice(-6).map(message => ({
    role: message.role,
    content: shortenText(stripNextStepsBlock(stripMarkdownLinks(stripEmDashes(message.content))), 280),
  }));

  const topicsCovered = extractTopicsCovered(input.history.slice(-6));

  return {
    user_message: input.userMessage,
    expected_format_mode: expectedFormatMode,
    message_count: input.messageCount ?? input.history.length,
    user_name: input.userName ?? input.advisorContext?.userName ?? null,
    segment: input.segment ?? input.advisorContext?.segment ?? null,
    intent_tag: input.intentTag,
    recent_history: historyPreview,
    topics_already_covered: topicsCovered,
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
    // Keep assistant messages at 500 chars (enough to preserve key data points)
    // Keep user messages at 300 chars (captures full intent)
    const maxLen = msg.role === 'assistant' ? 500 : 300;
    messages.push({
      role: msg.role,
      content: shortenText(cleaned, maxLen),
    });
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
    temperature: 0.2,
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
    closing_question: turn.closingQuestion ?? null,
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
  if (turn.closingQuestion?.text) parts.push(turn.closingQuestion.text);
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

  if (turn.closingQuestion) {
    const options = turn.closingQuestion.options;
    const coverage = optionCoverage(followUps, options);
    if (options.length === 2) {
      if (coverage.covered < 2) {
        issues.push('followUps do not map to both question options');
      }
    } else if (options.length >= 3) {
      if (coverage.covered < Math.min(MAX_FOLLOW_UPS, options.length)) {
        issues.push('followUps do not map to each closing question option');
      }
    }
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
    lines.push(section.title.toUpperCase());
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

function renderStructuredTurn(turn: StructuredAssistantTurn): ChatResponse {
  const parts: string[] = [];
  if (turn.opening) parts.push(turn.opening);

  for (const section of turn.sections) {
    const rendered = renderSection(section, turn.formatMode);
    if (rendered) parts.push(rendered);
  }

  if (turn.closingQuestion?.text) {
    parts.push(turn.closingQuestion.text);
  }

  // Natural product nudge -ties the redirect to the user's specific situation
  if (turn.redirectNudge && turn.redirect) {
    parts.push(turn.redirectNudge);
  }

  // Follow-ups are shown as interactive chips below the message -no need to duplicate them in the body

  const reply = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    reply,
    followUps: turn.followUps.slice(0, MAX_FOLLOW_UPS),
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
        `FREED can help you resolve your overdue accounts through structured settlement -- no upfront fees, single monthly contribution.`,
      ];
      if (ctx?.delinquentAccountCount && ctx.delinquentAccountCount > 0) {
        variants.push(`With ${ctx.delinquentAccountCount} overdue account${ctx.delinquentAccountCount > 1 ? 's' : ''}, FREED's settlement program could help you get a fresh start.`);
      }
      return variants[Math.floor(Math.random() * variants.length)];
    }
    case '/dcp': {
      const variants = [
        `${name}, FREED's program can combine your loans into a single, lower EMI -- simplifying your payments.`,
        `Explore how FREED can consolidate your EMIs into one manageable payment.`,
      ];
      if (ctx?.activeAccountCount && ctx.activeAccountCount > 2) {
        variants.push(`Managing ${ctx.activeAccountCount} separate EMIs is tough -- FREED can help combine them into one.`);
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
        `Your full credit breakdown is available on FREED -- see what's helping and hurting your score.`,
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
  // Build response body preview for contextual follow-ups
  const safeTurnBody = [...facts, ...opportunities].join(' ');
  const safeFollowUps = buildContextualFollowUps(ctx, input.userMessage, safeTurnBody);
  const goal = ctx?.financialGoal;
  const redirect = inferSafeRedirect(input.segment, input.intentTag, input.userMessage);
  const redirectNudge = greetingLike ? undefined : buildSafeRedirectNudge(redirect, ctx);

  if (expectedFormatMode === 'plain' && greetingLike) {
    let opening: string;
    if (name && goal) {
      opening = `Hi ${name}! I have your profile loaded and I can see your goal is ${goal.toLowerCase()} -- I'm here to help you with that, along with your credit score and accounts.`;
    } else if (name) {
      opening = `Hi ${name}! I have your profile ready. I'm here to help with your credit score, accounts, or any repayment questions you have.`;
    } else {
      opening = 'Welcome! I am here to help with your credit profile, score, and repayment questions.';
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
    if (name && ctx?.creditScore) {
      opening = `Good question, ${name}! I looked into your profile -- with a score of ${ctx.creditScore}, here's what stands out.`;
    } else if (name) {
      opening = `Let me dig into that for you, ${name}. Based on your current report, here's what I found.`;
    } else {
      opening = 'Good question! Based on your current report, here are the most relevant details.';
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
  if (name && ctx?.creditScore) {
    opening = `Here's the full picture from your report, ${name}. Your score is ${ctx.creditScore} and there are ${ctx?.activeAccountCount ?? 0} active accounts to consider.`;
  } else if (name) {
    opening = `Let me break this down for you, ${name}. Here's what your report tells us.`;
  } else {
    opening = 'Let me break this down for you. Here is the clearest view from the data right now.';
  }

  return {
    formatMode: expectedFormatMode,
    opening,
    sections: [
      {
        title: 'KEY RISKS',
        style: 'bullet_list',
        items: facts.length > 0 ? facts.slice(0, 3) : ['I am keeping this answer strictly tied to the verified report data.'],
      },
      {
        title: 'BEST LEVERS',
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
        turn = { ...turn, closingQuestion: undefined, followUps: merged.slice(0, MAX_FOLLOW_UPS) };
      } else {
        turn = sanitizeStructuredTurn({
          ...turn,
          closingQuestion: undefined,
          followUps: [],
        }, input.grounding);
      }
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
