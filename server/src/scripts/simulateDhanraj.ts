import * as fs from 'fs';
import * as path from 'path';
import { finalizeStructuredTurnCandidate, getChatResponse } from '../services/claude';
import { buildAdvisorContext } from '../services/advisorContext';
import { buildResponseGroundingContext } from '../services/groundingContext';
import { getUserByLeadRefId } from '../services/userLookup';
import { AdvisorContext, EnrichedCreditReport, ResponseGroundingContext, StructuredAssistantTurn } from '../types';

const DHANRAJ_ID = '6833fac335a26c6edb07afed';

function loadReport(leadRefId: string): EnrichedCreditReport {
  const jsonPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, EnrichedCreditReport>;
  const report = raw[leadRefId];
  if (!report) {
    throw new Error(`Missing report for ${leadRefId}`);
  }
  return report;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function countBullets(reply: string): number {
  return (reply.match(/^\s*-\s+/gm) || []).length;
}

function countNextStepItems(reply: string): number {
  const blockMatch = reply.match(/NEXT STEPS YOU CAN EXPLORE([\s\S]*)$/i);
  if (!blockMatch) return 0;
  return (blockMatch[1].match(/^\s*\d+[.)]\s+/gm) || []).length;
}

function hasBusinessLoanNearLender(reply: string, lenderHint: string): boolean {
  const regex = new RegExp(`${lenderHint}[^\\n.?!]{0,160}\\bbusiness\\s+loan`, 'i');
  return regex.test(reply);
}

function buildContext(report: EnrichedCreditReport, userMessage: string): {
  advisorContext: AdvisorContext;
  grounding: ResponseGroundingContext;
  userName: string | null;
  segment: string | null;
} {
  const user = getUserByLeadRefId(DHANRAJ_ID);
  const advisorContext = buildAdvisorContext({
    user: user ?? null,
    report,
    creditorAccounts: [],
    userMessage,
  });
  const grounding = buildResponseGroundingContext(report, []);
  if (!grounding) {
    throw new Error('Failed to construct grounding context for Dhanraj');
  }

  return {
    advisorContext,
    grounding,
    userName: user?.firstName ?? null,
    segment: user?.segment ?? null,
  };
}

async function runOfflineAnalysisScenario(report: EnrichedCreditReport): Promise<void> {
  const userMessage = 'How can I improve my credit score quickly?';
  const context = buildContext(report, userMessage);

  const candidate: StructuredAssistantTurn = {
    formatMode: 'analysis',
    opening: 'Your credit score is 754, and the main drag is your HDFC Bank Ltd business loan.',
    sections: [
      {
        title: 'Key Risks',
        style: 'bullet_list',
        items: [
          'HDFC Bank Ltd business loan is at 77% of its limit with ₹99,999 outstanding.',
          'Phoenix ARC Private Limited had a 120-day delay on a business loan.',
          'Imaginary Capital Limited is also hurting your score at ₹54,321.',
        ],
      },
      {
        title: 'Best Levers',
        style: 'bullet_list',
        items: [
          'Reducing the HDFC balance can help your score recover faster.',
          'Staying current from here matters because fresh payment history is still counted heavily.',
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

  const response = await finalizeStructuredTurnCandidate({
    candidate,
    context: {
      history: [],
      userMessage,
      messageCount: 1,
      knowledgeBase: '',
      advisorContext: context.advisorContext,
      grounding: context.grounding,
      userName: context.userName,
      segment: context.segment,
    },
    allowRepair: false,
  });

  const reply = response.reply;
  const followUps = response.followUps || [];

  console.log('\n=== OFFLINE ANALYSIS SCENARIO ===');
  console.log('FOLLOWUPS:', followUps);
  console.log('REPLY_PREVIEW:', reply.slice(0, 520).replace(/\n/g, ' | '));

  assert(!/Imaginary Capital Limited/i.test(reply), 'offline analysis: unknown lender was not removed');
  assert(!hasBusinessLoanNearLender(reply, 'HDFC\\s+Bank'), 'offline analysis: HDFC still shown as business loan');
  assert(!hasBusinessLoanNearLender(reply, 'Phoenix\\s+ARC'), 'offline analysis: Phoenix still shown as business loan');
  assert(/HDFC Bank Ltd credit card/i.test(reply), 'offline analysis: HDFC credit card label missing');
  assert(/credit score is 737/i.test(reply), 'offline analysis: credit score was not corrected to 737');
  assert(followUps.length === 3, 'offline analysis: expected exactly 3 aligned follow-ups');
  assert(countNextStepItems(reply) === 3, 'offline analysis: expected exactly 3 numbered next steps');
  assert(countBullets(reply) >= 2, 'offline analysis: expected bullet formatting in analysis mode');
}

async function runOfflineGuidedScenario(report: EnrichedCreditReport): Promise<void> {
  const userMessage = 'Why is my HDFC card a problem?';
  const context = buildContext(report, userMessage);

  const candidate: StructuredAssistantTurn = {
    formatMode: 'guided',
    opening: 'I looked closer at the issue around your HDFC Bank Ltd business loan.',
    sections: [
      {
        style: 'bullet_list',
        items: [
          'HDFC Bank Ltd business loan is using 99% of its limit.',
          'That level of utilization can weigh on your score even when the rest of the file is stable.',
          'Phoenix ARC Private Limited also shows an older business loan delay of 180 days.',
        ],
      },
    ],
    closingQuestion: {
      text: 'Would you rather focus on reducing card usage or understanding the delay history?',
      options: ['reducing card usage', 'understanding the delay history'],
    },
    followUps: [
      'Yes, I would like that',
      'Show me my data',
      'What can I do?',
    ],
  };

  const response = await finalizeStructuredTurnCandidate({
    candidate,
    context: {
      history: [],
      userMessage,
      messageCount: 1,
      knowledgeBase: '',
      advisorContext: context.advisorContext,
      grounding: context.grounding,
      userName: context.userName,
      segment: context.segment,
    },
    allowRepair: false,
  });

  const reply = response.reply;
  const followUps = response.followUps || [];

  console.log('\n=== OFFLINE GUIDED SCENARIO ===');
  console.log('FOLLOWUPS:', followUps);
  console.log('REPLY_PREVIEW:', reply.slice(0, 420).replace(/\n/g, ' | '));

  assert(!hasBusinessLoanNearLender(reply, 'HDFC\\s+Bank'), 'offline guided: HDFC still shown as business loan');
  assert(/HDFC Bank Ltd credit card/i.test(reply), 'offline guided: HDFC credit card label missing');
  assert(followUps.length === 0, 'offline guided: generic follow-ups should fail closed and be omitted');
  assert(!/NEXT STEPS YOU CAN EXPLORE/i.test(reply), 'offline guided: next steps block should be omitted when follow-ups fail closed');
  assert(countBullets(reply) >= 2, 'offline guided: expected bullet formatting in guided mode');
}

async function runPlainWelcomeScenario(report: EnrichedCreditReport): Promise<void> {
  const userMessage = 'Hi';
  const context = buildContext(report, userMessage);

  const candidate: StructuredAssistantTurn = {
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

  const response = await finalizeStructuredTurnCandidate({
    candidate,
    context: {
      history: [],
      userMessage,
      messageCount: 1,
      knowledgeBase: '',
      advisorContext: context.advisorContext,
      grounding: context.grounding,
      userName: context.userName,
      segment: context.segment,
    },
    allowRepair: false,
  });

  console.log('\n=== OFFLINE PLAIN SCENARIO ===');
  console.log('REPLY_PREVIEW:', response.reply.replace(/\n/g, ' | '));

  assert(countBullets(response.reply) === 0, 'offline plain: welcome response should not be forced into bullets');
  assert(!/NEXT STEPS YOU CAN EXPLORE/i.test(response.reply), 'offline plain: welcome response should not show next steps');
}

async function runLiveScenario(report: EnrichedCreditReport): Promise<void> {
  const userMessage = 'How can I improve my credit score quickly?';
  const context = buildContext(report, userMessage);

  const response = await getChatResponse({
    history: [],
    userMessage,
    messageCount: 1,
    knowledgeBase: '',
    advisorContext: context.advisorContext,
    grounding: context.grounding,
    userName: context.userName,
    segment: context.segment,
  });

  const reply = response.reply;
  const followUps = response.followUps || [];

  console.log('\n=== LIVE STRUCTURED GENERATION ===');
  console.log('FOLLOWUPS:', followUps);
  console.log('REPLY_PREVIEW:', reply.slice(0, 520).replace(/\n/g, ' | '));

  assert(!hasBusinessLoanNearLender(reply, 'HDFC\\s+Bank'), 'live generation: HDFC still shown as business loan');
  assert(!hasBusinessLoanNearLender(reply, 'Kotak\\s+Mahindra\\s+Bank'), 'live generation: Kotak still shown as business loan');
  if (followUps.length > 0) {
    assert(followUps.length === 3, 'live generation: expected exactly 3 follow-ups when present');
    assert(countNextStepItems(reply) === 3, 'live generation: numbered next steps should match follow-ups');
  }
}

async function run(): Promise<void> {
  const report = loadReport(DHANRAJ_ID);

  await runOfflineAnalysisScenario(report);
  await runOfflineGuidedScenario(report);
  await runPlainWelcomeScenario(report);

  if (process.env.OPENAI_API_KEY) {
    await runLiveScenario(report);
  } else {
    console.log('\nLIVE STRUCTURED GENERATION SKIPPED: OPENAI_API_KEY is not set');
  }

  console.log('\nSIMULATION RESULT: PASS');
}

run().catch((err) => {
  console.error('SIMULATION RESULT: FAIL');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
