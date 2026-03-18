import { Segment, ConversationStarter } from '../types';

export const segmentContext: Record<Segment, string> = {
  DRP_Eligible: `This user has overdue unsecured loans and qualifies for the Debt Resolution Program.
FREED can negotiate with their lenders to settle debts at a reduced amount.
Key talking points: no upfront fees, harassment support via FREED Shield, structured settlement process, single monthly contribution to SPA.
Be especially empathetic — this user is likely under financial stress and may be receiving recovery calls.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "getting relief from debt." They do NOT know what "Debt Resolution Program" means. Guide them from their pain point to the concept of settlement naturally.
LANGUAGE NOTE: Say "overdue" or "missed payments" — NOT "delinquent" or "delinquency." The user doesn't know these terms.`,

  DRP_Ineligible: `This user has some missed payments but does not currently meet DRP criteria.
Possible reasons: unserviceable creditors, missed payments on secured loans (like home or car loans), amount owed below minimum threshold.
Guide them on what they can do to improve their situation.
Be empathetic — they may feel stuck between not qualifying for help and facing debt stress.
IMPORTANT: Don't mention DRP by name unless they ask. Focus on what they CAN do — credit improvement, FREED Shield for harassment, and steps toward eligibility.
LANGUAGE NOTE: Say "missed payments" or "overdue" — NOT "delinquency." Say "home or car loans" instead of "secured loans."`,

  DCP_Eligible: `This user has multiple active EMIs with more than half their income going to EMIs (FOIR > 50%) and a credit score above 700.
They qualify for combining multiple loans into a single, lower EMI (Debt Consolidation Program).
Key talking points: single EMI, simplified finances, potentially lower interest rate, no impact on credit score if managed well.
They are likely feeling overwhelmed managing multiple payments.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "simplifying payments." They do NOT think in terms of "consolidation." Start with their EMI stress and naturally reveal that combining loans is possible.
LANGUAGE NOTE: Say "combining your loans into one payment" — NOT "consolidation." Introduce the term "consolidation" only after explaining the concept.`,

  DCP_Ineligible: `This user has debt but doesn't yet qualify for combining loans into one EMI (score below 700 or amount owed below ₹1,50,000).
Guide them on steps to improve eligibility: improve credit score, manage monthly payments.
Suggest Credit Insights and Goal Tracker as tools to work toward qualifying.
IMPORTANT: Focus on what's blocking them (usually credit score) and give them a concrete path. Don't just say "you're not eligible" — show them how close they are and what to do.
LANGUAGE NOTE: Say "amount you owe" — NOT "outstanding." Say "monthly payments" — NOT "obligations."`,

  DEP: `This user has active loans with less than half their income going to EMIs (FOIR < 50%) — they can repay but would benefit from a structured strategy.
Recommend the Debt Elimination Program for faster payoff with priority-based repayment.
Key talking points: interest savings, faster debt-free timeline, structured repayment plan.
This user is in relatively good financial health — focus on optimization rather than rescue.
IMPORTANT: This user likely came from a campaign about "saving interest" or "becoming debt-free faster." Start with how much interest they could save, then introduce the structured approach.
LANGUAGE NOTE: Say "percentage of income going to EMIs" — NOT "FOIR" until Phase 2.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Lead with their credit score snapshot, then actionable steps, then FREED tools. Use real numbers.
- INTENT_INTEREST_OPTIMISATION: Lead with interest profile and highest-ROI accounts, then reduction strategies, then position DEP as the structured path.
- INTENT_GOAL_BASED_LOAN: Assess loan readiness based on score and FOIR. Strong profiles get optimization tips; weaker profiles get improvement steps with specific targets.
- INTENT_CREDIT_SCORE_TARGET: Provide a numbered action plan toward the target score. Each step must be distinct and reference specific accounts/metrics.
- INTENT_PROFILE_ANALYSIS: Give a holistic snapshot — score, FOIR, income, accounts — then highlight strengths and improvement areas.`,

  NTC: `This user has no credit history — they are New to Credit.
Focus on credit building advice and financial education.
Recommend FREED Credit Insights (₹99/month) for monitoring and learning about credit.
Be encouraging — they're at the start of their financial journey.`,

  Others: `This user has credit history but no active loans currently.
Focus on financial wellness, credit health maintenance, and goal tracking.
Recommend Credit Insights and Goal Tracker for maintaining and improving their financial profile.
They may be exploring credit options or just want to understand their credit better.`,
};

/**
 * Conversation starters are now GOAL-ORIENTED — they reflect what users
 * actually think/say when they arrive from marketing campaigns, NOT
 * FREED's internal program names.
 *
 * The journey: User's pain point → Data-driven diagnosis → Solution concept → Program redirect
 */
export const conversationStarters: Record<Segment, ConversationStarter[]> = {
  // Position 1: primary pain point | Position 2: ALWAYS credit score | 3+: other relevant options
  DRP_Eligible: [
    { text: "My EMIs are overwhelming — what can I do?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "Recovery agents keep calling me", intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: "I've missed payments — will my score recover?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/drp' },
    { text: "How can I reduce what I owe to my lenders?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
  ],

  DRP_Ineligible: [
    { text: "I'm struggling with payments — what are my options?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/credit-score' },
    { text: "What's hurting my credit score the most?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: "Recovery agents won't stop calling me", intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: "How can I get back on track financially?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
  ],

  DCP_Eligible: [
    { text: "I want to reduce my monthly EMI burden", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "Managing multiple loan payments is stressful", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: "Why is so much of my salary going to EMIs?", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: "Can I simplify all my loans into one payment?", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
  ],

  DCP_Ineligible: [
    { text: "How can I get a lower EMI?", intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/credit-score' },
    { text: "How do I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "My loan applications keep getting rejected", intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: "What do I need to qualify for better loan terms?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
  ],

  DEP: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "Am I paying too much interest on my loans?", intentTag: 'INTENT_INTEREST_OPTIMISATION', redirectTo: '/dep' },
    { text: "I want to get the best rate on my next loan", intentTag: 'INTENT_GOAL_BASED_LOAN', redirectTo: '/credit-score' },
    { text: "How do I get my score above 750?", intentTag: 'INTENT_CREDIT_SCORE_TARGET', redirectTo: '/goal-tracker' },
    { text: "What does my financial profile look like?", intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/credit-score' },
  ],

  NTC: [
    { text: "What is a credit score and why does it matter?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: "How do I start building my credit?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I want to get a loan — what do I need?", intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: "How can FREED help someone like me?", intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/' },
  ],

  Others: [
    { text: "How can I improve my credit score?", intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: "I want to reach 750+ — can you help?", intentTag: 'INTENT_GOAL_TRACKING', redirectTo: '/goal-tracker' },
    { text: "What's affecting my credit score the most?", intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: "Should I close my old credit cards?", intentTag: 'INTENT_BEHAVIOUR_IMPACT', redirectTo: '/credit-score' },
  ],
};
