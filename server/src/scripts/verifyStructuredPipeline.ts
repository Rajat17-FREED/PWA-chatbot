import * as fs from 'fs';
import * as path from 'path';
import { debugStructuredPayload, finalizeStructuredTurnCandidate } from '../services/claude';
import { buildAdvisorContext } from '../services/advisorContext';
import { buildResponseGroundingContext } from '../services/groundingContext';
import { getCurrentUserTurnCount, resolveConversationIntentTag } from '../services/conversationContext';
import { getUserByLeadRefId } from '../services/userLookup';
import { EnrichedCreditReport, StructuredAssistantTurn } from '../types';

const DHANRAJ_ID = '6833fac335a26c6edb07afed';

function loadReport(leadRefId: string): EnrichedCreditReport {
  const jsonPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, EnrichedCreditReport>;
  const report = raw[leadRefId];
  if (!report) throw new Error(`Missing report for ${leadRefId}`);
  return report;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function countBullets(reply: string): number {
  return (reply.match(/^\s*-\s+/gm) || []).length;
}

async function run(): Promise<void> {
  const report = loadReport(DHANRAJ_ID);
  const user = getUserByLeadRefId(DHANRAJ_ID);
  const grounding = buildResponseGroundingContext(report, []);
  if (!grounding) throw new Error('Missing grounding context');

  const plainContext = {
    history: [],
    userMessage: 'Hi',
    messageCount: 1,
    knowledgeBase: '',
    advisorContext: buildAdvisorContext({ user: user ?? null, report, creditorAccounts: [], userMessage: 'Hi' }),
    grounding,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
  };

  const plainTurn: StructuredAssistantTurn = {
    formatMode: 'plain',
    opening: 'Welcome, Dhanraj.',
    sections: [
      {
        style: 'paragraph',
        items: ['I have your profile ready and can help with score, accounts, or repayment questions.'],
      },
    ],
    followUps: [],
  };

  const plainResponse = await finalizeStructuredTurnCandidate({ candidate: plainTurn, context: plainContext, allowRepair: false });
  assert(countBullets(plainResponse.reply) === 0, 'plain mode should not render bullet lists');
  assert(!/NEXT STEPS YOU CAN EXPLORE/i.test(plainResponse.reply), 'plain mode should not render next steps');

  const guidedContext = {
    history: [],
    userMessage: 'Why is my HDFC card a problem?',
    messageCount: 1,
    knowledgeBase: '',
    advisorContext: buildAdvisorContext({ user: user ?? null, report, creditorAccounts: [], userMessage: 'Why is my HDFC card a problem?' }),
    grounding,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
  };

  const guidedTurn: StructuredAssistantTurn = {
    formatMode: 'guided',
    opening: 'The biggest issue is your HDFC Bank Ltd business loan.',
    sections: [
      {
        style: 'bullet_list',
        items: [
          'HDFC Bank Ltd business loan is using 99% of its limit.',
          'That level of utilization can weigh on your score.',
          'Reducing usage below 30% would lower pressure.',
        ],
      },
    ],
    closingQuestion: {
      text: 'Would you rather reduce card usage or compare it with your older delay history?',
      options: ['reduce card usage', 'compare it with your older delay history'],
    },
    followUps: [
      'How do I reduce card usage?',
      'How does the older delay history compare?',
      'Can we compare both issues?',
    ],
  };

  const guidedResponse = await finalizeStructuredTurnCandidate({ candidate: guidedTurn, context: guidedContext, allowRepair: false });
  assert(countBullets(guidedResponse.reply) >= 2, 'guided mode should render a focused bullet list');
  assert((guidedResponse.followUps || []).length === 3, 'guided mode should return exactly 3 follow-ups when follow-ups are valid');
  assert(/HDFC Bank Ltd credit card/i.test(guidedResponse.reply), 'guided mode should preserve credit card wording in card context');

  const analysisContext = {
    history: [],
    userMessage: 'How can I improve my credit score quickly?',
    messageCount: 1,
    knowledgeBase: '',
    advisorContext: buildAdvisorContext({ user: user ?? null, report, creditorAccounts: [], userMessage: 'How can I improve my credit score quickly?' }),
    grounding,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
  };

  const analysisTurn: StructuredAssistantTurn = {
    formatMode: 'analysis',
    opening: 'Your credit score is 754 and two issues matter most right now.',
    sections: [
      {
        title: 'Key Risks',
        style: 'bullet_list',
        items: [
          'HDFC Bank Ltd business loan is at 77% of its limit with ₹99,999 outstanding.',
          'Phoenix ARC Private Limited had a 120-day delay on a business loan.',
        ],
      },
      {
        title: 'Best Levers',
        style: 'bullet_list',
        items: [
          'Reducing the highest-utilization account can help the score recover faster.',
          'Fresh on-time payments help older delays lose weight over time.',
        ],
      },
    ],
    closingQuestion: {
      text: 'What matters more right now: getting a loan approved, securing a better interest rate, or improving your score overall?',
      options: [
        'getting a loan approved',
        'securing a better interest rate',
        'improving your score overall',
      ],
    },
    followUps: [
      'How do I improve approval chances?',
      'How can I target a better interest rate?',
      'What is the fastest way to improve my score?',
    ],
  };

  const analysisResponse = await finalizeStructuredTurnCandidate({ candidate: analysisTurn, context: analysisContext, allowRepair: false });
  assert(/KEY RISKS/i.test(analysisResponse.reply), 'analysis mode should render visible section headers');
  assert(/BEST LEVERS/i.test(analysisResponse.reply), 'analysis mode should render multiple visible section headers');
  assert(countBullets(analysisResponse.reply) >= 3, 'analysis mode should render scoped bullets');
  assert((analysisResponse.followUps || []).length === 3, 'analysis mode should return exactly 3 follow-ups');
  assert(/credit score is 737/i.test(analysisResponse.reply), 'analysis mode should correct grounded score mentions');

  const genericFollowUpTurn: StructuredAssistantTurn = {
    formatMode: 'analysis',
    opening: 'Your credit score is 754 and the biggest issue is your HDFC Bank Ltd business loan.',
    sections: [
      {
        title: 'Key Risks',
        style: 'bullet_list',
        items: [
          'HDFC Bank Ltd business loan is at 99% of its limit.',
          'Imaginary Capital Limited is another issue at ₹54,321.',
        ],
      },
      {
        title: 'Best Levers',
        style: 'bullet_list',
        items: [
          'Reducing usage can help.',
          'Fresh payments matter.',
        ],
      },
    ],
    closingQuestion: {
      text: 'Would you rather reduce card usage or understand the delay history?',
      options: ['reduce card usage', 'understand the delay history'],
    },
    followUps: [
      'Yes, I would like that',
      'Show me my data',
      'What can I do?',
    ],
  };

  const genericResponse = await finalizeStructuredTurnCandidate({ candidate: genericFollowUpTurn, context: analysisContext, allowRepair: false });
  assert((genericResponse.followUps || []).length === 3, 'generic follow-ups should be replaced with contextual follow-ups');
  assert(!/NEXT STEPS YOU CAN EXPLORE/i.test(genericResponse.reply), 'generic follow-up failure should not leak any legacy next-steps block');

  const harassmentHistory = [
    {
      role: 'user' as const,
      content: 'Recovery agents keep calling me',
      intentTag: 'INTENT_HARASSMENT',
    },
    {
      role: 'assistant' as const,
      content: [
        'Dealing with recovery agents can be incredibly stressful, Dhanraj. Let\'s address this together.',
        'YOU ARE NOT ALONE IN THIS',
        '- Many borrowers face similar pressures from lenders when payments are overdue.',
        '- You have 4 accounts with missed payments, which can lead to increased contact from lenders.',
        'WHEN IT CROSSES THE LINE',
        '- Non-stop calls throughout the day, sometimes even on weekends or late at night.',
      ].join('\n\n'),
    },
  ];
  const harassmentMessage = 'I\'m facing harassment from PayU Finance India PVT Ltd and Krazybee Services Private Limited';
  const carriedIntent = resolveConversationIntentTag(harassmentMessage, harassmentHistory);
  assert(carriedIntent === 'INTENT_HARASSMENT', 'harassment follow-up should keep the harassment intent active');
  assert(getCurrentUserTurnCount(harassmentHistory, 1) === 2, 'follow-up turn count should include the current user turn');

  const harassmentPayload = debugStructuredPayload({
    history: harassmentHistory,
    userMessage: harassmentMessage,
    messageCount: 1,
    knowledgeBase: '',
    advisorContext: buildAdvisorContext({ user: user ?? null, report, creditorAccounts: [], userMessage: harassmentMessage }),
    grounding,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
    intentTag: carriedIntent,
  });

  assert(harassmentPayload.message_count === 2, 'structured payload should normalize follow-up turn counts');
  assert(harassmentPayload.conversation_state.is_follow_up, 'conversation_state should mark the lender-selection response as a follow-up');
  assert(harassmentPayload.conversation_state.harassment_overview_already_given, 'conversation_state should detect that the harassment overview already happened');
  assert(harassmentPayload.conversation_state.named_lenders_in_user_message, 'conversation_state should detect named lenders in the follow-up user message');
  assert(
    /Do not repeat the empathy block/i.test(harassmentPayload.conversation_state.continuation_directive),
    'continuation directive should explicitly prevent repeating the harassment overview stage'
  );

  console.log(JSON.stringify({
    checks: 5,
    status: 'pass',
  }, null, 2));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
