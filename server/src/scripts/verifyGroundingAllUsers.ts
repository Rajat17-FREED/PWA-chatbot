import * as fs from 'fs';
import * as path from 'path';
import { finalizeStructuredTurnCandidate } from '../services/claude';
import { buildAdvisorContext } from '../services/advisorContext';
import { buildResponseGroundingContext } from '../services/groundingContext';
import { getUserByLeadRefId } from '../services/userLookup';
import { EnrichedCreditReport, StructuredAssistantTurn } from '../types';

interface Failure {
  userId: string;
  reason: string;
  outputPreview: string;
}

function loadReports(): Record<string, EnrichedCreditReport> {
  const jsonPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Missing dataset: ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, EnrichedCreditReport>;
}

function hasBusinessLoanNearLender(reply: string, lenderHint: string): boolean {
  const regex = new RegExp(`${lenderHint}[^\\n.?!]{0,160}\\bbusiness\\s+loan`, 'i');
  return regex.test(reply);
}

function extractCreditScoreNumber(reply: string): number | null {
  const match = reply.match(/credit score(?:\s*(?:is|of|at|stands at|currently|around|near))?\s*(\d{3})/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function countBullets(reply: string): number {
  return (reply.match(/^\s*-\s+/gm) || []).length;
}

function countNextStepItems(reply: string): number {
  const blockMatch = reply.match(/NEXT STEPS YOU CAN EXPLORE([\s\S]*)$/i);
  if (!blockMatch) return 0;
  return (blockMatch[1].match(/^\s*\d+[.)]\s+/gm) || []).length;
}

function hasGenericFollowUps(followUps: string[]): boolean {
  return followUps.some(followUp => /^(yes|show me|tell me more|what can i do|help me|go ahead|sure|okay)\b/i.test(followUp));
}

function buildAnalysisCandidate(report: EnrichedCreditReport): StructuredAssistantTurn {
  const cardAccount = report.accounts.find(account => (account.creditLimit ?? 0) > 0) || null;
  const delayAccount = report.accounts.find(account => account.dpd.maxDPD > 0) || cardAccount || report.accounts[0] || null;
  const focusAccount = cardAccount || report.accounts[0] || null;
  const wrongScore = (report.creditScore ?? 700) + 17;

  const riskItems: string[] = [];
  if (focusAccount) {
    if ((focusAccount.creditLimit ?? 0) > 0) {
      riskItems.push(`${focusAccount.lenderName} business loan is at 77% of its limit with ₹99,999 outstanding.`);
    } else {
      riskItems.push(`${focusAccount.lenderName} business loan is the biggest issue at ₹99,999 outstanding.`);
    }
  }
  if (delayAccount) {
    riskItems.push(`${delayAccount.lenderName} business loan had a 120-day delay.`);
  }
  riskItems.push('Imaginary Capital Limited is another issue at ₹54,321.');

  return {
    formatMode: 'analysis',
    opening: `Your credit score is ${wrongScore}, and the main issue is your ${focusAccount?.lenderName || 'largest'} business loan.`,
    sections: [
      {
        title: 'Key Risks',
        style: 'bullet_list',
        items: riskItems,
      },
      {
        title: 'Best Levers',
        style: 'bullet_list',
        items: [
          'Reducing the highest-utilization account can ease score pressure.',
          'Clean recent payments help older delays lose weight over time.',
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
}

function buildGenericFollowUpCandidate(report: EnrichedCreditReport): StructuredAssistantTurn {
  const focusAccount = report.accounts.find(account => (account.creditLimit ?? 0) > 0) || report.accounts[0] || null;
  return {
    formatMode: 'analysis',
    opening: `Your credit score is ${(report.creditScore ?? 700) + 12}, and ${focusAccount?.lenderName || 'one account'} is the main issue.`,
    sections: [
      {
        title: 'Key Risks',
        style: 'bullet_list',
        items: [
          `${focusAccount?.lenderName || 'One account'} business loan is at 99% of its limit.`,
          'Imaginary Capital Limited is another issue at ₹54,321.',
        ],
      },
      {
        title: 'Best Levers',
        style: 'bullet_list',
        items: [
          'Reducing usage quickly can improve the profile.',
          'Fresh on-time payments help stabilize the report.',
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
}

async function run(): Promise<void> {
  const reports = loadReports();
  const failures: Failure[] = [];

  for (const [userId, report] of Object.entries(reports)) {
    const user = getUserByLeadRefId(userId);
    const grounding = buildResponseGroundingContext(report, []);
    if (!grounding) continue;

    const userMessage = 'How can I improve my credit score quickly?';
    const advisorContext = buildAdvisorContext({
      user: user ?? null,
      report,
      creditorAccounts: [],
      userMessage,
    });

    const validResponse = await finalizeStructuredTurnCandidate({
      candidate: buildAnalysisCandidate(report),
      context: {
        history: [],
        userMessage,
        messageCount: 1,
        knowledgeBase: '',
        advisorContext,
        grounding,
        userName: user?.firstName ?? null,
        segment: user?.segment ?? null,
      },
      allowRepair: false,
    });

    const validReply = validResponse.reply;
    const validFollowUps = validResponse.followUps || [];

    if (/Imaginary Capital Limited/i.test(validReply)) {
      failures.push({
        userId,
        reason: 'unknown-lender-not-removed',
        outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
      });
    }

    for (const lender of grounding.likelyCardLenders) {
      const lenderHint = lender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (hasBusinessLoanNearLender(validReply, lenderHint)) {
        failures.push({
          userId,
          reason: `card-lender-still-labeled-business-loan:${lender}`,
          outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
        });
        break;
      }
    }

    if (grounding.creditScore !== null && grounding.creditScore !== undefined) {
      const scoreInOutput = extractCreditScoreNumber(validReply);
      if (scoreInOutput !== null && scoreInOutput !== grounding.creditScore) {
        failures.push({
          userId,
          reason: `credit-score-mismatch:expected-${grounding.creditScore}-got-${scoreInOutput}`,
          outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
        });
      }
    }

    if (validFollowUps.length !== 3) {
      failures.push({
        userId,
        reason: 'followup-count-not-3',
        outputPreview: JSON.stringify(validFollowUps),
      });
    }

    if (hasGenericFollowUps(validFollowUps)) {
      failures.push({
        userId,
        reason: 'generic-followup-retained',
        outputPreview: JSON.stringify(validFollowUps),
      });
    }

    if (!/KEY RISKS/i.test(validReply) || !/BEST LEVERS/i.test(validReply)) {
      failures.push({
        userId,
        reason: 'analysis-headers-missing',
        outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
      });
    }

    if (countBullets(validReply) < 2) {
      failures.push({
        userId,
        reason: 'analysis-bullets-missing',
        outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
      });
    }

    if (countNextStepItems(validReply) !== 3) {
      failures.push({
        userId,
        reason: 'next-steps-not-exactly-3',
        outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
      });
    }

    const cardLender = grounding.likelyCardLenders[0];
    if (cardLender) {
      const escaped = cardLender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const segment = validReply.match(new RegExp(`${escaped}[^\\n.?!]{0,160}`, 'i'))?.[0] || '';
      if (segment && /\b(limit|utilization|usage|used|%)\b/i.test(segment) && !/\bcredit\s+card\b/i.test(segment)) {
        failures.push({
          userId,
          reason: `card-context-missing-credit-card-label:${cardLender}`,
          outputPreview: validReply.slice(0, 260).replace(/\n/g, ' | '),
        });
      }
    }

    const genericResponse = await finalizeStructuredTurnCandidate({
      candidate: buildGenericFollowUpCandidate(report),
      context: {
        history: [],
        userMessage,
        messageCount: 1,
        knowledgeBase: '',
        advisorContext,
        grounding,
        userName: user?.firstName ?? null,
        segment: user?.segment ?? null,
      },
      allowRepair: false,
    });

    const genericFollowUps = genericResponse.followUps || [];
    if (genericFollowUps.length !== 0) {
      failures.push({
        userId,
        reason: 'generic-followups-should-fail-closed',
        outputPreview: JSON.stringify(genericFollowUps),
      });
    }

    if (/NEXT STEPS YOU CAN EXPLORE/i.test(genericResponse.reply)) {
      failures.push({
        userId,
        reason: 'next-steps-should-be-omitted-on-followup-failure',
        outputPreview: genericResponse.reply.slice(0, 260).replace(/\n/g, ' | '),
      });
    }
  }

  console.log(JSON.stringify({
    users: Object.keys(reports).length,
    failures: failures.length,
  }, null, 2));

  if (failures.length > 0) {
    console.error('First 20 failures:');
    for (const failure of failures.slice(0, 20)) {
      console.error(JSON.stringify(failure));
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
