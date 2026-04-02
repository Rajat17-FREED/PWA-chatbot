/**
 * Edge Case Handler — two-tier detection for non-financial messages.
 *
 * Tier 1 (regex): Fast-path for obvious cases.
 *   - Financial keywords → skip to main pipeline immediately.
 *   - Pure gibberish (no letters) → static response.
 *
 * Tier 2 (LLM): gpt-4o-mini classifies + generates response in ONE call.
 *   - Catches greetings, abuse, off-topic, thanks, goodbyes, etc.
 *   - Returns fresh, contextual responses (not canned).
 *   - If the LLM classifies as "financial" → returns null, proceeds to main pipeline.
 *
 * This ensures the main financial pipeline (RAG, advisor context, gpt-4o)
 * is only invoked for genuine financial questions.
 */

import OpenAI from 'openai';

let openai: OpenAI;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

export interface EdgeCaseResponse {
  reply: string;
  followUps: string[];
}

// ── Financial keyword fast-path ──────────────────────────────────────────────
// If ANY of these appear, the message is financial — skip edge case detection.
const FINANCIAL_KEYWORDS = /\b(loans?|emis?|credits?|scores?|debts?|interests?|banks?|lenders?|payments?|repay|overdue|cibil|settlement|consolidat|eliminat|harass|recovery|mortgage|insurance|invest|savings?|budget|expenses?|income|salary|outstanding|dpd|delinquent|default|npa|refinanc|prepay|foreclos|foir|obligation|tenure|principal|collateral|guarantor|surety|nbfc|rbi|bureau|owe|owing|borrow|borrowing|afford|financial|money\s*(problem|issue|trouble|stress|worry)|freed\s*(shield|program|plan|drp|dcp|dep)?|drp|dcp|dep|snowball|avalanche|karz|karza?|byaaj|byaj|kist|qist|paisa|paise|rupay|rupaiya|udhar|udhaar|baki|baaki|qarz|mahina|kharcha|kamaai|tankhwah|jama|bachat|faayda|nuksan|lena\s*dena|dena|chukana|bharna|dhandha|jimmedari|zimmedari)\b/i;

// ── FREED-contextual fast-path ─────────────────────────────────────────────
// Questions about FREED, its products, or how it can help are ALWAYS financial.
// This catches Hinglish follow-ups like "FREED kaise help karega?" that lack
// standard financial keywords but clearly belong in the main pipeline.
const FREED_CONTEXT_KEYWORDS = /freed|shield|program|plan|drp\b|dcp\b|dep\b|settlement\s*plan|debt\s*free|kaisa.*help|kaise.*help|kya.*kar\s*sakt|madad|sahayata|suvidha|fayda|benefit|option|feature|service/i;

// ── Gibberish fast-path ──────────────────────────────────────────────────────
// No letters at all, or same char 5+ times — obviously not a question.
const GIBBERISH_PATTERNS = [
  /^[^a-zA-Z\u0900-\u097F]*$/,     // No alphabetic chars at all
  /^(.)\1{4,}$/i,                   // Same char repeated 5+ times
  /^[!@#$%^&*()_+=<>?/\\|{}[\]~`]+$/, // Only special characters
  /^[a-z]\s*$/i,                    // Single letter
];

// ── LLM classification schema ────────────────────────────────────────────────

const EDGE_CASE_SCHEMA = {
  name: 'edge_case_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      is_financial: {
        type: 'boolean',
        description: 'true if the message is about credit, loans, debt, EMIs, financial planning, or any topic FREED can help with. false if it is a greeting, abuse, off-topic, thanks, goodbye, etc.',
      },
      category: {
        type: 'string',
        enum: ['greeting', 'abuse', 'thanks', 'goodbye', 'identity', 'off_topic', 'personal_bot', 'capabilities', 'acknowledgement', 'financial'],
        description: 'The detected category of the message.',
      },
      reply: {
        type: 'string',
        description: 'A friendly, contextual response. Only used if is_financial is false.',
      },
      follow_ups: {
        type: 'array',
        items: { type: 'string' },
        description: '2-3 financial follow-up suggestions to guide user back to relevant topics.',
      },
    },
    required: ['is_financial', 'category', 'reply', 'follow_ups'],
    additionalProperties: false,
  },
};

function buildClassifierPrompt(userName: string | null): string {
  const name = userName ? `The user's name is ${userName}. Address them by name.` : 'The user has not been identified yet.';

  return `You are an edge-case classifier for FREED, India's debt relief chatbot.

${name}

Your job: Determine if the user's message should go to the main financial advisor pipeline (is_financial: true) or be handled here as a non-financial edge case (is_financial: false).

CRITICAL DEFAULT RULE — WHEN IN DOUBT, SET is_financial: true.
The main pipeline is robust and handles ambiguous messages well. A false positive (sending a non-financial message to the main pipeline) is HARMLESS. A false negative (intercepting a financial message here) gives the user a BAD, GENERIC response. ALWAYS err on the side of is_financial: true.

RULES:
- is_financial: true for ANY message that could relate to: money, debt, loans, EMIs, credit, repayment, lenders, banks, financial stress, harassment, recovery agents, FREED products (Shield, DRP, DCP, DEP), or asking about how FREED/this chatbot can help with their finances.
- is_financial: true for Hindi/Hinglish messages about financial topics — users in India commonly mix Hindi and English. Examples: "mera loan kaise band hoga", "EMI bahut zyada hai", "FREED kaise help karega", "karz se kaise chhutkara milega", "harass ho raha hoon".
- is_financial: true for follow-up questions in a financial conversation — "how does this work?", "tell me more", "what are the benefits?", "kaise kaam karta hai?" — these refer to the financial topic being discussed.
- is_financial: true for questions about THIS chatbot's capabilities when asked in a financial context — "How can you help me?", "What can you do for me?" — because the user is asking about financial help.
- ONLY set is_financial: false for messages that are CLEARLY and UNAMBIGUOUSLY non-financial:
  * Pure greetings with zero financial content: "hi", "hello", "namaste", "kya haal hai"
  * Pure abuse with no financial frustration: random insults not about debt/money
  * Completely off-topic: "what's the weather?", "tell me a joke", "who is the PM?"
  * Pure acknowledgements: "ok", "hmm", "yes", "theek hai" (with no follow-up question)
  * Pure thanks/goodbye: "thanks", "bye", "dhanyavaad"
- For non-financial messages: generate a FRESH, friendly response. Be warm and professional.
- For abuse: respond with empathy (debt is stressful), never mirror negativity.
- ALWAYS include 2-3 follow-up suggestions that are financial questions.
- Keep responses concise (2-3 sentences max).
- Do NOT use emojis.

EXAMPLES:
- "I want a loan" → financial
- "Hi, tell me about my debt" → financial (financial intent overrides greeting)
- "How can FREED Shield help me?" → financial (asking about FREED product)
- "FREED kaise kaam karta hai?" → financial (asking about FREED in Hindi)
- "mujhe harassment calls aarhe h" → financial (creditor harassment)
- "kya options hain mere liye?" → financial (asking about options in financial context)
- "What is this?" / "What do you do?" → financial (user is asking what FREED can do for them)
- "Ok" / "Hmm" → NOT financial (pure acknowledgement)
- "You're useless" → NOT financial (pure abuse)
- "Thanks for the info" → NOT financial (pure thanks)
- "Namaste" → NOT financial (pure greeting)`;
}

interface LLMEdgeCaseResult {
  is_financial: boolean;
  category: string;
  reply: string;
  follow_ups: string[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect if a message is an edge case and return an appropriate response.
 *
 * Returns EdgeCaseResponse for non-financial messages, or null to proceed
 * with the full financial pipeline.
 *
 * Three-tier approach:
 * 1. Financial keyword regex → null (fast skip)
 * 2. Gibberish regex → static response (no LLM needed)
 * 3. LLM classifier (gpt-4o-mini) → classifies + generates fresh response
 */
export async function detectEdgeCase(
  message: string,
  userName: string | null,
): Promise<EdgeCaseResponse | null> {
  const trimmed = message.trim();

  // ── Tier 1a: Financial keywords → skip immediately ──
  if (FINANCIAL_KEYWORDS.test(trimmed)) {
    return null;
  }

  // ── Tier 1a2: FREED-contextual keywords → skip immediately ──
  // Catches "How can FREED Shield help me?", "FREED kaise kaam karta hai?", etc.
  if (FREED_CONTEXT_KEYWORDS.test(trimmed)) {
    return null;
  }

  // ── Tier 1b: Long messages likely financial even without keywords ──
  if (trimmed.length > 120) {
    return null;
  }

  // ── Tier 1c: Gibberish → static response (no LLM cost) ──
  for (const pattern of GIBBERISH_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[EdgeCase] Gibberish detected → "${trimmed.substring(0, 30)}"`);
      return {
        reply: `Hmm, I couldn't quite understand that${userName ? `, ${userName}` : ''}. Could you try asking me something about your credit score, loans, or EMIs? I'm best at those!`,
        followUps: [
          'How can I improve my credit score?',
          'What does my financial profile look like?',
          'I want to reduce my monthly EMI burden',
        ],
      };
    }
  }

  // ── Tier 2: LLM classifier (gpt-4o-mini) ──
  try {
    const startTime = Date.now();
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 250,
      response_format: {
        type: 'json_schema',
        json_schema: EDGE_CASE_SCHEMA,
      } as never,
      messages: [
        { role: 'system', content: buildClassifierPrompt(userName) },
        { role: 'user', content: trimmed },
      ],
    } as never);

    const content = (response as any).choices?.[0]?.message?.content;
    if (!content) {
      console.log('[EdgeCase] LLM returned empty — falling through to main pipeline');
      return null;
    }

    const result: LLMEdgeCaseResult = JSON.parse(content);
    const elapsed = Date.now() - startTime;

    if (result.is_financial) {
      console.log(`[EdgeCase] LLM classified as financial (${elapsed}ms) → proceeding to main pipeline`);
      return null;
    }

    console.log(`[EdgeCase] LLM classified: ${result.category} (${elapsed}ms) → "${trimmed.substring(0, 40)}"`);
    return {
      reply: result.reply,
      followUps: result.follow_ups?.slice(0, 3) ?? [],
    };
  } catch (err) {
    // LLM failure → fall through to main pipeline (safe default)
    console.error('[EdgeCase] LLM classifier failed, falling through:', (err as Error).message);
    return null;
  }
}
