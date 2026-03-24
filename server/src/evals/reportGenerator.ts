/**
 * Report Generator — Produces summary reports and detects regressions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCaseResult } from './evalRunner';
import { EvalResult, EvalCategory, summarizeResults } from './codeEvals';
import { JudgeResult } from './llmJudge';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CategoryStats {
  passed: number;
  failed: number;
  rate: string;
}

export interface EvalReport {
  timestamp: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  overallRate: string;
  codeEvals: Record<string, CategoryStats>;
  llmJudge: Record<string, CategoryStats>;
  failures: Array<{
    caseId: string;
    segment: string;
    userName: string;
    failedCodeEvals: string[];
    failedJudgeEvals: string[];
    details: string[];
  }>;
  regressions: RegressionAlert[];
}

export interface RegressionAlert {
  type: 'category_drop' | 'case_regression' | 'new_failure';
  message: string;
  category?: string;
  caseId?: string;
  previousRate?: string;
  currentRate?: string;
}

// ── Report Generation ────────────────────────────────────────────────────────

export function generateReport(
  results: TestCaseResult[],
  judgeResults?: Map<string, JudgeResult[]>,
  previousReport?: EvalReport,
): EvalReport {
  const timestamp = new Date().toISOString();

  // Code eval aggregation
  const allCodeEvals: EvalResult[] = results.flatMap(r => r.turns.flatMap(t => t.codeEvals));
  const codeEvalSummary = summarizeResults(allCodeEvals);

  // LLM judge aggregation
  const judgeSummary: Record<string, CategoryStats> = {};
  if (judgeResults && judgeResults.size > 0) {
    const allJudge: JudgeResult[] = [];
    for (const jrs of judgeResults.values()) {
      allJudge.push(...jrs);
    }

    const criteria = [...new Set(allJudge.map(j => j.criterion))];
    for (const c of criteria) {
      const cResults = allJudge.filter(j => j.criterion === c);
      const passed = cResults.filter(j => j.passed).length;
      const failed = cResults.filter(j => !j.passed).length;
      const total = passed + failed;
      judgeSummary[c] = {
        passed,
        failed,
        rate: total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : 'N/A',
      };
    }
  }

  // Failure details
  const failures = results
    .filter(r => !r.allPassed || (judgeResults && judgeResults.has(r.caseId) && judgeResults.get(r.caseId)!.some(j => !j.passed)))
    .map(r => {
      const codeFailures = r.turns
        .flatMap(t => t.codeEvals)
        .filter(e => !e.passed)
        .map(e => e.evalName);

      const judgeFailures = judgeResults?.get(r.caseId)
        ?.filter(j => !j.passed)
        .map(j => j.criterion) || [];

      const details = [
        ...r.turns.flatMap(t => t.codeEvals.filter(e => !e.passed).map(e => `[code] ${e.evalName}: ${e.details}`)),
        ...(judgeResults?.get(r.caseId)?.filter(j => !j.passed).map(j => `[judge] ${j.criterion}: ${j.reason}`) || []),
      ];

      return {
        caseId: r.caseId,
        segment: r.segment,
        userName: r.userName,
        failedCodeEvals: [...new Set(codeFailures)],
        failedJudgeEvals: [...new Set(judgeFailures)],
        details,
      };
    })
    .filter(f => f.failedCodeEvals.length > 0 || f.failedJudgeEvals.length > 0);

  // Regression detection
  const regressions = previousReport ? detectRegressions(codeEvalSummary, judgeSummary, results, previousReport) : [];

  const passedCases = results.filter(r => r.allPassed).length;

  return {
    timestamp,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    overallRate: results.length > 0 ? `${((passedCases / results.length) * 100).toFixed(1)}%` : 'N/A',
    codeEvals: codeEvalSummary,
    llmJudge: judgeSummary,
    failures,
    regressions,
  };
}

// ── Regression Detection ─────────────────────────────────────────────────────

function parseRate(rate: string): number {
  const n = parseFloat(rate);
  return Number.isFinite(n) ? n : 0;
}

function detectRegressions(
  currentCode: Record<string, CategoryStats>,
  currentJudge: Record<string, CategoryStats>,
  currentResults: TestCaseResult[],
  previous: EvalReport,
): RegressionAlert[] {
  const alerts: RegressionAlert[] = [];

  // Check code eval categories for drops > 5%
  for (const [cat, stats] of Object.entries(currentCode)) {
    const prevStats = previous.codeEvals[cat];
    if (!prevStats) continue;

    const currentRate = parseRate(stats.rate);
    const prevRate = parseRate(prevStats.rate);

    if (prevRate - currentRate > 5) {
      alerts.push({
        type: 'category_drop',
        message: `${cat} dropped from ${prevStats.rate} to ${stats.rate}`,
        category: cat,
        previousRate: prevStats.rate,
        currentRate: stats.rate,
      });
    }
  }

  // Check judge categories for drops > 5%
  for (const [cat, stats] of Object.entries(currentJudge)) {
    const prevStats = previous.llmJudge[cat];
    if (!prevStats) continue;

    const currentRate = parseRate(stats.rate);
    const prevRate = parseRate(prevStats.rate);

    if (prevRate - currentRate > 5) {
      alerts.push({
        type: 'category_drop',
        message: `[judge] ${cat} dropped from ${prevStats.rate} to ${stats.rate}`,
        category: cat,
        previousRate: prevStats.rate,
        currentRate: stats.rate,
      });
    }
  }

  // Check for previously-passing cases now failing
  const previousPassedIds = new Set(
    previous.failures.length > 0
      ? [] // We'd need full previous results to know which passed
      : [] // Skip this check if we don't have the data
  );

  // Check for new failure patterns
  const prevFailureIds = new Set(previous.failures.map(f => f.caseId));
  for (const r of currentResults) {
    if (!r.allPassed && !prevFailureIds.has(r.caseId)) {
      alerts.push({
        type: 'new_failure',
        message: `New failure: ${r.caseId} (${r.segment} / ${r.userName})`,
        caseId: r.caseId,
      });
    }
  }

  return alerts;
}

// ── Report Storage ───────────────────────────────────────────────────────────

const RESULTS_DIR = path.join(__dirname, 'results');

export function saveReport(report: EvalReport): string {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const filename = `report-${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
  return filepath;
}

export function loadLatestReport(): EvalReport | null {
  if (!fs.existsSync(RESULTS_DIR)) return null;

  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[0]), 'utf-8'));
}

export function loadReport(filename: string): EvalReport | null {
  const filepath = path.join(RESULTS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

export function listReports(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('report-') && f.endsWith('.json'))
    .sort()
    .reverse();
}

// ── Report Formatting ────────────────────────────────────────────────────────

export function formatReportSummary(report: EvalReport): string {
  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════╗');
  lines.push('║        EVAL REPORT SUMMARY               ║');
  lines.push('╚══════════════════════════════════════════╝');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Overall: ${report.passedCases}/${report.totalCases} passed (${report.overallRate})`);
  lines.push('');

  lines.push('CODE EVALS:');
  for (const [cat, stats] of Object.entries(report.codeEvals)) {
    const bar = stats.failed > 0 ? '❌' : '✅';
    lines.push(`  ${bar} ${cat.padEnd(22)} ${stats.passed}/${stats.passed + stats.failed} (${stats.rate})`);
  }
  lines.push('');

  if (Object.keys(report.llmJudge).length > 0) {
    lines.push('LLM JUDGE:');
    for (const [cat, stats] of Object.entries(report.llmJudge)) {
      const bar = stats.failed > 0 ? '❌' : '✅';
      lines.push(`  ${bar} ${cat.padEnd(22)} ${stats.passed}/${stats.passed + stats.failed} (${stats.rate})`);
    }
    lines.push('');
  }

  if (report.regressions.length > 0) {
    lines.push('⚠️  REGRESSIONS:');
    for (const r of report.regressions) {
      lines.push(`  • ${r.message}`);
    }
    lines.push('');
  }

  if (report.failures.length > 0) {
    lines.push('FAILURES:');
    for (const f of report.failures) {
      const allFailed = [...f.failedCodeEvals, ...f.failedJudgeEvals].join(', ');
      lines.push(`  ❌ ${f.caseId} (${f.segment}/${f.userName}): ${allFailed}`);
    }
  }

  return lines.join('\n');
}
