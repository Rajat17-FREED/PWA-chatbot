#!/usr/bin/env tsx
/**
 * CLI: npm run eval:trace
 *
 * Runs all golden dataset cases and outputs readable conversation traces.
 * Focused on human-readable output for manual review.
 */

import dotenv from 'dotenv';
dotenv.config({ path: require('path').join(__dirname, '..', '..', '.env') });

import { runAllCasesViaHttp, saveResults } from './evalRunner';
import { formatAllTraces } from './traceViewer';
import * as fs from 'fs';
import * as path from 'path';

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:3001';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   FREED Chatbot — Trace Viewer           ║');
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

  // Format and output traces
  const traceText = formatAllTraces(results);

  // Save to file
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const tracePath = path.join(resultsDir, `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  fs.writeFileSync(tracePath, traceText, 'utf-8');

  // Also save results JSON
  saveResults(results, 'trace');

  // Print to stdout
  console.log('');
  console.log(traceText);
  console.log('');
  console.log(`Trace saved to: ${tracePath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
