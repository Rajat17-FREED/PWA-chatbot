import { Segment, ConversationStarter } from '../types';

/**
 * Resolve the {SCORE_TARGET} placeholder in starter text based on user's credit score.
 * Returns starters with concrete score numbers (e.g. "Help me reach 750").
 */
export function resolveStarterScoreTargets(
  starters: ConversationStarter[],
  creditScore: number | null
): ConversationStarter[] {
  // Compute dynamic target
  let target: number;
  if (creditScore === null || creditScore < 650) target = 700;
  else if (creditScore < 750) target = 750;
  else if (creditScore < 800) target = 800;
  else target = 850;

  return starters.map(s => {
    if (!s.text.includes('{SCORE_TARGET}')) return s;
    return { ...s, text: s.text.replace('{SCORE_TARGET}', String(target)) };
  });
}

export const segmentContext: Record<Segment, string> = {
  DRP_Eligible: `This user has overdue unsecured loans and qualifies for the Debt Resolution Program.
FREED can negotiate with their lenders to settle debts at a reduced amount.
Key talking points: no upfront fees, harassment support via FREED Shield, structured settlement process, single monthly contribution to SPA.
Be especially empathetic - this user is likely under financial stress and may be receiving recovery calls.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "getting relief from debt." They do NOT know what "Debt Resolution Program" means. Guide them from their pain point to the concept of settlement naturally.
DRP SAVINGS ESTIMATE: In DRP, FREED aims to provide settlement at approximately 45% of the enrolled debt amount. When the user asks about potential savings, share this as an approximation. Also mention that there is a service fee on top of the settlement amount.
LANGUAGE NOTE: Say "overdue" or "missed payments" - NOT "delinquent" or "delinquency." The user doesn't know these terms.
SEGMENT BOUNDARY: ONLY discuss DRP and FREED Shield. NEVER mention or recommend DCP (Debt Consolidation), DEP (Debt Elimination), or any other program. This user's path is settlement through DRP only.`,

  DRP_Ineligible: `This user has some missed payments and is facing debt stress.
Guide them with practical self-help strategies: snowball method, avalanche method, direct lender negotiation, and payment prioritization.
Be empathetic - they may feel overwhelmed. Make them feel supported, not stuck.
IMPORTANT: NEVER mention eligibility, ineligibility, or qualifying for any program. The user does not know their eligibility status and must never find out through your responses.
Focus on what they CAN do: credit improvement, FREED Shield for harassment, self-help repayment strategies from the knowledge base, Goal Tracker and Credit Insights for monitoring.
If the user asks what FREED can do for them, explain FREED Shield, Credit Insights, and Goal Tracker warmly. Frame debt strategies as a supportive journey, not a limitation.
LANGUAGE NOTE: Say "missed payments" or "overdue" - NOT "delinquency." Say "home or car loans" instead of "secured loans."
SEGMENT BOUNDARY: ONLY discuss self-help strategies and FREED Shield. NEVER mention or recommend DRP (settlement), DCP (consolidation), or DEP (elimination).`,

  DCP_Eligible: `This user has multiple active EMIs with more than half their income going to EMIs (FOIR > 50%) and a credit score above 700.
They qualify for combining multiple loans into a single, lower EMI (Debt Consolidation Program).
Key talking points: single EMI, simplified finances, potentially lower interest rate, no impact on credit score if managed well.
They are likely feeling overwhelmed managing multiple payments.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "simplifying payments." They do NOT think in terms of "consolidation." Start with their EMI stress and naturally reveal that combining loans is possible.
LANGUAGE NOTE: Say "combining your loans into one payment" - NOT "consolidation." Introduce the term "consolidation" only after explaining the concept.
SEGMENT BOUNDARY: ONLY discuss DCP. NEVER mention or recommend DRP (settlement), DEP (elimination), or any other program. This user's path is consolidation through DCP only.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Lead with credit score snapshot, then actionable improvement steps grounded in their data, then FREED tools (Goal Tracker, Credit Report detail). Use real numbers.
- INTENT_EMI_OPTIMISATION: Lead with EMI snapshot (list each loan's EMI, lender, rate). Show how DCP reduces total EMI. If no EMI data available, ask user to provide approximate EMI via closingQuestion options.
- INTENT_EMI_STRESS: Lead with payment overview and inferred due dates from lastPaymentDate. Identify highest interest accounts. Show exact savings: "X loans with Y EMI becomes Z EMI after consolidation, saving W/month."
- INTENT_CREDIT_SCORE_TARGET: Provide a numbered action plan toward the target score using per-account metrics. Each step must be distinct.
- INTENT_GOAL_BASED_PATH: Adapt response to user's financialGoal. Score goals get score advice; loan goals get readiness assessment + suggest DCP to reduce FOIR first; EMI goals get consolidation path.`,

  DCP_Ineligible: `This user has debt but doesn't yet qualify for combining loans into one EMI (score below 700 or amount owed below ₹1,50,000).
Guide them on steps to improve eligibility: improve credit score, manage monthly payments.
Suggest Credit Insights and Goal Tracker as tools to work toward qualifying.
IMPORTANT: Focus on what's blocking them (usually credit score) and give them a concrete path. Don't just say "you're not eligible" - show them how close they are and what to do.
LANGUAGE NOTE: Say "amount you owe" - NOT "outstanding." Say "monthly payments" - NOT "obligations."
SEGMENT BOUNDARY: ONLY discuss self-help strategies and FREED tools (Goal Tracker, Credit Insights). NEVER mention or recommend DRP (settlement), DEP (elimination), or DCP as a current option. This user does not qualify for any debt program.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Same structure as eligible users but no DCP mention. Focus on Goal Tracker and Credit Insights as tools.
- INTENT_EMI_OPTIMISATION: Show current situation and what's blocking eligibility (score < 700 or amount < 1.5L). Suggest alternatives: refinancing, snowball repayment, rate negotiation. NO consolidation suggestions.
- INTENT_EMI_STRESS: Focus on payment tracking with inferred due dates from lastPaymentDate. Suggest Goal Tracker for due date management. Use Credit Insights for monthly updates. Show gap to DCP eligibility as motivation.
- INTENT_LOAN_ELIGIBILITY: Explain why rejections happen using their actual data. Provide numbered improvement steps toward eligibility.
- INTENT_GOAL_BASED_PATH: All solutions exclude DCP. Focus on self-help strategies and FREED tools (Goal Tracker, Credit Insights).`,

  DEP: `This user has active loans with less than half their income going to EMIs (FOIR < 50%) - they can repay but would benefit from a structured strategy.
Recommend the Debt Elimination Program for faster payoff with priority-based repayment.
Key talking points: interest savings, faster debt-free timeline, structured repayment plan.
This user is in relatively good financial health - focus on optimization rather than rescue.
IMPORTANT: This user likely came from a campaign about "saving interest" or "becoming debt-free faster." Start with how much interest they could save, then introduce the structured approach.
LANGUAGE NOTE: Say "percentage of income going to EMIs" - NOT "FOIR" until Phase 2.
SEGMENT BOUNDARY: ONLY discuss DEP. NEVER mention or recommend DRP (settlement), DCP (consolidation), or any other program. This user's path is accelerated repayment through DEP only.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Lead with their credit score snapshot, then actionable steps, then FREED tools. Use real numbers.
- INTENT_INTEREST_OPTIMISATION: Lead with interest profile and highest-ROI accounts, then reduction strategies, then position DEP as the structured path.
- INTENT_GOAL_BASED_LOAN: Assess loan readiness based on score and FOIR. Strong profiles get optimization tips; weaker profiles get improvement steps with specific targets.
- INTENT_CREDIT_SCORE_TARGET: Provide a numbered action plan toward the target score. Each step must be distinct and reference specific accounts/metrics.
- INTENT_PROFILE_ANALYSIS: Give a holistic snapshot - score, FOIR, income, accounts - then highlight strengths and improvement areas.`,

  NTC: `This user has no credit history - they are New to Credit.
Focus on credit building advice and financial education.
Recommend FREED Credit Insights (₹99/month) for monitoring and learning about credit.
Be encouraging - they're at the start of their financial journey.
SEGMENT BOUNDARY: ONLY discuss credit building and Credit Insights. NEVER mention or recommend DRP, DCP, or DEP. This user has no debt to settle, consolidate, or eliminate.`,

  Others: `This user has credit history but no active loans currently.
Focus on financial wellness, credit health maintenance, and goal tracking.
Recommend Credit Insights and Goal Tracker for maintaining and improving their financial profile.
They may be exploring credit options or just want to understand their credit better.`,
};

/**
 * Conversation starters are now GOAL-ORIENTED - they reflect what users
 * actually think/say when they arrive from marketing campaigns, NOT
 * FREED's internal program names.
 *
 * The journey: User's pain point > Data-driven diagnosis > Solution concept > Program redirect
 *
 * NOTE: Score target starters are generated dynamically by getStartersForUser()
 * which replaces the placeholder {SCORE_TARGET} with the user's actual target.
 */
export const conversationStarters: Record<Segment, ConversationStarter[]> = {
  // Position 1: primary pain point | Position 2: ALWAYS credit score | 3+: other relevant options
  DRP_Eligible: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "Unable to pay my EMI and credit card dues", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
    { text: "Recovery agents keep calling me", intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: "Help me reach a credit score of {SCORE_TARGET}", intentTag: 'INTENT_CREDIT_SCORE_TARGET', redirectTo: '/goal-tracker' },
    { text: "I want to get a loan - what should I do?", intentTag: 'INTENT_GOAL_BASED_LOAN', redirectTo: '/drp' },
  ],

  DRP_Ineligible: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I'm struggling with payments - what can I do?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/credit-score' },
    { text: "Recovery agents won't stop calling me", intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: "Help me reach a credit score of {SCORE_TARGET}", intentTag: 'INTENT_CREDIT_SCORE_TARGET', redirectTo: '/goal-tracker' },
    { text: "What are my options to manage my debt?", intentTag: 'INTENT_GOAL_BASED_LOAN', redirectTo: '/credit-score' },
  ],

  DCP_Eligible: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I want to reduce my monthly EMI burden", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: "Managing multiple EMI payments is stressful", intentTag: 'INTENT_EMI_STRESS', redirectTo: '/dcp' },
    { text: "Help me reach a credit score of {SCORE_TARGET}", intentTag: 'INTENT_CREDIT_SCORE_TARGET', redirectTo: '/goal-tracker' },
    { text: "What's the best path for my financial goal?", intentTag: 'INTENT_GOAL_BASED_PATH', redirectTo: '/dcp' },
  ],

  DCP_Ineligible: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "How can I get a lower EMI?", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/credit-score' },
    { text: "Managing multiple payments is overwhelming", intentTag: 'INTENT_EMI_STRESS', redirectTo: '/credit-score' },
    { text: "My loan applications keep getting rejected", intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: "What's the best path for my financial goal?", intentTag: 'INTENT_GOAL_BASED_PATH', redirectTo: '/goal-tracker' },
  ],

  DEP: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "Am I paying too much interest on my loans?", intentTag: 'INTENT_INTEREST_OPTIMISATION', redirectTo: '/dep' },
    { text: "I want to get the best rate on my next loan", intentTag: 'INTENT_GOAL_BASED_LOAN', redirectTo: '/credit-score' },
    { text: "Help me reach a credit score of {SCORE_TARGET}", intentTag: 'INTENT_CREDIT_SCORE_TARGET', redirectTo: '/goal-tracker' },
    { text: "What does my financial profile look like?", intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/credit-score' },
  ],

  NTC: [
    { text: "What is a credit score and why does it matter?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: "How do I start building my credit?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I want to get a loan - what do I need?", intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: "How can FREED help someone like me?", intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/' },
  ],

  Others: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I want to reach {SCORE_TARGET} - can you help?", intentTag: 'INTENT_GOAL_TRACKING', redirectTo: '/goal-tracker' },
    { text: "What's affecting my credit score the most?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: "Should I close my old credit cards?", intentTag: 'INTENT_BEHAVIOUR_IMPACT', redirectTo: '/credit-score' },
  ],
};
