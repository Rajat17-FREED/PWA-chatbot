import * as fs from 'fs';
import * as path from 'path';
import { CreditorAccount } from '../types';

/**
 * In-memory creditor data indexed by leadRefId.
 * Loaded once at startup from the CSV.
 */
let creditorIndex: Map<string, CreditorAccount[]> | null = null;

/**
 * Parse a CSV value that may be quoted and contain commas (e.g. "16,000").
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse a numeric string that may contain commas (Indian formatting).
 * Returns null if empty or not a valid number.
 */
function parseAmount(val: string): number | null {
  if (!val || val === '-99') return null;
  const cleaned = val.replace(/,/g, '');
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Load creditor data from CSV, filtered to only include accounts
 * for users in the provided set of leadRefIds.
 */
export function loadCreditorData(validLeadRefIds: Set<string>): void {
  if (creditorIndex) return;

  const csvPath = path.join(__dirname, '..', '..', '..', 'dataset', 'Creditor.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('Creditor.csv not found at', csvPath);
    creditorIndex = new Map();
    return;
  }

  console.log('Loading creditor data from CSV...');
  const startTime = Date.now();

  creditorIndex = new Map();

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');

  // Parse header
  const header = parseCSVLine(lines[0]);
  const colIndex: Record<string, number> = {};
  header.forEach((col, i) => { colIndex[col] = i; });

  let loaded = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const leadRefId = fields[colIndex['leadRefId']];

    // Only load data for users in our system
    if (!leadRefId || !validLeadRefIds.has(leadRefId)) continue;

    const account: CreditorAccount = {
      lenderName: fields[colIndex['lenderName']] || '',
      accountStatus: fields[colIndex['accountStatus']] as 'ACTIVE' | 'CLOSED' | string,
      accountType: fields[colIndex['accountType']] || '',
      debtType: fields[colIndex['debtType']] || '',
      outstandingAmount: parseAmount(fields[colIndex['outstandingAmount']]),
      overdueAmount: parseAmount(fields[colIndex['overdueAmount']]),
      delinquency: parseAmount(fields[colIndex['delinquency']]),
      creditLimitAmount: parseAmount(fields[colIndex['creditLimitAmount']]),
      sanctionedAmount: parseAmount(fields[colIndex['sanctionedAmount']]),
      openDate: fields[colIndex['openDate']] || '',
      closedDate: fields[colIndex['closedDate']] || '',
      lastPaymentDate: fields[colIndex['lastPaymentDate']] || '',
      reportedDate: fields[colIndex['reportedDate']] || '',
      repaymentTenure: parseAmount(fields[colIndex['repaymentTenure']]),
      tenurePaid: parseAmount(fields[colIndex['tenurePaid']]),
      settlementAmount: parseAmount(fields[colIndex['settlementAmount']]),
      suitFiledWilfulDefault: fields[colIndex['suitFiledWilfulDefault']] || '',
    };

    if (!creditorIndex.has(leadRefId)) {
      creditorIndex.set(leadRefId, []);
    }
    creditorIndex.get(leadRefId)!.push(account);
    loaded++;
  }

  const elapsed = Date.now() - startTime;
  console.log(`Creditor data loaded: ${loaded} accounts for ${creditorIndex.size} users in ${elapsed}ms`);
}

/**
 * Get all creditor accounts for a user.
 */
export function getCreditorAccounts(leadRefId: string): CreditorAccount[] {
  if (!creditorIndex) return [];
  return creditorIndex.get(leadRefId) || [];
}
