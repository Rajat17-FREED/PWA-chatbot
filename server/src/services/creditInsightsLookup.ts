import * as fs from 'fs';
import * as path from 'path';
import { CreditInsights } from '../types';

let insightsIndex: Map<string, CreditInsights> | null = null;

function parseNum(val: string): number | null {
  if (!val || !val.trim()) return null;
  const cleaned = val.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function parseStr(val: string): string {
  return val ? val.trim() : '';
}

/**
 * Load credit insights key factors from CSV into a leadRefId-indexed map.
 * Filtered to only include users in the provided valid set.
 */
export function loadCreditInsights(validLeadRefIds: Set<string>): void {
  if (insightsIndex) return;

  const csvPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-insights-key-factors.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('credit-insights-key-factors.csv not found at', csvPath);
    insightsIndex = new Map();
    return;
  }

  insightsIndex = new Map();
  let loaded = 0;

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) return;

  // Parse header — has comma-in-colon column names like "paymentHistory: onTimeCount"
  const header = lines[0].split(',');
  const colIndex: Record<string, number> = {};
  header.forEach((col, i) => { colIndex[col.trim()] = i; });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Use split on comma but watch for JSON values (wrapped in braces/quotes)
    // The flat columns are safe to split naively
    const fields = line.split(',');
    const leadRefId = fields[colIndex['leadRefId']]?.trim();
    if (!leadRefId || !validLeadRefIds.has(leadRefId)) continue;

    const insights: CreditInsights = {
      creditScore: parseNum(fields[colIndex['creditScore']]),

      paymentHistory: {
        onTimeCount: parseNum(fields[colIndex['paymentHistory: onTimeCount']]),
        onTimePercentage: parseNum(fields[colIndex['paymentHistory: onTimePercentage']]),
        lateCount: parseNum(fields[colIndex['paymentHistory: lateCount']]),
        impact: parseStr(fields[colIndex['paymentHistory: impact']]),
        status: parseStr(fields[colIndex['paymentHistory: status']]),
      },

      creditUtilization: {
        totalLimit: parseNum(fields[colIndex['creditUtilization: totalLimit']]),
        utilizationPercentage: parseNum(fields[colIndex['creditUtilization: utilizationPercentage']]),
        onTimePercentage: parseNum(fields[colIndex['creditUtilization: onTimePercentage']]),
        totalUsed: parseNum(fields[colIndex['creditUtilization: totalUsed']]),
        impact: parseStr(fields[colIndex['creditUtilization: impact']]),
        status: parseStr(fields[colIndex['creditUtilization: status']]),
      },

      creditAge: {
        ageLabel: parseStr(fields[colIndex['creditAge: ageLabel']]),
        ageCount: parseNum(fields[colIndex['creditAge: ageCount']]),
        activeAccounts: parseNum(fields[colIndex['creditAge: activeAccounts']]),
        impact: parseStr(fields[colIndex['creditAge: impact']]),
        status: parseStr(fields[colIndex['creditAge: status']]),
      },

      creditMix: {
        mixPercentage: parseNum(fields[colIndex['creditMix: mixPercentage']]),
        activeAccounts: parseNum(fields[colIndex['creditMix: activeAccounts']]),
        activeSecuredAccounts: parseNum(fields[colIndex['creditMix: activeSecuredAccounts']]),
        activeUnsecuredAccounts: parseNum(fields[colIndex['creditMix: activeUnSecuredAccounts']]),
        impact: parseStr(fields[colIndex['creditMix: impact']]),
        status: parseStr(fields[colIndex['creditMix: status']]),
      },

      inquiries: {
        total: parseNum(fields[colIndex['inquiries: total']]),
        creditCard: parseNum(fields[colIndex['inquiries: creditCard']]),
        loan: parseNum(fields[colIndex['inquiries: loan']]),
        impact: parseStr(fields[colIndex['inquiries: impact']]),
        status: parseStr(fields[colIndex['inquiries: status']]),
      },
    };

    insightsIndex.set(leadRefId, insights);
    loaded++;
  }

  console.log(`Credit insights loaded: ${loaded} users`);
}

export function getCreditInsights(leadRefId: string): CreditInsights | null {
  if (!insightsIndex) return null;
  return insightsIndex.get(leadRefId) || null;
}
