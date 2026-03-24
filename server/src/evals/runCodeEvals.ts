#!/usr/bin/env tsx
/**
 * CLI: npm run eval:code
 *
 * Runs all golden dataset test cases through the live server
 * and executes code-based (deterministic) evals only.
 */

import dotenv from 'dotenv';
dotenv.config({ path: require('path').join(__dirname, '..', '..', '.env') });

import { runAllCasesViaHttp, saveResults } from './evalRunner';
import { summarizeResults, EvalResult } from './codeEvals';
import { formatAllTraces } from './traceViewer';
import * as fs from 'fs';
import * as path from 'path';

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:3001';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      FREED Chatbot — Code Evals          ║');
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

  console.log('Running test cases...');
  console.log('');

  const caseIds = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const results = await runAllCasesViaHttp(SERVER_URL, caseIds.length > 0 ? caseIds : undefined);

  // Aggregate code evals
  const allEvals: EvalResult[] = results.flatMap(r => r.turns.flatMap(t => t.codeEvals));
  const summary = summarizeResults(allEvals);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════');

  const totalCases = results.length;
  const passedCases = results.filter(r => r.allPassed).length;

  console.log(`Cases: ${passedCases}/${totalCases} passed (${totalCases > 0 ? ((passedCases / totalCases) * 100).toFixed(1) : 0}%)`);
  console.log('');

  console.log('By category:');
  for (const [cat, stats] of Object.entries(summary)) {
    const bar = stats.failed > 0 ? '❌' : '✅';
    console.log(`  ${bar} ${cat.padEnd(22)} ${stats.passed}/${stats.passed + stats.failed} (${stats.rate})`);
  }

  // Save results
  const filepath = saveResults(results, 'code-eval');
  console.log('');
  console.log(`Results saved to: ${filepath}`);

  // Save trace
  const traceText = formatAllTraces(results);
  const tracePath = path.join(__dirname, 'results', `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  fs.writeFileSync(tracePath, traceText, 'utf-8');
  console.log(`Traces saved to: ${tracePath}`);

  // Exit with error code if failures
  if (passedCases < totalCases) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
