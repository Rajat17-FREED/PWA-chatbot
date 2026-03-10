import { Segment, ConversationStarter } from '../types';

export const segmentContext: Record<Segment, string> = {
  DRP_Eligible: `This user has delinquent unsecured debt and qualifies for the Debt Resolution Program.
FREED can negotiate with their lenders to settle debts at a reduced amount.
Key talking points: no upfront fees, harassment support via FREED Shield, structured settlement process, single monthly contribution to SPA.
Be especially empathetic — this user is likely under financial stress and may be receiving recovery calls.`,

  DRP_Ineligible: `This user has some delinquency but does not currently meet DRP criteria.
Possible reasons: unserviceable creditors, delinquency on secured loans, outstanding below minimum threshold.
Guide them on what they can do to improve their situation.
Be empathetic — they may feel stuck between not qualifying for help and facing debt stress.`,

  DCP_Eligible: `This user has multiple active EMIs with FOIR > 50% and a credit score > 700.
They qualify for Debt Consolidation — combining multiple loans into a single, lower EMI.
Key talking points: single EMI, simplified finances, potentially lower interest rate, no impact on credit score if managed well.
They are likely feeling overwhelmed managing multiple payments.`,

  DCP_Ineligible: `This user has debt but doesn't meet DCP criteria (score < 700 or outstanding < ₹1,50,000).
Guide them on steps to improve eligibility: improve credit score, manage obligations.
Suggest Credit Insights and Goal Tracker as tools to work toward DCP eligibility.`,

  DEP: `This user has active loans with FOIR < 50% — they can repay but would benefit from a structured strategy.
Recommend the Debt Elimination Program for faster payoff with priority-based repayment.
Key talking points: interest savings, faster debt-free timeline, structured repayment plan.
This user is in relatively good financial health — focus on optimization rather than rescue.`,

  NTC: `This user has no credit history — they are New to Credit.
Focus on credit building advice and financial education.
Recommend FREED Credit Insights (₹99/month) for monitoring and learning about credit.
Be encouraging — they're at the start of their financial journey.`,

  Others: `This user has credit history but no active loans currently.
Focus on financial wellness, credit health maintenance, and goal tracking.
Recommend Credit Insights and Goal Tracker for maintaining and improving their financial profile.
They may be exploring credit options or just want to understand their credit better.`,
};

export const conversationStarters: Record<Segment, ConversationStarter[]> = {
  NTC: [
    { text: 'What is a credit score and why does it matter?', intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: 'How do I start building my credit?', intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: 'I want to get a loan — what score do I need?', intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: 'What is FREED and how can it help me?', intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/' },
  ],

  Others: [
    { text: 'How can I improve my credit score?', intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
    { text: 'I want to reach 750+ score — can you help?', intentTag: 'INTENT_GOAL_TRACKING', redirectTo: '/goal-tracker' },
    { text: 'What is affecting my credit score?', intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/credit-score' },
    { text: 'Should I close my old credit cards?', intentTag: 'INTENT_BEHAVIOUR_IMPACT', redirectTo: '/credit-score' },
  ],

  DEP: [
    { text: 'How can I close my loans faster?', intentTag: 'INTENT_INTEREST_OPTIMISATION', redirectTo: '/dep' },
    { text: 'Which loan should I pay off first?', intentTag: 'INTENT_INTEREST_OPTIMISATION', redirectTo: '/dep' },
    { text: 'How much interest can I save with prepayment?', intentTag: 'INTENT_INTEREST_OPTIMISATION', redirectTo: '/dep' },
    { text: 'What is the Debt Elimination Program?', intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/dep' },
    { text: 'How can I improve my credit score?', intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
  ],

  DRP_Eligible: [
    { text: "I can't pay my EMIs — what are my options?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
    { text: 'How does loan settlement work?', intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
    { text: 'Recovery agents are calling me — what should I do?', intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: 'Will settlement affect my credit score?', intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/drp' },
    { text: 'What is a Special Purpose Account?', intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/drp' },
  ],

  DRP_Ineligible: [
    { text: "I'm missing EMI payments — what can I do?", intentTag: 'INTENT_DELINQUENCY_STRESS', redirectTo: '/credit-score' },
    { text: 'Why am I not eligible for loan settlement?', intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/drp' },
    { text: 'Recovery agents are harassing me', intentTag: 'INTENT_HARASSMENT', redirectTo: '/freed-shield' },
    { text: 'How can I improve my financial situation?', intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
  ],

  DCP_Eligible: [
    { text: 'I have too many loans — can I combine them?', intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: 'How does loan consolidation work?', intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: 'Can consolidation reduce my monthly EMI?', intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
    { text: 'Will consolidation affect my credit score?', intentTag: 'INTENT_SCORE_DIAGNOSIS', redirectTo: '/dcp' },
    { text: 'Which loans can I consolidate?', intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/dcp' },
  ],

  DCP_Ineligible: [
    { text: 'Why am I not eligible for loan consolidation?', intentTag: 'INTENT_PROFILE_ANALYSIS', redirectTo: '/dcp' },
    { text: 'How can I reduce my EMI burden?', intentTag: 'INTENT_EMI_OPTIMISATION', redirectTo: '/credit-score' },
    { text: 'Why is my loan application getting rejected?', intentTag: 'INTENT_LOAN_ELIGIBILITY', redirectTo: '/credit-score' },
    { text: 'How can I improve my credit score to qualify?', intentTag: 'INTENT_SCORE_IMPROVEMENT', redirectTo: '/goal-tracker' },
  ],
};
