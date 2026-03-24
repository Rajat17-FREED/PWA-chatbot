#!/usr/bin/env tsx
/**
 * CLI: npm run eval:judge
 *
 * Runs LLM-as-judge evals only on the golden dataset.
 * Requires the server to be running and OPENAI_API_KEY set.
 */

import dotenv from 'dotenv';
dotenv.config({ path: require('path').join(__dirname, '..', '..', '.env') });

import { runAllCasesViaHttp, saveResults } from './evalRunner';
import { judgeResponse, JudgeResult } from './llmJudge';
import { generateReport, saveReport, loadLatestReport, formatReportSummary } from './reportGenerator';
import { Segment } from '../types';

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:3001';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   FREED Chatbot — LLM Judge Evals        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Server: ${SERVER_URL}`);
  console.log('');

  // Check server is running
  try {
    const health = await fetch(`${SERVER_URL}/api/starters/DRP_Eligible`);
    if (!health.ok) throw new Error(`Status ${health.status}`);
  } catch {
    console.error('❌ Server not reachable. Start the server first: npm run dev');
    process.exit(1);
  }

  // Step 1: Run cases through pipeline (needed to get responses)
  console.log('Step 1/2: Running test cases to get responses...');
  const caseIds = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const results = await runAllCasesViaHttp(SERVER_URL, caseIds.length > 0 ? caseIds : undefined);
  console.log('');

  // Step 2: Run LLM judge on each case
  console.log('Step 2/2: Running LLM judge evals...');
  const judgeResults = new Map<string, JudgeResult[]>();

  for (const result of results) {
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

  // Generate report (judge-only focus)
  const previousReport = loadLatestReport();
  const report = generateReport(results, judgeResults, previousReport ?? undefined);
  const reportPath = saveReport(report);
  const resultsPath = saveResults(results, 'judge-eval');

  // Print judge summary
  console.log('═══════════════════════════════════════════');
  console.log('LLM JUDGE SUMMARY');
  console.log('═══════════════════════════════════════════');

  for (const [criterion, stats] of Object.entries(report.llmJudge)) {
    const bar = stats.failed > 0 ? '❌' : '✅';
    console.log(`  ${bar} ${criterion.padEnd(22)} ${stats.passed}/${stats.passed + stats.failed} (${stats.rate})`);
  }

  console.log('');
  console.log(`Results: ${resultsPath}`);
  console.log(`Report:  ${reportPath}`);

  // Print any judge failures
  const judgeFailures = report.failures.filter(f => f.failedJudgeEvals.length > 0);
  if (judgeFailures.length > 0) {
    console.log('');
    console.log('JUDGE FAILURES:');
    for (const f of judgeFailures) {
      console.log(`  ❌ ${f.caseId} (${f.segment}/${f.userName}): ${f.failedJudgeEvals.join(', ')}`);
      for (const d of f.details.filter(d => d.startsWith('[judge]'))) {
        console.log(`     ${d}`);
      }
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
