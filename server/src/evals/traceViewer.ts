/**
 * Trace Viewer — Formats eval results into readable conversation traces.
 * Output can be written to stdout or saved to a file.
 */

import { TestCaseResult, TurnResult } from './evalRunner';

function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '₹0';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatTurn(turn: TurnResult): string {
  const lines: string[] = [];

  const intentLabel = turn.intentTag ? ` [${turn.intentTag}]` : '';
  lines.push(`  USER: "${turn.userMessage}"${intentLabel}`);

  if (turn.error) {
    lines.push(`  ERROR: ${turn.error}`);
    return lines.join('\n');
  }

  if (!turn.response) {
    lines.push(`  RESPONSE: (null)`);
    return lines.join('\n');
  }

  // Response text (truncated for readability)
  const reply = turn.response.reply || '(empty)';
  const replyLines = reply.split('\n').filter(l => l.trim());
  if (replyLines.length <= 8) {
    lines.push(`  RESPONSE:`);
    for (const rl of replyLines) {
      lines.push(`    ${rl}`);
    }
  } else {
    lines.push(`  RESPONSE: (${replyLines.length} lines)`);
    for (const rl of replyLines.slice(0, 6)) {
      lines.push(`    ${rl}`);
    }
    lines.push(`    ... (${replyLines.length - 6} more lines)`);
  }

  // Follow-ups
  if (turn.response.followUps && turn.response.followUps.length > 0) {
    lines.push(`  FOLLOW-UPS:`);
    turn.response.followUps.forEach((fu, i) => {
      lines.push(`    ${i + 1}. "${truncate(fu, 80)}"`);
    });
  }

  // Redirect
  if (turn.response.redirectUrl) {
    lines.push(`  REDIRECT: ${turn.response.redirectUrl}${turn.response.redirectLabel ? ` (${turn.response.redirectLabel})` : ''}`);
  }

  // Lender selector
  if ((turn.response as any).lenderSelector) {
    const ls = (turn.response as any).lenderSelector;
    lines.push(`  LENDER SELECTOR: "${ls.prompt}" (${ls.lenders?.length || 0} lenders)`);
  }

  // Eval results
  if (turn.codeEvals.length > 0) {
    lines.push(`  EVALS:`);
    const passed = turn.codeEvals.filter(e => e.passed);
    const failed = turn.codeEvals.filter(e => !e.passed);

    if (passed.length > 0) {
      lines.push(`    ✅ ${passed.map(e => e.evalName).join(', ')}`);
    }
    if (failed.length > 0) {
      for (const f of failed) {
        lines.push(`    ❌ ${f.evalName}: ${f.details || 'failed'}`);
      }
    }
  }

  return lines.join('\n');
}

export function formatTrace(result: TestCaseResult): string {
  const lines: string[] = [];

  const status = result.allPassed ? '✅ PASS' : '❌ FAIL';

  lines.push(`${'═'.repeat(80)}`);
  lines.push(`${status} | ${result.segment} | ${result.userName} | ${result.caseId}`);
  lines.push(`${'─'.repeat(80)}`);

  // Expected behaviors
  lines.push(`EXPECTED:`);
  for (const eb of result.expectedBehaviors) {
    lines.push(`  • ${eb}`);
  }
  lines.push('');

  // Turns
  for (const turn of result.turns) {
    lines.push(formatTurn(turn));
    lines.push('');
  }

  // Summary
  if (result.failedEvals.length > 0) {
    lines.push(`FAILURES: ${result.failedEvals.join(', ')}`);
  }

  lines.push(`${'═'.repeat(80)}`);
  lines.push('');

  return lines.join('\n');
}

export function formatAllTraces(results: TestCaseResult[]): string {
  const lines: string[] = [];

  // Header
  lines.push('EVAL TRACE REPORT');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total cases: ${results.length}`);

  const passed = results.filter(r => r.allPassed).length;
  const failed = results.length - passed;
  lines.push(`Passed: ${passed} | Failed: ${failed} | Rate: ${results.length > 0 ? ((passed / results.length) * 100).toFixed(1) : 0}%`);
  lines.push('');

  // Quick summary table
  lines.push('QUICK SUMMARY');
  lines.push(`${'─'.repeat(80)}`);
  for (const r of results) {
    const status = r.allPassed ? '✅' : '❌';
    const failInfo = r.failedEvals.length > 0 ? ` [${r.failedEvals.join(', ')}]` : '';
    lines.push(`${status} ${r.caseId.padEnd(40)} ${r.segment.padEnd(16)} ${r.userName}${failInfo}`);
  }
  lines.push('');

  // Full traces
  for (const result of results) {
    lines.push(formatTrace(result));
  }

  return lines.join('\n');
}
