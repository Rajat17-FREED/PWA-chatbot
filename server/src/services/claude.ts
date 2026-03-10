import OpenAI from 'openai';
import { ChatMessage, ChatResponse } from '../types';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// ─── Entity Extraction ───────────────────────────────────────────────────────

/** Extract specific entities (lenders, amounts, programs, topics) from reply text */
function extractEntities(reply: string) {
  const lenders: string[] = [];
  const amounts: string[] = [];
  const programs: string[] = [];
  const topics: string[] = [];

  const KNOWN_LENDERS = [
    'Axis Bank', 'HDFC', 'SBI', 'Bajaj Finance', 'Kotak', 'ICICI',
    'Bandhan Bank', 'HDB Financial', 'Suryoday', 'Ananya Finance', 'Yes Bank',
    'IndusInd', 'RBL Bank', 'Tata Capital', 'Muthoot', 'Manappuram',
    'Capital First', 'Piramal', 'L&T Finance', 'Mahindra Finance',
  ];

  for (const lender of KNOWN_LENDERS) {
    if (reply.toLowerCase().includes(lender.toLowerCase())) {
      lenders.push(lender);
    }
  }

  // Extract INR amounts (e.g. ₹31,012)
  const amountMatches = reply.match(/₹[\d,]+/g);
  if (amountMatches) amounts.push(...amountMatches.slice(0, 3));

  const PROGRAM_KEYWORDS: Record<string, string> = {
    'debt resolution': 'DRP', 'drp': 'DRP', 'settlement': 'DRP',
    'debt consolidation': 'DCP', 'dcp': 'DCP', 'consolidat': 'DCP',
    'debt elimination': 'DEP', 'dep': 'DEP',
    'freed shield': 'FREED Shield', 'shield': 'FREED Shield',
    'credit insights': 'Credit Insights', 'goal tracker': 'Goal Tracker',
  };

  const lower = reply.toLowerCase();
  for (const [kw, prog] of Object.entries(PROGRAM_KEYWORDS)) {
    if (lower.includes(kw) && !programs.includes(prog)) programs.push(prog);
  }

  const TOPIC_KEYWORDS: Record<string, string> = {
    'payment history': 'payment history', 'on-time': 'on-time payments',
    'credit utilization': 'credit utilization', 'utilization': 'utilization',
    'credit age': 'credit age', 'credit history': 'credit age',
    'credit mix': 'credit mix', 'secured': 'credit mix',
    'enquir': 'enquiries', 'hard inquiry': 'enquiries',
    'credit score': 'credit score', 'cibil': 'credit score',
    'delinquen': 'delinquency', 'overdue': 'overdue',
    'emi': 'EMI', 'foir': 'FOIR', 'harass': 'harassment',
    'recovery agent': 'recovery agents', 'interest': 'interest rate',
    'eligib': 'eligibility', 'ineligib': 'ineligibility',
    'income': 'income', 'obligation': 'monthly obligation',
  };

  for (const [kw, topic] of Object.entries(TOPIC_KEYWORDS)) {
    if (lower.includes(kw) && !topics.includes(topic)) topics.push(topic);
  }

  return { lenders, amounts, programs, topics };
}

// ─── Closing Question Detection ───────────────────────────────────────────────

/**
 * Extract the last question from the bot's response.
 * Returns null if no clear closing question found.
 */
function extractClosingQuestion(reply: string): string | null {
  // Find sentences ending with '?'
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const questionSentences = sentences.filter(s => s.trim().endsWith('?'));
  if (questionSentences.length === 0) return null;

  // Return the LAST question sentence (the closing one)
  return questionSentences[questionSentences.length - 1].trim();
}

/**
 * Generate follow-ups that directly answer the bot's closing question.
 * This is the highest-priority follow-up strategy.
 */
function followUpsFromClosingQuestion(
  question: string,
  entities: ReturnType<typeof extractEntities>
): string[] | null {
  const lower = question.toLowerCase();
  const { lenders, amounts, programs } = entities;
  const lender1 = lenders[0];
  const amount1 = amounts[0];
  const prog1 = programs[0];

  // "Would you like me to explain/show/walk through X?"
  if (/would you like (me to |to )?(explain|show|walk|break|tell|go through|help)/i.test(question)) {
    const subject = prog1 || (lender1 ? `${lender1} loan` : amount1 || 'this');
    return [
      `Yes, explain ${subject}`,
      'Not now, different question',
      'Show me my options first',
    ];
  }

  // "Should I explain / Shall I go through?"
  if (/should i|shall i/i.test(question)) {
    return [
      'Yes, please go ahead',
      'Give me the short version',
      'I have a different question',
    ];
  }

  // "Which [factor/account/loan] concerns you most?"
  if (/which (factor|account|loan|debt|lender|issue|aspect)/i.test(question)) {
    if (lenders.length > 1) {
      return [lenders[0], lenders[1], 'Walk me through all of them'];
    }
    return [
      'The overdue amount',
      'My credit score impact',
      'What I can fix fastest',
    ];
  }

  // "Are you receiving calls / harassment?"
  if (/call|harass|recovery|agent/i.test(question)) {
    return [
      'Yes, I get calls daily',
      'Not yet, but I\'m worried',
      'Tell me how to stop them',
    ];
  }

  // "Do you want to explore [program]?"
  if (/(want to |like to |interested in |explore|try|sign up|know more about)/i.test(question)) {
    const subj = prog1 || 'this program';
    return [
      `Yes, explore ${subj}`,
      'Tell me the risks first',
      'Show me other options',
    ];
  }

  // "Have you missed / are you missing EMI payments?"
  if (/missed|missing|delay|late|default/i.test(question)) {
    return [
      'Yes, I\'ve missed payments',
      'Not yet, but struggling',
      'Tell me what happens next',
    ];
  }

  // "What is your current income / financial goal?"
  if (/income|goal|earning|salary/i.test(question)) {
    return [
      'Help me reduce my EMIs',
      'Improve my credit score',
      'Get out of debt faster',
    ];
  }

  // Generic yes/no question at end
  if (lower.includes('?') && lower.length < 100) {
    return [
      'Yes, tell me more',
      'No, different angle',
      lender1 ? `Focus on ${lender1}` : (prog1 ? `Explore ${prog1}` : 'Show me options'),
    ];
  }

  return null; // No specific match — fall through to entity-based
}

// ─── Entity-Based Follow-up Generation ───────────────────────────────────────

function generateEntityFollowUps(
  entities: ReturnType<typeof extractEntities>,
  hasRedirect: boolean
): string[] {
  const { lenders, amounts, programs, topics } = entities;

  if (hasRedirect) {
    const prog = programs[0] || 'this section';
    return [
      `Yes, take me to ${prog}`,
      'Explain more before I go',
      'What else can you help with?',
    ];
  }

  const opts: string[] = [];

  // Option 1: Deepen current topic (most specific)
  if (lenders.length > 0 && amounts.length > 0) {
    opts.push(`Break down my ${lenders[0]} debt`);
  } else if (topics.includes('payment history')) {
    opts.push('How do I improve this?');
  } else if (topics.includes('credit utilization')) {
    opts.push('How do I lower my utilization?');
  } else if (topics.includes('enquiries')) {
    opts.push('Will old enquiries fade away?');
  } else if (topics.includes('credit age')) {
    opts.push('How can I build credit age?');
  } else if (topics.includes('credit mix')) {
    opts.push('What loans improve my mix?');
  } else if (programs.length > 0) {
    opts.push(`How does ${programs[0]} work?`);
  } else if (topics.includes('credit score')) {
    opts.push("What's hurting my score most?");
  } else if (topics.includes('delinquency') || topics.includes('overdue')) {
    opts.push('What happens if I don\'t pay?');
  } else if (topics.includes('EMI')) {
    opts.push('Can I reduce my EMI?');
  } else {
    opts.push('Walk me through this');
  }

  // Option 2: Related concern
  if (lenders.length > 1) {
    opts.push(`What about ${lenders[1]}?`);
  } else if (programs.includes('DRP') || topics.includes('delinquency')) {
    opts.push('What are the risks?');
  } else if (programs.includes('DCP')) {
    opts.push('Will my score be affected?');
  } else if (topics.includes('harassment') || topics.includes('recovery agents')) {
    opts.push('What are my legal rights?');
  } else if (topics.includes('credit score') && lenders.length > 0) {
    opts.push(`How does ${lenders[0]} affect score?`);
  } else if (amounts.length > 0) {
    opts.push('How much can I save?');
  } else {
    opts.push('What should I prioritize?');
  }

  // Option 3: Action step or pivot
  if (programs.length > 0 && !hasRedirect) {
    opts.push(`Explore ${programs[0]} program`);
  } else if (topics.includes('credit score')) {
    opts.push('Set a score improvement goal');
  } else if (topics.includes('harassment')) {
    opts.push('Activate FREED Shield');
  } else if (lenders.length > 0) {
    opts.push('Show my full account summary');
  } else {
    opts.push('Show me my options');
  }

  return opts.slice(0, 3).map(o => o.length > 40 ? o.slice(0, 38) + '…' : o);
}

// ─── Validation ───────────────────────────────────────────────────────────────

const GENERIC_PATTERNS = [
  /^tell me more\.?$/i,
  /^i have (a |another )?question\.?$/i,
  /^that helps(,? thanks?)?\.?$/i,
  /^no,?\s*something else\.?$/i,
  /^yes,?\s*please\.?$/i,
  /^ok(ay)?\.?$/i,
  /^sure\.?$/i,
  /^got it\.?$/i,
  /^continue\.?$/i,
];

function hasGenericFollowUps(followUps: string[]): boolean {
  return followUps.some(f => GENERIC_PATTERNS.some(p => p.test(f.trim())));
}

// ─── Main Function ────────────────────────────────────────────────────────────

export async function getChatResponse(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  messageCount: number = 0
): Promise<ChatResponse> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages,
  });

  const rawReply = response.choices[0]?.message?.content || '';

  // ── 1. Parse redirect ──────────────────────────────────────────────────────
  const redirectMatch = rawReply.match(/\[REDIRECT:\s*(\{.*?\})\s*\]/s);
  let redirectUrl: string | undefined;
  let redirectLabel: string | undefined;
  let cleanReply = rawReply;

  if (redirectMatch) {
    try {
      const parsed = JSON.parse(redirectMatch[1]);
      redirectUrl = parsed.url;
      redirectLabel = parsed.label;
      cleanReply = cleanReply.replace(redirectMatch[0], '').trim();
    } catch { /* ignore */ }
  }

  // ── 2. Parse follow-ups from LLM ──────────────────────────────────────────
  const followUpPatterns = [
    /\[FOLLOWUPS:\s*(.*?)\]/si,
    /\[FOLLOW[\s_-]?UPS?:\s*(.*?)\]/si,
    /\[SUGGESTIONS?:\s*(.*?)\]/si,
  ];

  let followUps: string[] | undefined;

  for (const pattern of followUpPatterns) {
    const match = cleanReply.match(pattern);
    if (match) {
      followUps = match[1]
        .split('|')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(s => s.length > 0);
      cleanReply = cleanReply.replace(match[0], '').trim();
      break;
    }
  }

  // ── 3. Validate LLM follow-ups — replace if generic ───────────────────────
  const entities = extractEntities(cleanReply);

  if (followUps && followUps.length > 0 && hasGenericFollowUps(followUps)) {
    followUps = undefined; // Force regeneration
  }

  // ── 4. If no/bad follow-ups, generate dynamically ─────────────────────────
  if (!followUps || followUps.length === 0) {
    // Strategy A: Reflect the bot's closing question
    const closingQ = extractClosingQuestion(cleanReply);
    if (closingQ) {
      const questionFollowUps = followUpsFromClosingQuestion(closingQ, entities);
      if (questionFollowUps) {
        followUps = questionFollowUps;
      }
    }

    // Strategy B: Entity-based contextual follow-ups
    if (!followUps || followUps.length === 0) {
      followUps = generateEntityFollowUps(entities, !!redirectUrl);
    }
  }

  // ── 5. Ensure exactly 3 and within length limit ───────────────────────────
  while (followUps.length < 3) followUps.push('Show me my options');
  followUps = followUps.slice(0, 3).map(f => f.length > 40 ? f.slice(0, 38) + '…' : f);

  return { reply: cleanReply, redirectUrl, redirectLabel, followUps };
}
