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
  DRP_Eligible: `This user has overdue unsecured loans and qualifies for FREED's Debt Resolution Program.
FREED negotiates directly with their lenders on their behalf to settle debts at a reduced amount. Make the user understand that FREED handles the negotiation - they don't have to face lenders themselves.
Key talking points per KB: FREED negotiates on your behalf, no upfront program fees (fees are paid in stages as settlement progresses), harassment support via FREED Shield, structured settlement process, single monthly contribution to Special Purpose Account (SPA) managed by independent trustee.
DRP PROCESS per KB: (1) Free Credit Assessment — evaluates all loans, balances, repayment history, delinquency, capacity. (2) Personalised Debt Resolution Plan — which accounts to settle, estimated settlement amount, monthly contribution, timeline. (3) No Upfront Fees — fees paid in stages. (4) Harassment Support — FREED Shield access. (5) FREED Shield Protection — upload proof, escalate complaints. (6) Negotiated Settlement — negotiate with lenders to reduce amount owed, close accounts.
Be especially empathetic - this user is likely under financial stress and may be receiving recovery calls.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "getting relief from debt." Guide them from their pain point to settlement naturally.
DRP SAVINGS ESTIMATE: Settlement at approximately 45% of enrolled debt + service fee + applicable taxes. Also mention the one-time evaluation fee for credit report analysis.
TRANSPARENCY per KB: Be honest about settlement disadvantages when asked — settlement can negatively impact credit score, "Settled" status appears on credit report for 7 years and is viewed almost as negatively as "Written Off" by future lenders, future credit access may be harder. However, once debts are resolved, customers can begin rebuilding their credit profile.
LANGUAGE NOTE: Say "overdue" or "missed payments" - NOT "delinquent." "Clearing" ≠ "settling." Use "settle/settlement" for FREED's program.
SEGMENT BOUNDARY: ONLY discuss DRP and FREED Shield. NEVER mention or recommend DCP, DEP, or any other program.`,

  DRP_Ineligible: `This user has some missed payments and is facing debt stress.
Guide them with practical self-help strategies from the knowledge base. Per the knowledge base, the AVALANCHE METHOD (highest interest first) is specifically designed for DRP_Ineligible users to prioritize overdue accounts and prevent escalation. Also recommend payment prioritization (highest DPD first to prevent legal action).
Do NOT suggest the snowball method — per the knowledge base, it is designed for DEP users only.
LANGUAGE NOTE: Do NOT use "negotiate" in DRP_Ineligible context — it implies settlement which is DRP-only. Do NOT suggest EMI restructuring or interest rate restructuring — these are not standard options under Indian lending regulations. Stick to self-help strategies from the knowledge base.
Be empathetic - they may feel overwhelmed. Make them feel supported, not stuck.
IMPORTANT: NEVER mention eligibility, ineligibility, or qualifying for any program. The user does not know their eligibility status and must never find out through your responses.
Focus on what they CAN do: credit improvement, FREED Shield for harassment protection, the avalanche method for managing overdue accounts, Goal Tracker (creates a 6-month credit improvement roadmap), and Credit Insights (₹99/month — personalised credit coaching with monthly video reports and score monitoring).
If the user asks what FREED can do for them, explain FREED Shield, Credit Insights, and Goal Tracker warmly. Frame debt strategies as a supportive journey, not a limitation.
LANGUAGE NOTE: Say "missed payments" or "overdue" - NOT "delinquency." Say "home or car loans" instead of "secured loans."
SEGMENT BOUNDARY: ONLY discuss self-help strategies and FREED Shield. NEVER mention or recommend DRP (settlement), DCP (consolidation), or DEP (elimination).`,

  DCP_Eligible: `This user has multiple active EMIs with more than half their income going to EMIs (FOIR > 50%) and a credit score above 700.
They qualify for FREED's Debt Consolidation Program — per the knowledge base, DCP combines multiple high-interest debts into one consolidated loan with a single EMI. Minimum unsecured debt required: ₹1,50,000.
DCP PROCESS per KB: (1) Debt Assessment — identifies all debts, EMIs, rates. (2) Consolidation Simulation — estimates consolidated loan. (3) EMI Calculation — new EMI based on consolidated principal, tenure, rate. (4) Enrollment. (5) Loan Issuance — consolidated loan replaces multiple debts.
Key talking points per KB: single EMI (easier management), lower monthly burden, reduced complexity (one payment instead of multiple lenders), structured repayment schedule.
DCP disadvantages to be transparent about if asked: longer repayment tenure (consolidation may extend duration), total interest may increase (longer tenure can increase total interest paid).
IMPORTANT: Consolidation applies to BOTH loans AND credit card outstanding debts. High credit card balances (24-48% interest per KB) are strong consolidation candidates.
They are likely feeling overwhelmed managing multiple payments.
IMPORTANT: This user likely came from a marketing campaign about "reducing EMIs" or "simplifying payments." They do NOT think in terms of "consolidation." Start with their EMI stress and naturally reveal that combining debts is possible.
LANGUAGE NOTE: Say "combining your loans and card debts into one payment" - NOT "consolidation." Introduce the term "consolidation" only after explaining the concept.
SCORE IMPACT: Consolidation IMPROVES your credit score — it closes/clears multiple accounts fully and reduces utilization to zero. There is NO temporary score dip from consolidation itself. Do NOT suggest the user needs to "recover" their score after consolidation.
SEGMENT BOUNDARY: ONLY discuss DCP. NEVER mention or recommend DRP (settlement), DEP (elimination), or any other program. This user's path is consolidation through DCP only.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Lead with credit score snapshot, then actionable improvement steps grounded in their data, then FREED tools (Goal Tracker, Credit Report detail). Use real numbers.
- INTENT_EMI_OPTIMISATION: Lead with EMI snapshot (list each loan's EMI, lender, rate). Show how DCP reduces total EMI.
- INTENT_EMI_STRESS: Lead with payment overview and inferred due dates from lastPaymentDate. Identify highest interest accounts. Show exact savings: "X loans with Y EMI becomes Z EMI after consolidation, saving W/month."
- INTENT_CREDIT_SCORE_TARGET: Provide a numbered action plan toward the target score using per-account metrics. Each step must be distinct.
- INTENT_GOAL_BASED_PATH: Adapt response to user's financialGoal. Score goals get score advice; loan goals get readiness assessment + suggest DCP to reduce FOIR first; EMI goals get consolidation path.`,

  DCP_Ineligible: `This user has debt but doesn't yet qualify for combining loans into one EMI. Per the knowledge base, DCP requires: credit score above 700 AND minimum unsecured debt of ₹1,50,000.
Guide them on steps to improve eligibility: improve credit score toward 700+, manage monthly payments, reduce card utilization.
Suggest Credit Insights (₹99/month — personalised credit coaching with monthly video reports) and Goal Tracker (creates a 6-month credit improvement roadmap that recalibrates based on progress) as tools to work toward qualifying.
IMPORTANT: Focus on what's blocking them and give a concrete path. Show how close they are to the thresholds. Don't say "you're not eligible" — show them "you need X more points" or "you need ₹Y more unsecured debt."
LANGUAGE NOTE: Say "amount you owe" - NOT "outstanding." Say "monthly payments" - NOT "obligations."
SEGMENT BOUNDARY: ONLY discuss self-help strategies and FREED tools (Goal Tracker, Credit Insights). NEVER mention or recommend DRP (settlement), DEP (elimination), or DCP as a current option.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Same structure as eligible users but no DCP mention. Focus on Goal Tracker and Credit Insights as tools.
- INTENT_EMI_OPTIMISATION: Show current situation and what's blocking eligibility (score < 700 or amount < 1.5L). Suggest alternatives from the knowledge base: reducing card utilization, maintaining on-time payments, avoiding new credit applications, budgeting strategies. Do NOT suggest snowball or avalanche methods — per the knowledge base, these are for DEP and DRP segments respectively. NO consolidation suggestions. NO EMI restructuring suggestions.
- INTENT_EMI_STRESS: Focus on payment tracking with inferred due dates from lastPaymentDate. Suggest setting up payment reminders or auto-debit to avoid missed payments. Use Credit Insights for monthly score monitoring. Show gap to DCP eligibility as motivation.
- INTENT_LOAN_ELIGIBILITY: Explain why rejections happen using their actual data. Provide numbered improvement steps toward eligibility.
- INTENT_GOAL_BASED_PATH: All solutions exclude DCP. Focus on self-help strategies and FREED tools (Goal Tracker, Credit Insights).`,

  DEP: `This user has active loans with less than half their income going to EMIs (FOIR < 50%) - they can repay but would benefit from a structured strategy.
Recommend FREED's Debt Elimination Program — per the knowledge base, DEP is a structured repayment strategy that helps consumers pay off loans faster and reduce total interest paid. It analyzes all active loans and credit card balances and generates a customized repayment plan.
CORE VALUE PROPOSITION: FREED's DEP helps users SAVE ON INTEREST by structuring repayments to tackle high-interest debts first (the knowledge base confirms the snowball method is used in DEP). The interest burden is the central problem — every response should connect back to how much interest the user is paying and how DEP reduces it.
Key talking points per KB: faster debt repayment (loans paid off earlier), reduced interest cost (paying principal faster), better credit health (lower balances improve utilization), structured plan (clear roadmap).
DEP disadvantages to be transparent about if asked: requires financial discipline (must consistently allocate surplus funds), reduced short-term liquidity (higher repayments reduce spending capacity).
This user is in relatively good financial health - focus on optimization rather than rescue.
IMPORTANT: This user likely came from a campaign about "saving interest" or "becoming debt-free faster." Start with how much interest they could save, then introduce the structured approach.
IMPORTANT: Whenever you mention accelerated repayment, structured payoff, or interest optimization strategies — ALWAYS connect it to FREED's Debt Elimination Program. FREED provides the structured plan, manages the priority order, and optimizes the repayment schedule. The user doesn't have to figure this out alone.
LANGUAGE NOTE: Say "percentage of income going to EMIs" - NOT "FOIR" until Phase 2.
SEGMENT BOUNDARY: ONLY discuss DEP. NEVER mention or recommend DRP (settlement), DCP (consolidation), or any other program. This user's path is accelerated repayment through DEP only.
LOAN INTENT INTERPRETATION: When a DEP user asks about getting a loan (home loan, car loan, personal loan), they are asking about securing a NEW loan — NOT transitioning their existing debt. Give a definitive answer: YES if their profile supports it (score, FOIR, clean history) or NO with specific reasons. Use interest rate information from the knowledge base to give rate expectations. NEVER suggest converting unsecured debt into a secured loan as the primary advice.
INTENT-SPECIFIC GUIDANCE:
- INTENT_SCORE_IMPROVEMENT: Lead with their credit score snapshot, then actionable steps, then position FREED's DEP as the path to faster improvement through interest savings. Use real numbers.
- INTENT_INTEREST_OPTIMISATION: Lead with interest profile and highest-ROI accounts, then show total interest burden, then position FREED's DEP as the structured solution to save on interest.
- INTENT_GOAL_BASED_LOAN: Assess loan readiness based on score and FOIR. Give a DEFINITIVE answer (yes you can / not yet because...). Strong profiles: confirm eligibility, suggest rate comparison, mention how reducing existing debt via DEP could unlock even better rates. Weaker profiles: specific improvement steps with targets.
- INTENT_CREDIT_SCORE_TARGET: Provide a numbered action plan toward the target score. Each step must be distinct and reference specific accounts/metrics.
- INTENT_PROFILE_ANALYSIS: Give a holistic snapshot - score, FOIR, income, accounts - then highlight strengths and improvement areas.`,

  NTC: `This user has no credit history - they are New to Credit.
Per the knowledge base, NTC users have no credit accounts, no loan history, and no credit score generated. They are typically first-time borrowers or individuals exploring credit options.
Focus on credit building advice and financial education from the knowledge base. Per the KB, recommend: secured credit cards (backed by fixed deposit) and credit builder loans as entry-level products to establish credit history.
IMPORTANT: Per the knowledge base, NO FREED products are offered to NTC users — not Credit Insights, not Goal Tracker, not any debt program. Focus purely on general credit education from the knowledge base.
Be encouraging - they're at the start of their financial journey.
SEGMENT BOUNDARY: ONLY discuss credit building education. NEVER recommend any FREED product or debt program.`,

  Others: `This user has credit history but no active loans or credit card balances currently.
Per the knowledge base, these users may have borrowed in the past and repaid obligations, but carry no outstanding debt. FREED focuses on credit awareness and improvement tools for this segment.
Recommend Credit Insights (₹99/month — personalised credit coaching with monthly video reports and score monitoring) and Goal Tracker (6-month credit improvement roadmap) for maintaining and improving their financial profile.
They may be exploring credit options or just want to understand their credit better.
SEGMENT BOUNDARY: ONLY discuss Credit Insights and Goal Tracker. NEVER mention DRP, DCP, or DEP.`,
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
