import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { lookupByName, getUserByLeadRefId, getStartersForSegment, getAllLeadRefIds } from '../services/userLookup';
import { getChatResponse } from '../services/claude';
import { loadCreditorData, getCreditorAccounts } from '../services/creditorLookup';
import { loadCreditInsights } from '../services/creditInsightsLookup';
import { loadPhoneLookup } from '../services/phoneLookup';
import { loadCreditReports, getCreditReport } from '../services/creditReportLookup';
import { indexKnowledgeBase } from '../services/knowledgeSelection';
import { buildEmbeddingStore, retrieveKnowledge } from '../services/embeddingStore';
import { parsePdf } from '../services/knowledgeChunker';
import { buildResponseGroundingContext } from '../services/groundingContext';
import { buildAdvisorContext } from '../services/advisorContext';
import { normalizeDebtTypeLabel } from '../utils/debtTypeNormalization';
import { AdvisorContext, IdentifyRequest, ChatRequest, Segment, CreditorAccount, EnrichedCreditReport, MessageTooltips, TooltipGroup, TooltipAccountDetail, ResponseGroundingContext } from '../types';

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
    .filter(a => (a.overdueAmount ?? 0) > 0 || (a.delinquency ?? 0) > 0)
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimitAmount, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
        overdue: a.overdueAmount,
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

  // Overdue: accounts with DPD history or overdue amounts
  const overdueItems = accounts
    .filter(a => a.dpd.maxDPD > 0 || (a.overdueAmount && a.overdueAmount > 0))
    .map(a => ({
      name: a.lenderName,
      detail: {
        name: a.lenderName,
        debtType: normalizeDebtTypeLabel({ debtType: a.debtType, creditLimit: a.creditLimit, lenderName: a.lenderName }),
        outstanding: a.outstandingAmount,
        overdue: a.overdueAmount
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
}

/**
 * Load both PDF knowledge bases, build section index for sectionHint detection,
 * then embed all chunks into the in-memory RAG store.
 * Called once at server startup (async, ~3–6s).
 */
export async function initKnowledgeBase(): Promise<void> {
  // Load legacy text for indexKnowledgeBase (sectionHint pattern reference)
  try {
    const kbText = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'knowledge-base.txt'),
      'utf-8'
    );
    indexKnowledgeBase(kbText);
    console.log(`[KB] Legacy text indexed (${kbText.length} chars) for sectionHint patterns`);
  } catch (err) {
    console.warn('[KB] Could not load knowledge-base.txt (continuing without it):', err);
  }

  // Parse both PDFs
  // __dirname is server/src/routes — go up to server/, then up to project root
  const datasetDir = path.resolve(__dirname, '..', '..', '..', 'dataset');

  let companyText = '';
  let generalText = '';

  try {
    companyText = await parsePdf(path.join(datasetDir, 'FREED - Company Knowledge base.pdf'));
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

  await buildEmbeddingStore(companyText, generalText);
}

// POST /api/identify - Look up user by name or phone number
router.post('/identify', (req: Request, res: Response) => {
  const { name } = req.body as IdentifyRequest;

  if (!name || !name.trim()) {
    res.json({
      status: 'not_found',
      message: 'Please enter your registered name or 10-digit mobile number to get started.',
    });
    return;
  }

  const result = lookupByName(name);
  res.json(result);
});

// POST /api/select - Select a specific user from disambiguation
router.post('/select', (req: Request, res: Response) => {
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

  res.json({
    status: 'found',
    user,
    starters: getStartersForSegment(user.segment),
    message: `Welcome, ${user.firstName}!`,
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

  try {
    let responseGrounding: ResponseGroundingContext | undefined;
    let creditorAccounts: CreditorAccount[] = [];
    let selectedKnowledge = '';
    let userName: string | null = null;
    let segment: string | null = null;
    let advisorContext: AdvisorContext | undefined;

    // Enriched credit report (from full bureau JSON) — may be null
    const enrichedReport = leadRefId ? getCreditReport(leadRefId) : null;

    if (leadRefId) {
      const user = getUserByLeadRefId(leadRefId);
      if (user) {
        creditorAccounts = getCreditorAccounts(leadRefId);
        const totalMessages = typeof messageCount === 'number' ? messageCount : (Array.isArray(history) ? history.length : 0);
        // Semantic RAG retrieval — embed user message and return top passages from both PDFs
        selectedKnowledge = await retrieveKnowledge(message, user.segment, intentTag);
        responseGrounding = buildResponseGroundingContext(enrichedReport, creditorAccounts);
        advisorContext = buildAdvisorContext({
          user,
          report: enrichedReport,
          creditorAccounts,
          userMessage: message,
        });
        userName = user.firstName;
        segment = user.segment;
      }
    }

    if (!advisorContext) {
      advisorContext = buildAdvisorContext({
        user: null,
        report: enrichedReport,
        creditorAccounts,
        userMessage: message,
      });
    }

    const chatHistory = Array.isArray(history) ? history.slice(-20) : [];
    const totalMessages = typeof messageCount === 'number' ? messageCount : (Array.isArray(history) ? history.length : 0);
    const response = await getChatResponse({
      history: chatHistory,
      userMessage: message,
      messageCount: totalMessages,
      knowledgeBase: selectedKnowledge,
      advisorContext,
      grounding: responseGrounding,
      userName,
      segment,
      intentTag,
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

    res.json({ ...response, tooltips });
  } catch (err: any) {
    console.error('Chat error:', err?.message || err);

    if (err?.status === 429) {
      res.status(429).json({
        reply: "I'm a bit busy right now. Could you try again in a moment?",
      });
      return;
    }

    res.status(500).json({
      reply: "I'm having trouble connecting right now. Please try again.",
    });
  }
});

export default router;
