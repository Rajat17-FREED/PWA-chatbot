import * as fs from 'fs';
import * as path from 'path';
import type { EnrichedCreditReport } from '../types';

/**
 * In-memory enriched credit report data.
 * Loaded once at startup from the extracted credit-reports.json.
 *
 * Keys can be leadRefId, PAN:XXXXX, or MongoDB _id — depends on how
 * the extraction script identified each user.
 */
let reportIndex: Map<string, EnrichedCreditReport> | null = null;

/**
 * Secondary index: leadRefId → key in reportIndex.
 * Built from the validLeadRefIds cross-reference.
 */
let leadRefIdIndex: Map<string, string> | null = null;

/**
 * Load enriched credit reports from JSON.
 * Called once at startup alongside other data loaders.
 */
export function loadCreditReports(): void {
  if (reportIndex) return;

  const jsonPath = path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');

  if (!fs.existsSync(jsonPath)) {
    console.warn('credit-reports.json not found at', jsonPath, '— enriched credit data disabled');
    reportIndex = new Map();
    leadRefIdIndex = new Map();
    return;
  }

  console.log('Loading enriched credit reports...');
  const startTime = Date.now();

  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    reportIndex = new Map(Object.entries(raw));

    const elapsed = Date.now() - startTime;
    console.log(`Credit reports loaded: ${reportIndex.size} users in ${elapsed}ms`);
  } catch (err: any) {
    console.error('Failed to parse credit-reports.json:', err?.message);
    reportIndex = new Map();
  }

  leadRefIdIndex = new Map();
}

/**
 * Register a mapping from leadRefId to the key used in credit-reports.json.
 * Call this after both datasets are loaded so we can cross-reference.
 */
export function registerLeadRefMapping(leadRefId: string, creditReportKey: string): void {
  if (!leadRefIdIndex) leadRefIdIndex = new Map();
  leadRefIdIndex.set(leadRefId, creditReportKey);
}

/**
 * Get the enriched credit report for a user.
 * Tries direct leadRefId match first, then the cross-reference index.
 */
export function getCreditReport(leadRefId: string): EnrichedCreditReport | null {
  if (!reportIndex) return null;

  // Direct match (when extraction used leadRefId as key)
  const direct = reportIndex.get(leadRefId);
  if (direct) return direct;

  // Cross-reference match (when extraction used PAN or _id)
  if (leadRefIdIndex) {
    const altKey = leadRefIdIndex.get(leadRefId);
    if (altKey) {
      return reportIndex.get(altKey) || null;
    }
  }

  return null;
}

/**
 * Get all keys in the credit report index.
 * Useful for diagnostics and cross-referencing.
 */
export function getCreditReportKeys(): string[] {
  if (!reportIndex) return [];
  return [...reportIndex.keys()];
}

/**
 * Get the total number of loaded credit reports.
 */
export function getCreditReportCount(): number {
  return reportIndex?.size ?? 0;
}
