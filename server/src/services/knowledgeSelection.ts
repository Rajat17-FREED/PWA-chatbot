/**
 * Knowledge Selection Service — section-based KB retrieval.
 *
 * Instead of dumping the entire 1600-line knowledge base into every prompt,
 * this service splits it into labeled sections and selects only the relevant
 * ones based on user segment, intent, and message keywords.
 *
 * This makes responses more specific and reduces token waste.
 */

interface KBSection {
  id: string;
  title: string;
  tags: string[];       // used for matching
  content: string;
}

let sections: KBSection[] = [];

/**
 * Split the knowledge base text into labeled sections at load time.
 * Called once at startup.
 */
export function indexKnowledgeBase(rawText: string): void {
  if (sections.length > 0) return;

  // Define section boundaries — these are the major topics in the KB
  const sectionDefs: Array<{ id: string; title: string; tags: string[]; startPattern: RegExp; endPattern?: RegExp }> = [
    {
      id: 'company_overview',
      title: 'FREED Company Overview',
      tags: ['freed', 'company', 'about', 'what is freed', 'overview', 'general'],
      startPattern: /^FREED — Company Overview/m,
      endPattern: /^Section 2/m,
    },
    {
      id: 'customer_segments',
      title: 'Customer Segments',
      tags: ['segment', 'eligibility', 'ntc', 'new to credit', 'drp eligible', 'dcp eligible', 'dep', 'ineligible', 'why not eligible'],
      startPattern: /^Section 2 — Customer Segments/m,
      endPattern: /^Section 3/m,
    },
    {
      id: 'program_dep',
      title: 'Debt Elimination Program (DEP)',
      tags: ['dep', 'debt elimination', 'pay off faster', 'reduce interest', 'accelerated repayment', 'foir less than 50', 'structured repayment'],
      startPattern: /^1\. DEP — Debt Elimination Program/m,
      endPattern: /^2\. DCP — Debt Consolidation Program/m,
    },
    {
      id: 'program_dcp',
      title: 'Debt Consolidation Program (DCP)',
      tags: ['dcp', 'debt consolidation', 'single emi', 'combine loans', 'multiple emis', 'consolidation', 'lower emi', 'foir greater than 50'],
      startPattern: /^2\. DCP — Debt Consolidation Program/m,
      endPattern: /^3\. DRP — Debt Resolution Program/m,
    },
    {
      id: 'program_drp',
      title: 'Debt Resolution Program (DRP)',
      tags: ['drp', 'debt resolution', 'settlement', 'negotiate', 'lender negotiation', 'reduce debt', 'settle for less', 'delinquent', 'collections', 'harassment'],
      startPattern: /^3\. DRP — Debt Resolution Program/m,
      endPattern: /^Section 4/m,
    },
    {
      id: 'product_credit_insights',
      title: 'Credit Insights',
      tags: ['credit insights', 'credit score', 'credit report', 'credit health', 'score improvement', 'cibil', 'credit monitoring'],
      startPattern: /^1\. Credit Insights/m,
      endPattern: /^5\. Goal Tracker/m,
    },
    {
      id: 'product_goal_tracker',
      title: 'Goal Tracker',
      tags: ['goal tracker', 'score goal', 'target score', 'track progress', 'improvement plan'],
      startPattern: /^5\. Goal Tracker/m,
      endPattern: /^6\. FREED Shield/m,
    },
    {
      id: 'product_shield',
      title: 'FREED Shield',
      tags: ['shield', 'freed shield', 'harassment', 'recovery agent', 'recovery calls', 'legal protection', 'stop calls', 'collection agent'],
      startPattern: /^6\. FREED Shield/m,
    },
  ];

  for (const def of sectionDefs) {
    const startMatch = rawText.match(def.startPattern);
    if (!startMatch || startMatch.index === undefined) continue;

    const startIdx = startMatch.index;
    let endIdx = rawText.length;

    if (def.endPattern) {
      const endMatch = rawText.slice(startIdx + 1).match(def.endPattern);
      if (endMatch && endMatch.index !== undefined) {
        endIdx = startIdx + 1 + endMatch.index;
      }
    }

    sections.push({
      id: def.id,
      title: def.title,
      tags: def.tags,
      content: rawText.slice(startIdx, endIdx).trim(),
    });
  }

  console.log(`Knowledge base indexed: ${sections.length} sections`);
}

/**
 * Select relevant KB sections based on segment, intent, and user message.
 * Returns a combined string of only the relevant sections.
 */
export function selectKnowledge(
  segment?: string,
  intentTag?: string,
  userMessage?: string,
  messageCount: number = 0
): string {
  if (sections.length === 0) return ''; // KB not indexed yet

  const selected = new Set<string>();

  // ── Always include company overview on first message ─────────────────────
  if (messageCount <= 1) {
    selected.add('company_overview');
  }

  // ── Segment-based selection ──────────────────────────────────────────────
  if (segment) {
    // Always include the segments section for eligibility context
    selected.add('customer_segments');

    switch (segment) {
      case 'DRP_Eligible':
        selected.add('program_drp');
        selected.add('product_shield');
        break;
      case 'DRP_Ineligible':
        selected.add('program_drp'); // so bot can explain why not eligible
        selected.add('product_shield');
        selected.add('product_credit_insights');
        break;
      case 'DCP_Eligible':
        selected.add('program_dcp');
        break;
      case 'DCP_Ineligible':
        selected.add('program_dcp'); // explain why not eligible
        selected.add('product_credit_insights');
        selected.add('product_goal_tracker');
        break;
      case 'DEP':
        selected.add('program_dep');
        break;
      case 'NTC':
        selected.add('product_credit_insights');
        break;
      case 'Others':
        selected.add('product_credit_insights');
        selected.add('product_goal_tracker');
        break;
    }
  }

  // ── Intent-based selection ───────────────────────────────────────────────
  if (intentTag) {
    switch (intentTag) {
      case 'INTENT_HARASSMENT':
        selected.add('product_shield');
        selected.add('program_drp');
        break;
      case 'INTENT_SCORE_IMPROVEMENT':
      case 'INTENT_SCORE_DIAGNOSIS':
      case 'INTENT_GOAL_TRACKING':
        selected.add('product_credit_insights');
        selected.add('product_goal_tracker');
        break;
      case 'INTENT_LOAN_ELIGIBILITY':
        selected.add('product_credit_insights');
        selected.add('customer_segments');
        break;
      case 'INTENT_DELINQUENCY_STRESS':
        selected.add('program_drp');
        selected.add('product_shield');
        break;
      case 'INTENT_EMI_OPTIMISATION':
        selected.add('program_dcp');
        selected.add('program_dep');
        break;
      case 'INTENT_INTEREST_OPTIMISATION':
        selected.add('program_dep');
        selected.add('program_dcp');
        break;
      case 'INTENT_GOAL_BASED_LOAN':
        selected.add('program_dep');
        selected.add('product_credit_insights');
        selected.add('customer_segments');
        break;
      case 'INTENT_CREDIT_SCORE_TARGET':
        selected.add('product_credit_insights');
        selected.add('product_goal_tracker');
        break;
      case 'INTENT_PROFILE_ANALYSIS':
        selected.add('program_dep');
        selected.add('product_credit_insights');
        selected.add('customer_segments');
        break;
    }
  }

  // ── Keyword-based selection from user message ────────────────────────────
  if (userMessage) {
    const lower = userMessage.toLowerCase();

    const keywordMap: Record<string, string[]> = {
      'settlement': ['program_drp'],
      'settle': ['program_drp'],
      'negotiate': ['program_drp'],
      'reduce debt': ['program_drp'],
      'consolidat': ['program_dcp'],
      'combine': ['program_dcp'],
      'single emi': ['program_dcp'],
      'eliminate': ['program_dep'],
      'pay off faster': ['program_dep'],
      'pay off': ['program_dep'],
      'interest': ['program_dep', 'program_dcp'],
      'harassment': ['product_shield'],
      'recovery': ['product_shield'],
      'calls': ['product_shield'],
      'shield': ['product_shield'],
      'credit score': ['product_credit_insights'],
      'cibil': ['product_credit_insights'],
      'improve score': ['product_credit_insights', 'product_goal_tracker'],
      'goal': ['product_goal_tracker'],
      'target': ['product_goal_tracker'],
      'track': ['product_goal_tracker'],
      'eligible': ['customer_segments'],
      'qualify': ['customer_segments'],
      'how freed': ['company_overview'],
      'what is freed': ['company_overview'],
      'what does freed': ['company_overview'],
      'how can freed': ['company_overview', 'program_drp', 'program_dcp', 'program_dep'],
      'drp': ['program_drp'],
      'dcp': ['program_dcp'],
      'dep': ['program_dep'],
    };

    for (const [keyword, sectionIds] of Object.entries(keywordMap)) {
      if (lower.includes(keyword)) {
        for (const id of sectionIds) selected.add(id);
      }
    }
  }

  // ── If nothing selected, include company overview + segment sections ─────
  if (selected.size === 0) {
    selected.add('company_overview');
    selected.add('customer_segments');
  }

  // ── Assemble selected sections ───────────────────────────────────────────
  const result = sections
    .filter(s => selected.has(s.id))
    .map(s => s.content)
    .join('\n\n---\n\n');

  return result;
}

/**
 * Get all sections (for diagnostic/debug purposes).
 */
export function getAllSections(): Array<{ id: string; title: string; length: number }> {
  return sections.map(s => ({ id: s.id, title: s.title, length: s.content.length }));
}
