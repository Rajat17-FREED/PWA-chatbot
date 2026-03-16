import * as fs from 'fs';
import * as path from 'path';
import { EnrichedCreditReport } from '../types';
import { normalizeDebtTypeLabel, isCardLikeAccount } from '../utils/debtTypeNormalization';

interface AuditIssue {
  userId: string;
  lenderName: string;
  debtType: string;
  creditLimit: number | null;
  expectedDebtType: string;
  reason: string;
}

function run(): void {
  const jsonPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`Missing dataset file: ${jsonPath}`);
    process.exit(2);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, EnrichedCreditReport>;
  const issues: AuditIssue[] = [];
  let accountCount = 0;

  for (const [userId, report] of Object.entries(raw)) {
    for (const account of report.accounts || []) {
      accountCount += 1;
      const debtType = (account.debtType || '').trim();
      const expected = normalizeDebtTypeLabel({
        debtType: account.debtType,
        creditLimit: account.creditLimit,
        lenderName: account.lenderName,
      });

      if (expected !== debtType) {
        issues.push({
          userId,
          lenderName: account.lenderName,
          debtType,
          creditLimit: account.creditLimit,
          expectedDebtType: expected,
          reason: 'normalized-debt-type-mismatch',
        });
      }

      if (isCardLikeAccount({
        debtType: account.debtType,
        creditLimit: account.creditLimit,
        lenderName: account.lenderName,
      }) && !debtType.toLowerCase().includes('card')) {
        issues.push({
          userId,
          lenderName: account.lenderName,
          debtType,
          creditLimit: account.creditLimit,
          expectedDebtType: 'Credit Card',
          reason: 'card-like-account-with-non-card-label',
        });
      }
    }
  }

  console.log(JSON.stringify({
    users: Object.keys(raw).length,
    accounts: accountCount,
    issues: issues.length,
  }, null, 2));

  if (issues.length > 0) {
    console.error('First 25 issues:');
    for (const issue of issues.slice(0, 25)) {
      console.error(JSON.stringify(issue));
    }
    process.exit(1);
  }
}

run();

