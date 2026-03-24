/**
 * Eval API Routes — CRUD for golden dataset, run triggers, reports, traces.
 * Mounted at /api/evals
 */

import { Router, Request, Response } from 'express';
import { loadGoldenDataset, saveGoldenDataset, runSingleCaseViaHttp, runAllCasesViaHttp, TestCase, TestCaseResult, listResultFiles, loadResults, saveResults } from '../evals/evalRunner';
import { runCodeEvals, CodeEvalInput, summarizeResults } from '../evals/codeEvals';
import { judgeResponse, JudgeResult } from '../evals/llmJudge';
import { generateReport, saveReport, loadLatestReport, loadReport, listReports, EvalReport } from '../evals/reportGenerator';
import { formatTrace, formatAllTraces } from '../evals/traceViewer';
import { getAllLeadRefIds, getUserByLeadRefId } from '../services/userLookup';
import { Segment } from '../types';
import { conversationStarters } from '../prompts/segments';

const router = Router();

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:3001';

// ── Dataset CRUD ─────────────────────────────────────────────────────────────

// GET /api/evals/dataset — list all test cases
router.get('/dataset', (_req: Request, res: Response) => {
  try {
    const dataset = loadGoldenDataset();
    res.json({ cases: dataset, count: dataset.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load dataset' });
  }
});

// POST /api/evals/dataset — add a new test case
router.post('/dataset', (req: Request, res: Response) => {
  try {
    const dataset = loadGoldenDataset();
    const newCase = req.body as TestCase;

    if (!newCase.id || !newCase.user || !newCase.segment || !newCase.turns?.length) {
      res.status(400).json({ error: 'Missing required fields: id, user, segment, turns' });
      return;
    }

    if (dataset.some(tc => tc.id === newCase.id)) {
      res.status(409).json({ error: `Test case with id "${newCase.id}" already exists` });
      return;
    }

    dataset.push(newCase);
    saveGoldenDataset(dataset);
    res.status(201).json({ message: 'Test case added', case: newCase });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save' });
  }
});

// PUT /api/evals/dataset/:id — update a test case
router.put('/dataset/:id', (req: Request, res: Response) => {
  try {
    const dataset = loadGoldenDataset();
    const idx = dataset.findIndex(tc => tc.id === req.params.id);

    if (idx === -1) {
      res.status(404).json({ error: `Test case "${req.params.id}" not found` });
      return;
    }

    const updated = { ...dataset[idx], ...req.body, id: req.params.id };
    dataset[idx] = updated;
    saveGoldenDataset(dataset);
    res.json({ message: 'Test case updated', case: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update' });
  }
});

// DELETE /api/evals/dataset/:id — remove a test case
router.delete('/dataset/:id', (req: Request, res: Response) => {
  try {
    const dataset = loadGoldenDataset();
    const idx = dataset.findIndex(tc => tc.id === req.params.id);

    if (idx === -1) {
      res.status(404).json({ error: `Test case "${req.params.id}" not found` });
      return;
    }

    const removed = dataset.splice(idx, 1)[0];
    saveGoldenDataset(dataset);
    res.json({ message: 'Test case removed', case: removed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete' });
  }
});

// ── Reference Data ───────────────────────────────────────────────────────────

// GET /api/evals/users — list available users for dropdowns
router.get('/users', (_req: Request, res: Response) => {
  try {
    const ids = [...getAllLeadRefIds()];
    const users = ids.map((id: string) => {
      const u = getUserByLeadRefId(id);
      return u ? { leadRefId: u.leadRefId, firstName: u.firstName, lastName: u.lastName, segment: u.segment, creditScore: u.creditScore } : null;
    }).filter(Boolean);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list users' });
  }
});

// GET /api/evals/segments — list segments + intents
router.get('/segments', (_req: Request, res: Response) => {
  const segments: Segment[] = ['DRP_Eligible', 'DRP_Ineligible', 'DCP_Eligible', 'DCP_Ineligible', 'DEP', 'NTC', 'Others'];

  const intents = new Set<string>();
  for (const starters of Object.values(conversationStarters)) {
    for (const s of starters) {
      intents.add(s.intentTag);
    }
  }

  res.json({ segments, intents: [...intents].sort() });
});

// GET /api/evals/starters/:segment — get starters for a segment
router.get('/starters/:segment', (req: Request, res: Response) => {
  const segment = req.params.segment as Segment;
  const starters = conversationStarters[segment];
  if (!starters) {
    res.status(404).json({ error: `Unknown segment: ${segment}` });
    return;
  }
  res.json({ starters });
});

// ── Eval Execution ───────────────────────────────────────────────────────────

// Track running eval to prevent concurrent runs
let evalRunning = false;

// POST /api/evals/run — trigger full eval run
router.post('/run', async (_req: Request, res: Response) => {
  if (evalRunning) {
    res.status(409).json({ error: 'An eval run is already in progress' });
    return;
  }

  evalRunning = true;
  try {
    const results = await runAllCasesViaHttp(SERVER_URL);
    const resultsPath = saveResults(results, 'full-eval');

    // Run LLM judge if not skipped
    const judgeMap = new Map<string, JudgeResult[]>();
    for (const result of results) {
      const lastTurn = result.turns[result.turns.length - 1];
      if (!lastTurn?.response) continue;

      const intentTag = result.turns[0]?.intentTag;
      const verdicts = await judgeResponse(
        lastTurn.userMessage,
        lastTurn.response,
        result.segment as Segment,
        lastTurn.advisorContext,
        intentTag,
        undefined,
        result.turns.length,
      );
      judgeMap.set(result.caseId, verdicts);
    }

    const previousReport = loadLatestReport();
    const report = generateReport(results, judgeMap, previousReport ?? undefined);
    const reportPath = saveReport(report);

    res.json({ report, resultsPath, reportPath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Eval run failed' });
  } finally {
    evalRunning = false;
  }
});

// POST /api/evals/run/code — code evals only (fast)
router.post('/run/code', async (_req: Request, res: Response) => {
  if (evalRunning) {
    res.status(409).json({ error: 'An eval run is already in progress' });
    return;
  }

  evalRunning = true;
  try {
    const results = await runAllCasesViaHttp(SERVER_URL);
    const resultsPath = saveResults(results, 'code-eval');

    const previousReport = loadLatestReport();
    const report = generateReport(results, undefined, previousReport ?? undefined);
    const reportPath = saveReport(report);

    res.json({ report, resultsPath, reportPath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Eval run failed' });
  } finally {
    evalRunning = false;
  }
});

// POST /api/evals/run/single/:caseId — run one case
router.post('/run/single/:caseId', async (req: Request, res: Response) => {
  try {
    const dataset = loadGoldenDataset();
    const testCase = dataset.find(tc => tc.id === req.params.caseId);

    if (!testCase) {
      res.status(404).json({ error: `Test case "${req.params.caseId}" not found` });
      return;
    }

    const result = await runSingleCaseViaHttp(testCase, SERVER_URL);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Single eval failed' });
  }
});

// ── Reports ──────────────────────────────────────────────────────────────────

// GET /api/evals/reports — list all reports
router.get('/reports', (_req: Request, res: Response) => {
  const reports = listReports();
  res.json({ reports });
});

// GET /api/evals/reports/latest — latest report
router.get('/reports/latest', (_req: Request, res: Response) => {
  const report = loadLatestReport();
  if (!report) {
    res.status(404).json({ error: 'No reports found. Run evals first.' });
    return;
  }
  res.json({ report });
});

// GET /api/evals/reports/:filename — specific report
router.get('/reports/:filename', (req: Request, res: Response) => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
  const report = loadReport(filename);
  if (!report) {
    res.status(404).json({ error: `Report "${filename}" not found` });
    return;
  }
  res.json({ report });
});

// ── Traces ───────────────────────────────────────────────────────────────────

// GET /api/evals/traces/:caseId — get trace for a specific case from latest results
router.get('/traces/:caseId', (_req: Request, res: Response) => {
  try {
    const resultFiles = listResultFiles();
    if (resultFiles.length === 0) {
      res.status(404).json({ error: 'No eval results found. Run evals first.' });
      return;
    }

    // Search latest results for the case
    for (const file of resultFiles) {
      const results = loadResults(file);
      const result = results.find(r => r.caseId === _req.params.caseId);
      if (result) {
        res.json({ trace: formatTrace(result), result });
        return;
      }
    }

    res.status(404).json({ error: `No results found for case "${_req.params.caseId}"` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load trace' });
  }
});

// ── Capture ──────────────────────────────────────────────────────────────────

// POST /api/evals/capture — capture a live conversation as a new test case
router.post('/capture', (req: Request, res: Response) => {
  try {
    const { leadRefId, userName, segment, messages, intentTag } = req.body as {
      leadRefId: string;
      userName: string;
      segment: Segment;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      intentTag?: string;
    };

    if (!leadRefId || !segment || !messages?.length) {
      res.status(400).json({ error: 'Missing required fields: leadRefId, segment, messages' });
      return;
    }

    // Build turns from user messages only
    const turns = messages
      .filter(m => m.role === 'user')
      .map((m, i) => ({
        userMessage: m.content,
        messageCount: i + 1,
        ...(i === 0 && intentTag ? { intentTag } : {}),
      }));

    if (turns.length === 0) {
      res.status(400).json({ error: 'No user messages found in conversation' });
      return;
    }

    // Generate an ID
    const timestamp = Date.now().toString(36);
    const segmentShort = segment.toLowerCase().replace(/_/g, '-');
    const id = `captured-${segmentShort}-${timestamp}`;

    const newCase: TestCase = {
      id,
      user: leadRefId,
      userName: userName || 'Unknown',
      segment,
      turns,
      expectedBehaviors: ['(add expected behaviors in dashboard)'],
    };

    const dataset = loadGoldenDataset();
    dataset.push(newCase);
    saveGoldenDataset(dataset);

    res.status(201).json({ message: 'Conversation captured as test case', case: newCase });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to capture' });
  }
});

export default router;
