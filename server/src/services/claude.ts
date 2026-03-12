import OpenAI from 'openai';
import { ChatMessage, ChatResponse } from '../types';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// ─── Marketing Phrase Mapper ─────────────────────────────────────────────────

/** Map internal program names to user-friendly marketing phrases for follow-up chips */
function toMarketingPhrase(programName: string): string {
  const PHRASES: Record<string, string> = {
    'DRP': 'debt relief options',
    'DCP': 'single-EMI plan',
    'DEP': 'faster payoff plan',
    'FREED Shield': 'call protection',
    'Credit Insights': 'credit tracking',
    'Goal Tracker': 'score goals',
  };
  return PHRASES[programName] || programName;
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
    'Krazybee', 'DMI Finance', 'Hero FinCorp', 'Fullerton', 'Aditya Birla',
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
    'settle': 'settlement', 'negotiate': 'negotiation',
    'combine': 'loan combining', 'single payment': 'loan combining',
    'reduce': 'reduce', 'lower': 'lower',
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
 * Phase-aware: different strategies for different conversation stages.
 */
function followUpsFromClosingQuestion(
  question: string,
  entities: ReturnType<typeof extractEntities>,
  messageCount: number
): string[] | null {
  const lower = question.toLowerCase();
  const { lenders, amounts, programs } = entities;
  const lender1 = lenders[0];
  const prog1 = programs[0];

  // ── Phase 1 patterns: Diagnostic questions (early conversation) ──

  // "What's stressing you most — X or Y?"
  if (/what('s| is) (stressing|bothering|worrying|concerning|troubling)/i.test(question)) {
    return [
      'The total amount I owe',
      'Too many payments to track',
      "I've already missed some EMIs",
    ];
  }

  // "Are you able to make your payments / have any slipped?"
  if (/able to (make|pay|manage|keep up)|have (any|some) (slipped|missed|fallen)/i.test(question)) {
    return [
      "I've missed a few already",
      'Barely managing right now',
      'Yes, but it\'s very tight',
    ];
  }

  // "Which part concerns you — amount or payments?"
  if (/which (part|aspect|thing)|what (part|aspect)/i.test(question)) {
    if (lenders.length > 1) {
      return [lenders[0], lenders[1], 'All of them honestly'];
    }
    return [
      'The monthly EMI amount',
      'The number of loans',
      'My credit score impact',
    ];
  }

  // ── Phase 2 patterns: Bridging questions (mid conversation) ──

  // "Would you like me to explain/show/walk through X?"
  if (/would you like (me to |to )?(explain|show|walk|break|tell|go through|help|share)/i.test(question)) {
    const subject = lender1 ? `my ${lender1} loan` : (prog1 ? toMarketingPhrase(prog1) : 'this');
    return [
      `Yes, show me ${subject}`,
      'Give me the key highlights',
      'What are my options?',
    ];
  }

  // "Should I explain / Shall I go through?"
  if (/should i|shall i/i.test(question)) {
    return [
      'Yes, please go ahead',
      'Give me the short version',
      'What can I actually do about it?',
    ];
  }

  // "How does that sound / Does that make sense?"
  if (/how does that sound|does that (make sense|work|help|sound)/i.test(question)) {
    return [
      'That sounds promising',
      'What are the risks?',
      'Show me the numbers',
    ];
  }

  // ── Phase 3 patterns: Solution/action questions (later conversation) ──

  // "Want to explore / interested in [program/solution]?"
  if (/(want to |like to |interested in |ready to )?(explore|try|sign up|know more|get started|see how)/i.test(question)) {
    const subj = prog1 ? toMarketingPhrase(prog1) : 'this';
    return [
      `Yes, let's explore ${subj}`,
      'What are the risks first?',
      'Are there other options?',
    ];
  }

  // "Are you receiving calls / harassment?"
  if (/call|harass|recovery|agent/i.test(question)) {
    return [
      'Yes, I get calls daily',
      "Not yet, but I'm worried",
      'Tell me how to stop them',
    ];
  }

  // "Have you missed / are you missing EMI payments?"
  if (/missed|missing|delay|late|default/i.test(question)) {
    return [
      "Yes, I've missed payments",
      'Not yet, but struggling',
      'What happens if I miss more?',
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

  // "Which [factor/account/loan] concerns you most?"
  if (/which (factor|account|loan|debt|lender|issue)/i.test(question)) {
    if (lenders.length > 1) {
      return [lenders[0], lenders[1], 'Walk me through all of them'];
    }
    return [
      'The overdue amounts',
      'My credit score impact',
      'What I can fix first',
    ];
  }

  // Generic yes/no question at end — phase-aware responses
  if (lower.includes('?') && lower.length < 120) {
    if (messageCount <= 1) {
      // Phase 1: Keep exploring
      return [
        'Yes, I\'d like to understand',
        'Can you show me my data?',
        'What are my main issues?',
      ];
    } else if (messageCount === 2) {
      // Phase 2: Start bridging toward solution
      return [
        'Yes, that interests me',
        'What does that involve?',
        lender1 ? `Focus on ${lender1}` : 'Show me my options',
      ];
    } else {
      // Phase 3+: Action-oriented
      return [
        'Yes, let\'s do it',
        'What are the risks?',
        prog1 ? `Explore ${toMarketingPhrase(prog1)}` : 'Show me alternatives',
      ];
    }
  }

  return null; // No specific match — fall through to entity-based
}

// ─── Phase-Aware Entity-Based Follow-up Generation ───────────────────────────

function generateEntityFollowUps(
  entities: ReturnType<typeof extractEntities>,
  hasRedirect: boolean,
  messageCount: number
): string[] {
  const { lenders, amounts, programs, topics } = entities;

  // If redirect was included, follow-ups should support the action
  if (hasRedirect) {
    const prog = programs[0] ? toMarketingPhrase(programs[0]) : 'this';
    return [
      `Yes, show me ${prog}`,
      'What should I expect there?',
      'Tell me the risks first',
    ];
  }

  const opts: string[] = [];

  if (messageCount <= 1) {
    // ── Phase 1: Diagnostic follow-ups — explore different angles ──
    if (topics.includes('EMI') || topics.includes('monthly obligation')) {
      opts.push('My EMIs are really stressful');
    } else if (topics.includes('credit score')) {
      opts.push("What's dragging my score down?");
    } else if (topics.includes('delinquency') || topics.includes('overdue')) {
      opts.push("I've missed a few payments");
    } else if (lenders.length > 0) {
      opts.push(`Tell me about my ${lenders[0]} loan`);
    } else {
      opts.push('Show me my biggest problem');
    }

    if (topics.includes('harassment') || topics.includes('recovery agents')) {
      opts.push("Yes, I'm getting calls");
    } else if (amounts.length > 0) {
      opts.push(`Is ${amounts[0]} a lot?`);
    } else {
      opts.push('How bad is my situation?');
    }

    opts.push('What can I do about it?');

  } else if (messageCount === 2) {
    // ── Phase 2: Bridge follow-ups — move toward solution ──
    if (lenders.length > 0 && amounts.length > 0) {
      opts.push(`Break down my ${lenders[0]} debt`);
    } else if (topics.includes('credit score')) {
      opts.push('How do I improve this?');
    } else if (topics.includes('settlement') || topics.includes('negotiation')) {
      opts.push('How does this work exactly?');
    } else if (topics.includes('loan combining')) {
      opts.push('Can this really lower my EMI?');
    } else if (programs.length > 0) {
      opts.push(`How does ${toMarketingPhrase(programs[0])} work?`);
    } else {
      opts.push('Walk me through my options');
    }

    // One toward the solution concept
    if (programs.includes('DRP') || topics.includes('settlement')) {
      opts.push('Can I settle for less?');
    } else if (programs.includes('DCP') || topics.includes('loan combining')) {
      opts.push('Combine into one EMI?');
    } else if (programs.includes('DEP')) {
      opts.push('Pay off loans faster?');
    } else if (topics.includes('credit score')) {
      opts.push('Set a score target for me');
    } else {
      opts.push('What solution fits me?');
    }

    // One concern
    if (lenders.length > 1) {
      opts.push(`What about ${lenders[1]}?`);
    } else {
      opts.push('Will this affect my score?');
    }

  } else {
    // ── Phase 3+: Action follow-ups — drive to resolution ──
    if (programs.length > 0) {
      opts.push(`Show me ${toMarketingPhrase(programs[0])}`);
    } else if (lenders.length > 0) {
      opts.push(`Resolve my ${lenders[0]} debt`);
    } else {
      opts.push("Let's start the process");
    }

    if (topics.includes('settlement') || topics.includes('negotiation') || programs.includes('DRP')) {
      opts.push('What are the risks?');
    } else if (programs.includes('DCP')) {
      opts.push('Will my score be affected?');
    } else {
      opts.push('What should I watch out for?');
    }

    if (lenders.length > 1) {
      opts.push(`What about ${lenders[1]}?`);
    } else {
      opts.push('Show me alternatives');
    }
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

  // ── 1.5. Strip inline markdown links [text](url) → text (hard failsafe) ───
  // All navigation must go through the structured [REDIRECT:...] token.
  // If the model generates anchor-style links like [here](/), strip them.
  cleanReply = cleanReply.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // ── 1.6. Light cleanup — keep structured formatting but remove report-style headers ─
  // Remove bold category labels like "**Payment History:**" but keep bullet points and numbered lists.
  cleanReply = cleanReply.replace(/\*\*[A-Z][^*\n]{2,40}\*\*:\s*/g, (match) => {
    // Only remove if it looks like a report-style category label (e.g., "**Payment History:** ")
    // Keep everything else (bold lender names, amounts, etc.)
    return match.includes(':') ? '' : match;
  });

  // Collapse excessive whitespace but preserve intentional line breaks for formatting
  cleanReply = cleanReply.replace(/\n{3,}/g, '\n\n').trim();

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

  // ── 4. If no/bad follow-ups, generate dynamically (phase-aware) ────────────
  if (!followUps || followUps.length === 0) {
    // Strategy A: Reflect the bot's closing question (phase-aware)
    const closingQ = extractClosingQuestion(cleanReply);
    if (closingQ) {
      const questionFollowUps = followUpsFromClosingQuestion(closingQ, entities, messageCount);
      if (questionFollowUps) {
        followUps = questionFollowUps;
      }
    }

    // Strategy B: Phase-aware entity-based contextual follow-ups
    if (!followUps || followUps.length === 0) {
      followUps = generateEntityFollowUps(entities, !!redirectUrl, messageCount);
    }
  }

  // ── 5. Ensure exactly 3 and within length limit ───────────────────────────
  while (followUps.length < 3) followUps.push('Show me my options');
  followUps = followUps.slice(0, 3).map(f => f.length > 40 ? f.slice(0, 38) + '…' : f);

  return { reply: cleanReply, redirectUrl, redirectLabel, followUps };
}
