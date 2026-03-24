#!/usr/bin/env tsx
/**
 * CLI: npm run eval
 *
 * Runs ALL evals — code-based + LLM judge — on the golden dataset.
 * Generates a full report with regression detection.
 */

import dotenv from 'dotenv';
dotenv.config({ path: require('path').join(__dirname, '..', '..', '.env') });

import { runAllCasesViaHttp, saveResults } from './evalRunner';
import { judgeResponse, JudgeResult } from './llmJudge';
import { generateReport, saveReport, loadLatestReport, formatReportSummary } from './reportGenerator';
import { formatAllTraces } from './traceViewer';
import { Segment } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:3001';
const SKIP_JUDGE = process.argv.includes('--skip-judge');

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   FREED Chatbot — Full Eval Suite        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Server: ${SERVER_URL}`);
  console.log(`LLM Judge: ${SKIP_JUDGE ? 'SKIPPED' : 'enabled'}`);
  console.log('');

  // Check server is running
  try {
    const health = await fetch(`${SERVER_URL}/api/starters/DRP_Eligible`);
    if (!health.ok) throw new Error(`Status ${health.status}`);
  } catch {
    console.error('❌ Server not reachable. Start the server first: npm run dev');
    process.exit(1);
  }

  // Step 1: Run code evals
  console.log('Step 1/3: Running code evals...');
  const caseIds = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const results = await runAllCasesViaHttp(SERVER_URL, caseIds.length > 0 ? caseIds : undefined);
  console.log('');

  // Step 2: Run LLM judge (optional)
  const judgeResults = new Map<string, JudgeResult[]>();

  if (!SKIP_JUDGE) {
    console.log('Step 2/3: Running LLM judge evals...');
    for (const result of results) {
      // Only judge the last turn's response (most meaningful)
      const lastTurn = result.turns[result.turns.length - 1];
      if (!lastTurn?.response) continue;

      const priorHistory = result.turns.length > 1
        ? result.turns.slice(0, -1).map(t =>
            `User: ${t.userMessage}\nAssistant: ${t.response?.reply || '(error)'}`
          ).join('\n\n')
        : undefined;

      const intentTag = result.turns[0]?.intentTag;

      console.log(`  Judging: ${result.caseId}`);
      const verdicts = await judgeResponse(
        lastTurn.userMessage,
        lastTurn.response,
        result.segment as Segment,
        lastTurn.advisorContext,
        intentTag,
        priorHistory,
        result.turns.length,
      );

      judgeResults.set(result.caseId, verdicts);

      const passCount = verdicts.filter(v => v.passed).length;
      const status = passCount === verdicts.length ? '✅' : '❌';
      console.log(`  ${status} ${result.caseId}: ${passCount}/${verdicts.length} criteria passed`);
    }
    console.log('');
  } else {
    console.log('Step 2/3: LLM judge skipped (--skip-judge)');
    console.log('');
  }

  // Step 3: Generate report
  console.log('Step 3/3: Generating report...');
  const previousReport = loadLatestReport();
  const report = generateReport(results, judgeResults.size > 0 ? judgeResults : undefined, previousReport ?? undefined);

  // Save everything
  const resultsPath = saveResults(results, 'full-eval');
  const reportPath = saveReport(report);

  const traceText = formatAllTraces(results);
  const tracePath = path.join(__dirname, 'results', `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  fs.writeFileSync(tracePath, traceText, 'utf-8');

  console.log('');
  console.log(formatReportSummary(report));
  console.log('');
  console.log(`Results: ${resultsPath}`);
  console.log(`Report:  ${reportPath}`);
  console.log(`Traces:  ${tracePath}`);

  // Exit with error code if failures
  if (report.failedCases > 0 || report.regressions.length > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
