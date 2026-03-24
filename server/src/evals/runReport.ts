#!/usr/bin/env tsx
/**
 * CLI: npm run eval:report
 *
 * Prints the latest eval report summary with regression detection.
 * Does NOT re-run evals — just reads the latest saved report.
 */

import { loadLatestReport, formatReportSummary, listReports } from './reportGenerator';

function main() {
  const reports = listReports();

  if (reports.length === 0) {
    console.error('❌ No eval reports found. Run evals first: npm run eval');
    process.exit(1);
  }

  const report = loadLatestReport();
  if (!report) {
    console.error('❌ Failed to load latest report.');
    process.exit(1);
  }

  console.log(formatReportSummary(report));
  console.log('');
  console.log(`Total reports available: ${reports.length}`);
  console.log(`Latest: ${reports[0]}`);

  if (report.failedCases > 0 || report.regressions.length > 0) {
    process.exit(1);
  }
}

main();
