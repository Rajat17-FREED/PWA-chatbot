import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { lookupByName, getUserByLeadRefId, getStartersForSegment, getAllLeadRefIds } from '../services/userLookup';
import { getChatResponse } from '../services/claude';
import { loadCreditorData, getCreditorAccounts } from '../services/creditorLookup';
import { loadCreditInsights } from '../services/creditInsightsLookup';
import { loadPhoneLookup } from '../services/phoneLookup';
import { loadCreditReports, getCreditReport } from '../services/creditReportLookup';
import { indexKnowledgeBase, selectKnowledge } from '../services/knowledgeSelection';
import { buildEmbeddingStore, retrieveKnowledge, preEmbedQueries } from '../services/embeddingStore';
import { parsePdf } from '../services/knowledgeChunker';
import { buildResponseGroundingContext } from '../services/groundingContext';
import { buildAdvisorContext } from '../services/advisorContext';
import { loadServiceableCreditors } from '../services/serviceableCreditorLookup';
import { detectEdgeCase } from '../services/edgeCaseHandler';
import { reconcileData, toEnrichedReport } from '../services/dataReconciliation';
import { getCurrentUserTurnCount, resolveConversationIntentTag } from '../services/conversationContext';
import { normalizeDebtTypeLabel } from '../utils/debtTypeNormalization';
import { generateDynamicStarters, prewarmStarters, buildWelcomeMessage, buildErrorResponse } from '../services/starterGenerator';
import { AdvisorContext, IdentifyRequest, ChatRequest, Segment, CreditorAccount, EnrichedCreditReport, MessageTooltips, TooltipGroup, TooltipAccountDetail, ResponseGroundingContext, LenderSelector, LenderSelectorOption, InlineWidget } from '../types';

/**
 * Build hover tooltip groups from creditor account data (Creditor.csv).
 * Fallback for users without enriched credit report data.
 * Now includes richer details (debt type, outstanding, overdue) per account.
 */
function buildTooltipsFromCreditor(accounts: CreditorAccount[]): MessageTooltips | undefined {
  if (!accounts || accounts.length === 0) return undefined;

  // Deduplicate by lender name, keeping the entry with highest outstanding
  function dedup(items: Array<{ name: string; detail: TooltipAccountDetail }>) {
    const rawCount = items.length;
    const map = new Map<string, TooltipAccountDetail>();
    for (const { name, detail } of items) {
      const existing = map.get(name);
      if (!existing || (detail.outstanding ?? 0) > (existing.outstanding ?? 0)) {
        map.set(name, detail);
      }
    }
    return { accounts: [...map.keys()], details: [...map.values()], rawCount };
  }

  const overdueItems = accounts
    .filter(a => (a.accountStatus || '').toUpperCase() !== 'CLOSED')
    .filter(a => (a.outstandingAmount ?? 0) > 0)
    .filter(a => (a.overdueAmount ?? 0) > 0 || (a.delinquency ?? 0) > 0)
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimitAmount, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
        overdue: a.overdueAmount,
        maxDPD: (a.delinquency ?? 0) > 0 ? a.delinquency : null,
      }
    }));

  const activeItems = accounts
    .filter(a => !a.closedDate || a.closedDate.trim() === '')
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimitAmount, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
      }
    }));

  const securedItems = accounts
    .filter(a => {
      const t = ((a.accountType ?? '') + ' ' + (a.debtType ?? '')).toLowerCase();
      return t.includes('home') || t.includes('vehicle') || t.includes('auto') ||
             t.includes('mortgage') || t.includes('secured');
    })
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimitAmount, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
      }
    }));

  const unsecuredItems = accounts
    .filter(a => {
      const t = ((a.accountType ?? '') + ' ' + (a.debtType ?? '')).toLowerCase();
      return t.includes('personal') || t.includes('credit') ||
             t.includes('unsecured') || t.includes('gold');
    })
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimitAmount, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
      }
    }));

  const result: MessageTooltips = {};
  const overdueDedup = dedup(overdueItems);
  const activeDedup = dedup(activeItems);
  const securedDedup = dedup(securedItems);
  const unsecuredDedup = dedup(unsecuredItems);

  if (overdueDedup.accounts.length > 0)   result.overdue   = { label: 'Accounts with missed payments', ...overdueDedup };
  if (activeDedup.accounts.length > 0)    result.active    = { label: 'Active accounts', ...activeDedup };
  if (securedDedup.accounts.length > 0)   result.secured   = { label: 'Secured loans', ...securedDedup };
  if (unsecuredDedup.accounts.length > 0) result.unsecured = { label: 'Unsecured loans', ...unsecuredDedup };

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Build hover tooltip groups from enriched credit report data.
 * Uses DPD history for more accurate "missed payments" detection.
 * Includes richer details (debt type, outstanding, overdue) per account.
 */
function buildTooltipsFromReport(report: EnrichedCreditReport): MessageTooltips | undefined {
  const accounts = report.accounts;
  if (!accounts || accounts.length === 0) return undefined;

  // Deduplicate by lender name, keeping the entry with highest outstanding
  function dedup(items: Array<{ name: string; detail: TooltipAccountDetail }>) {
    const rawCount = items.length;
    const map = new Map<string, TooltipAccountDetail>();
    for (const { name, detail } of items) {
      const existing = map.get(name);
      if (!existing || (detail.outstanding ?? 0) > (existing.outstanding ?? 0)) {
        map.set(name, detail);
      }
    }
    return { accounts: [...map.keys()], details: [...map.values()], rawCount };
  }

  // Overdue: ACTIVE accounts only with DPD history or overdue amounts (and non-zero outstanding)
  const overdueItems = accounts
    .filter(a => a.status === 'ACTIVE')
    .filter(a => (a.outstandingAmount ?? 0) > 0)
    .filter(a => a.dpd.maxDPD > 0 || (a.overdueAmount && a.overdueAmount > 0))
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimit, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
        overdue: a.overdueAmount,
        maxDPD: a.dpd.maxDPD > 0 ? a.dpd.maxDPD : null,
      }
    }));

  // Active accounts
  const activeItems = accounts
    .filter(a => a.status === 'ACTIVE')
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimit, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount
      }
    }));

  // Secured loans
  const securedItems = accounts
    .filter(a => {
      const t = (a.accountType + ' ' + a.debtType).toLowerCase();
      return t.includes('secured') && !t.includes('unsecured');
    })
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimit, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount
      }
    }));

  // Unsecured loans
  const unsecuredItems = accounts
    .filter(a => {
      const t = (a.accountType + ' ' + a.debtType).toLowerCase();
      return t.includes('unsecured') || t.includes('personal') ||
             t.includes('credit card') || t.includes('consumer');
    })
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimit, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount
      }
    }));

  const result: MessageTooltips = {};
  const overdueDedup = dedup(overdueItems);
  const activeDedup = dedup(activeItems);
  const securedDedup = dedup(securedItems);
  const unsecuredDedup = dedup(unsecuredItems);

  if (overdueDedup.accounts.length > 0)   result.overdue   = { label: 'Accounts with missed payments', ...overdueDedup };
  if (activeDedup.accounts.length > 0)    result.active    = { label: 'Active accounts', ...activeDedup };
  if (securedDedup.accounts.length > 0)   result.secured   = { label: 'Secured loans', ...securedDedup };
  if (unsecuredDedup.accounts.length > 0) result.unsecured = { label: 'Unsecured loans', ...unsecuredDedup };

  return Object.keys(result).length > 0 ? result : undefined;
}

const router = Router();

// ── Startup initialisation ────────────────────────────────────────────────────

/**
 * Initialize all dataset lookups — called from index.ts at startup.
 */
export function initCreditorData(): void {
  const validIds = getAllLeadRefIds();
  loadCreditorData(validIds);
  loadCreditInsights(validIds);
  loadPhoneLookup(validIds);
  loadCreditReports();
  loadServiceableCreditors();
}

/**
 * Load both PDF knowledge bases, build section index for sectionHint detection,
 * then embed all chunks into the in-memory RAG store.
 * Called once at server startup (async, ~3–6s).
 */
export async function initKnowledgeBase(): Promise<void> {
  // Parse both PDFs
  // __dirname is server/src/routes — go up to server/, then up to project root
  const datasetDir = path.resolve(__dirname, '..', '..', '..', 'dataset');

  let companyText = '';
  let generalText = '';

  try {
    companyText = await parsePdf(path.join(datasetDir, 'FREED — Company Overview.pdf'));
    console.log(`[KB] Company PDF parsed: ${companyText.length} chars`);
  } catch (err) {
    console.error('[KB] Failed to parse Company PDF:', err);
  }

  try {
    generalText = await parsePdf(path.join(datasetDir, 'FREED - General Knowledge Base.pdf'));
    console.log(`[KB] General Finance PDF parsed: ${generalText.length} chars`);
  } catch (err) {
    console.error('[KB] Failed to parse General Finance PDF:', err);
  }

  if (!companyText && !generalText) {
    console.warn('[KB] No PDF content available — RAG store will be empty.');
    return;
  }

  // Index combined PDF text for keyword-based fallback selection (used when RAG times out)
  const combinedKBText = [companyText, generalText].filter(Boolean).join('\n\n');
  if (combinedKBText) {
    indexKnowledgeBase(combinedKBText);
    console.log(`[KB] Indexed ${combinedKBText.length} chars from PDFs for keyword fallback`);
  }

  await buildEmbeddingStore(companyText, generalText);

  // Pre-embed all conversation starters so first-click is instant
  const { conversationStarters } = await import('../prompts/segments');
  const allStarterTexts: string[] = [];
  for (const segment of Object.keys(conversationStarters)) {
    for (const starter of conversationStarters[segment as Segment]) {
      // Resolve {SCORE_TARGET} placeholder with common target values
      if (starter.text.includes('{SCORE_TARGET}')) {
        for (const target of [700, 750, 800, 850]) {
          allStarterTexts.push(starter.text.replace('{SCORE_TARGET}', String(target)));
        }
      } else {
        allStarterTexts.push(starter.text);
      }
    }
  }
  await preEmbedQueries(allStarterTexts);
}

// POST /api/identify - Look up user by name or phone number
router.post('/identify', async (req: Request, res: Response) => {
  const { name } = req.body as IdentifyRequest;

  if (!name || !name.trim()) {
    res.json({
      status: 'not_found',
      message: 'Please enter your registered name or 10-digit mobile number to get started.',
    });
    return;
  }

  const result = lookupByName(name);

  if (result.status === 'found' && result.user) {
    // Direct match — return static starters immediately, prewarm dynamic in background
    const rawRpt = getCreditReport(result.user.leadRefId);
    const creditorAccounts = getCreditorAccounts(result.user.leadRefId);
    const reconciledReport = toEnrichedReport(reconcileData(rawRpt, creditorAccounts));
    const advisorContext = buildAdvisorContext({
      user: result.user,
      report: reconciledReport,
      creditorAccounts,
      userMessage: '',
    });

    result.message = buildWelcomeMessage(result.user, advisorContext);
    // Fire dynamic starters in background — don't block login response
    prewarmStarters(result.user, advisorContext);
  } else if (result.status === 'multiple' && result.candidates) {
    // Multiple matches — prewarm starters for ALL candidates in background
    // so when the user selects one, starters are already cached
    for (const candidate of result.candidates) {
      const user = getUserByLeadRefId(candidate.leadRefId);
      if (user) {
        const report = getCreditReport(candidate.leadRefId);
        const accounts = getCreditorAccounts(candidate.leadRefId);
        const ctx = buildAdvisorContext({
          user,
          report,
          creditorAccounts: accounts,
          userMessage: '',
        });
        prewarmStarters(user, ctx);
      }
    }
  }

  res.json(result);
});

// POST /api/select - Select a specific user from disambiguation
router.post('/select', async (req: Request, res: Response) => {
  const { leadRefId } = req.body as { leadRefId: string };

  if (!leadRefId) {
    res.status(400).json({ error: 'leadRefId is required' });
    return;
  }

  const user = getUserByLeadRefId(leadRefId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  // Build advisor context for dynamic starters + welcome
  const rawRpt = getCreditReport(leadRefId);
  const creditorAccounts = getCreditorAccounts(leadRefId);
  const reconciledReport = toEnrichedReport(reconcileData(rawRpt, creditorAccounts));
  const advisorContext = buildAdvisorContext({
    user,
    report: reconciledReport,
    creditorAccounts,
    userMessage: '',
  });

  // Try to get dynamic starters from cache (prewarm may have finished during disambiguation)
  // If not ready, return static starters immediately — don't block
  const starters = await generateDynamicStarters(user, advisorContext);
  const welcomeMessage = buildWelcomeMessage(user, advisorContext);

  res.json({
    status: 'found',
    user,
    starters,
    message: welcomeMessage,
  });
});

// GET /api/starters/:segment - Get conversation starters for a segment
router.get('/starters/:segment', (req: Request, res: Response) => {
  const segment = req.params.segment as Segment;
  const starters = getStartersForSegment(segment);
  res.json({ starters });
});

// POST /api/chat - Send a message and get LLM response with enriched user context
router.post('/chat', async (req: Request, res: Response) => {
  const { message, leadRefId, history, messageCount, intentTag } = req.body as ChatRequest;

  if (!message || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  let userName: string | null = null;
  let advisorContext: AdvisorContext | undefined;

  try {
    const chatHistory = Array.isArray(history) ? history.slice(-20) : [];
    const currentUserTurnCount = getCurrentUserTurnCount(chatHistory, messageCount);
    const effectiveIntentTag = resolveConversationIntentTag(message, chatHistory, intentTag);

    // Quick user lookup for edge case detection (cheap — no credit report parsing)
    const userForEdgeCase = leadRefId ? getUserByLeadRefId(leadRefId) : null;
    userName = userForEdgeCase?.firstName ?? null;

    // ── Edge case interception: greetings, abuse, off-topic, etc. ──
    // Catches non-financial messages BEFORE expensive RAG/LLM processing.
    const edgeCaseResult = await detectEdgeCase(message, userName);
    if (edgeCaseResult) {
      res.json({
        reply: edgeCaseResult.reply,
        followUps: edgeCaseResult.followUps,
      });
      return;
    }

    let responseGrounding: ResponseGroundingContext | undefined;
    let creditorAccounts: CreditorAccount[] = [];
    let selectedKnowledge = '';
    let segment: string | null = null;
    let enrichedReport: EnrichedCreditReport | null = null;

    // Raw credit report (from full bureau JSON) — may be null
    const rawReport = leadRefId ? getCreditReport(leadRefId) : null;

    if (leadRefId) {
      const user = userForEdgeCase;
      if (user) {
        creditorAccounts = getCreditorAccounts(leadRefId);

        // ── Data reconciliation: merge credit report + Creditor CSV ──
        // CSV is fresher (Jan/Feb 2026) than credit report (Nov 2025).
        // reconcileData merges both, preferring CSV for financial amounts
        // and credit report for DPD history, credit limits, enquiries.
        const reconciliation = reconcileData(rawReport, creditorAccounts);
        enrichedReport = toEnrichedReport(reconciliation);
        if (reconciliation.reconciliationLog.length > 0) {
          console.log(`[Reconciliation] ${user.firstName} ${user.lastName}: ${reconciliation.reconciliationLog.length} changes`);
          for (const msg of reconciliation.reconciliationLog) {
            if (/skip|CLOSED|credit report only|CSV only/i.test(msg)) console.log(`  → ${msg}`);
          }
        }

        const totalMessages = currentUserTurnCount;

        // Fire RAG retrieval in parallel with context building, with 1500ms timeout
        const ragPromise = Promise.race([
          retrieveKnowledge(message, user.segment, effectiveIntentTag),
          new Promise<string>(resolve => setTimeout(() => resolve(''), 1500)),
        ]);

        // Build context using reconciled data (these are synchronous/<5ms)
        responseGrounding = buildResponseGroundingContext(enrichedReport, creditorAccounts, user);
        advisorContext = buildAdvisorContext({
          user,
          report: enrichedReport,
          creditorAccounts,
          userMessage: message,
        });

        // Await the RAG result (will be fast if cached, or timeout after 300ms)
        selectedKnowledge = await ragPromise;

        // If RAG timed out or returned empty, fall back to keyword-based selection
        if (!selectedKnowledge) {
          selectedKnowledge = selectKnowledge(user.segment, effectiveIntentTag, message, totalMessages);
          console.log('[RAG] Timeout — fell back to keyword selection');
        }

        userName = user.firstName;
        segment = user.segment;
      }
    }

    if (!advisorContext) {
      // Fallback: no user found — still reconcile if we have any data
      enrichedReport = toEnrichedReport(reconcileData(rawReport, creditorAccounts));
      advisorContext = buildAdvisorContext({
        user: null,
        report: enrichedReport,
        creditorAccounts,
        userMessage: message,
      });
    }

    const response = await getChatResponse({
      history: chatHistory,
      userMessage: message,
      messageCount: currentUserTurnCount,
      knowledgeBase: selectedKnowledge,
      advisorContext,
      grounding: responseGrounding,
      userName,
      segment,
      intentTag: effectiveIntentTag,
    });

    // Attach hover-tooltip data — prefer enriched report, fall back to Creditor.csv
    let tooltips: MessageTooltips | undefined;
    if (enrichedReport) {
      tooltips = buildTooltipsFromReport(enrichedReport);
    } else if (leadRefId) {
      const creditorAccountsForTooltip = creditorAccounts.length > 0 ? creditorAccounts : getCreditorAccounts(leadRefId);
      tooltips = creditorAccountsForTooltip.length > 0
        ? buildTooltipsFromCreditor(creditorAccountsForTooltip)
        : undefined;
    }

    // ── Inject interactive lender selector for harassment first-response ──
    let lenderSelector: LenderSelector | undefined;
    if (
      effectiveIntentTag === 'INTENT_HARASSMENT' &&
      (segment === 'DRP_Eligible' || segment === 'DRP_Ineligible') &&
      advisorContext
    ) {
      // Only on the first harassment message (no prior assistant messages about harassment)
      const priorHarassmentTurn = chatHistory.some(
        (m: any) => m.role === 'assistant' && /which.*lender|lender.*harass|recovery.*call|what counts as harassment|you are not alone in this|not alone in this/i.test(m.content)
      );
      if (!priorHarassmentTurn) {
        const delinquentAccounts = [
          ...(advisorContext.dominantAccounts || []),
          ...(advisorContext.relevantAccounts || []),
        ]
          .filter(a => (a.outstandingAmount ?? 0) > 0 && ((a.overdueAmount ?? 0) > 0 || (a.maxDPD ?? 0) > 0))
          .reduce((unique, a) => {
            if (!unique.some(u => u.lenderName === a.lenderName)) unique.push(a);
            return unique;
          }, [] as typeof advisorContext.dominantAccounts);

        if (delinquentAccounts.length > 0) {
          // Sort by pressure score (highest first) so most aggressive lenders appear at top
          const sorted = [...delinquentAccounts].sort((a, b) => (b.pressureScore ?? 0) - (a.pressureScore ?? 0));
          lenderSelector = {
            prompt: 'Which of these lenders are harassing you?',
            lenders: sorted.slice(0, 6).map(a => ({
              name: a.lenderName,
              debtType: a.debtType,
              overdueAmount: a.overdueAmount,
              maxDPD: a.maxDPD,
              pressureScore: a.pressureScore,
              isServicedByFreed: a.isServicedByFreed,
            })),
            allowOther: true,
          };
        }
      }
    }

    // ── Inject inline widgets based on intent + data availability ──
    const inlineWidgets: InlineWidget[] = [];

    // DRP Savings widget: when settlement estimate exists and response redirects to /drp
    // Triggers for: settlement follow-ups, delinquency stress, missed payment intents
    if (advisorContext?.drpSettlementEstimate && (response.redirectUrl === '/drp' || effectiveIntentTag === 'INTENT_DELINQUENCY_STRESS')) {
      const est = advisorContext.drpSettlementEstimate;
      inlineWidgets.push({
        type: 'drpSavings',
        totalDebt: est.enrolledDebt,
        settlementAmount: est.estimatedSettlement,
        savings: est.estimatedSavings,
        debtFreeMonths: 24, // placeholder — calculation logic TBD
      });
      // Widget replaces the static CTA image
      response.redirectUrl = undefined;
      response.redirectLabel = undefined;
    }

    // DCP Savings widget: when consolidation projection exists with meaningful savings
    // Triggers when: (a) response redirects to /dcp, OR (b) segment is DCP_Eligible and intent is DCP-relevant
    // Score-focused intents should show Goal Tracker, not DCP widget
    const dcpRelevantIntents = [
      'INTENT_EMI_OPTIMISATION', 'INTENT_EMI_STRESS', 'INTENT_GOAL_BASED_PATH',
    ];
    const isDcpWidgetEligible = advisorContext?.consolidationProjection?.hasMeaningfulSavings && (
      response.redirectUrl === '/dcp' ||
      (segment === 'DCP_Eligible' && dcpRelevantIntents.includes(effectiveIntentTag || ''))
    );
    if (isDcpWidgetEligible) {
      const proj = advisorContext!.consolidationProjection!;
      inlineWidgets.push({
        type: 'dcpSavings',
        currentTotalEMI: proj.currentTotalEMI,
        consolidatedEMI: proj.consolidatedEMI,
        emiSavings: proj.monthlySavings,
        tenureMonths: proj.consolidatedTenureMonths,
      });
      // Widget replaces the static CTA image
      response.redirectUrl = undefined;
      response.redirectLabel = undefined;
    }

    // DEP Savings widget: when consolidation projection exists and segment is DEP
    // DEP uses the same projection data but presents it as interest savings via accelerated repayment
    const depRelevantIntents = [
      'INTENT_INTEREST_OPTIMISATION', 'INTENT_SCORE_IMPROVEMENT', 'INTENT_CREDIT_SCORE_TARGET',
      'INTENT_PROFILE_ANALYSIS', 'INTENT_GOAL_BASED_LOAN',
    ];
    if (
      inlineWidgets.length === 0 &&
      segment === 'DEP' &&
      advisorContext?.consolidationProjection &&
      advisorContext.consolidationProjection.interestSaved > 0 &&
      (response.redirectUrl === '/dep' || depRelevantIntents.includes(effectiveIntentTag || ''))
    ) {
      const proj = advisorContext.consolidationProjection;
      inlineWidgets.push({
        type: 'depSavings',
        interestWithout: proj.totalInterestBefore,
        interestWith: proj.totalInterestAfter,
        interestSaved: proj.interestSaved,
        debtFreeMonths: proj.consolidatedTenureMonths,
      });
      response.redirectUrl = undefined;
      response.redirectLabel = undefined;
    }

    // Goal Tracker widget: credit score improvement intent
    // Only inject if no DRP/DCP/DEP widget was already added (mutual exclusion)
    if (
      inlineWidgets.length === 0 &&
      (effectiveIntentTag === 'INTENT_SCORE_IMPROVEMENT' || effectiveIntentTag === 'INTENT_CREDIT_SCORE_TARGET') &&
      advisorContext?.creditScore &&
      advisorContext?.nextScoreTarget &&
      advisorContext?.scoreGapToTarget != null
    ) {
      inlineWidgets.push({
        type: 'goalTracker',
        currentScore: advisorContext.creditScore,
        targetScore: advisorContext.nextScoreTarget,
        delta: advisorContext.scoreGapToTarget,
        steps: (advisorContext.topOpportunities || []).slice(0, 4).map(o => o.detail),
      });
      // Widget replaces the static CTA image
      response.redirectUrl = undefined;
      response.redirectLabel = undefined;

      // Filter out credit card follow-ups when user has no credit cards
      if (advisorContext.creditCardCount === 0 && response.followUps) {
        response.followUps = response.followUps.filter(
          f => !/card usage|credit card|reduce.*card/i.test(f)
        );
      }
    }

    // Carousel widget: harassment first-response — rendered inside the message bubble
    if (
      effectiveIntentTag === 'INTENT_HARASSMENT' &&
      lenderSelector // carousel only on first harassment response (same condition)
    ) {
      inlineWidgets.push({
        type: 'carousel',
        items: [
          { title: 'Non-stop calls', description: 'Throughout the day, sometimes even on weekends or late at night.' },
          { title: 'Threatening language', description: 'Intimidation, or being told you will be arrested.' },
          { title: 'Contacting family', description: 'Recovery agents reaching out to your family, neighbors, or colleagues.' },
          { title: 'Unauthorized visits', description: 'Agents visiting your home or workplace without warning.' },
          { title: 'False claims', description: 'Being told your assets will be seized immediately.' },
        ],
      });
    }

    // YouTube embed: harassment post-lender-selection — embed video INSIDE the response text
    // Only embed when the LLM response contains the "HOW FREED" heading, indicating
    // this is the FREED Shield explainer response. Don't embed on every follow-up.
    if (
      effectiveIntentTag === 'INTENT_HARASSMENT' &&
      !lenderSelector
    ) {
      const howFreedPattern = /(\*{0,2}HOW FREED[^\n]*\*{0,2}\n)/i;
      if (howFreedPattern.test(response.reply)) {
        response.reply = response.reply.replace(
          howFreedPattern,
          `$1\n{{youtube:vEONmNkFwuo}}\n\n`
        );
      }
      // No fallback — if the heading isn't present, this is a follow-up response
      // that doesn't need the video embed
    }

    // ── Inject repayment method data when response mentions snowball/avalanche ──
    let repaymentMethods: import('../types').RepaymentMethodData | undefined;
    if (advisorContext && /snowball|avalanche/i.test(response.reply)) {
      const allAccounts = [
        ...(advisorContext.dominantAccounts || []),
        ...(advisorContext.relevantAccounts || []),
      ];
      // Deduplicate by lender name, keep highest outstanding. STRICT: only ACTIVE accounts.
      const deduped = new Map<string, typeof allAccounts[0]>();
      for (const a of allAccounts) {
        if ((a.outstandingAmount ?? 0) <= 0) continue;
        if (a.status?.toUpperCase() !== 'ACTIVE') continue;
        const existing = deduped.get(a.lenderName);
        if (!existing || (a.outstandingAmount ?? 0) > (existing.outstandingAmount ?? 0)) {
          deduped.set(a.lenderName, a);
        }
      }
      const accounts = [...deduped.values()];

      if (accounts.length >= 2) {
        // Snowball: lowest balance first
        const snowball = [...accounts]
          .sort((a, b) => (a.outstandingAmount ?? 0) - (b.outstandingAmount ?? 0))
          .map((a, i) => ({
            lenderName: a.lenderName,
            outstandingAmount: Math.round(a.outstandingAmount ?? 0),
            interestRate: a.interestRate ?? null,
            isEstimatedRate: a.isEstimatedRate || false,
            overdueAmount: a.overdueAmount ? Math.round(a.overdueAmount) : null,
            debtType: a.debtType || 'Loan',
            step: i + 1,
          }));

        // Avalanche: highest REAL interest first (only accounts with actual ROI data)
        const avalanche = [...accounts]
          .filter(a => (a.interestRate ?? 0) > 0 && !a.isEstimatedRate)
          .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0) || (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0))
          .map((a, i) => ({
            lenderName: a.lenderName,
            outstandingAmount: Math.round(a.outstandingAmount ?? 0),
            interestRate: a.interestRate ?? null,
            isEstimatedRate: false,
            overdueAmount: a.overdueAmount ? Math.round(a.overdueAmount) : null,
            debtType: a.debtType || 'Loan',
            step: i + 1,
          }));

        // Recommend avalanche if high-interest spread, snowball if many small balances
        const hasHighInterestSpread = accounts.some(a => (a.interestRate ?? 0) > 20) && accounts.some(a => (a.interestRate ?? 0) < 15);
        const recommended: 'snowball' | 'avalanche' = hasHighInterestSpread ? 'avalanche' : 'snowball';

        repaymentMethods = { recommended, snowball, avalanche };
      }
    }

    res.json({
      ...response,
      tooltips,
      ...(lenderSelector ? { lenderSelector } : {}),
      ...(inlineWidgets.length > 0 ? { inlineWidgets } : {}),
      ...(repaymentMethods ? { repaymentMethods } : {}),
    });
  } catch (err: any) {
    console.error('Chat error:', err?.message || err);

    if (err?.status === 429) {
      res.status(429).json({
        reply: buildErrorResponse(userName, advisorContext, '429'),
      });
      return;
    }

    res.status(500).json({
      reply: buildErrorResponse(userName, advisorContext, '500'),
    });
  }
});

export default router;
