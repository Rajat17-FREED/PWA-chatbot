/**
 * Serviceable Creditor Lookup — maps lender names to FREED's settlement capability.
 *
 * Loaded once at startup from serviceable_creditors.csv. Provides O(1) lookup
 * by normalized lender name to determine:
 * - Whether FREED can settle debts with this lender
 * - Which debt types are serviceable
 * - The lender's collection pressure score (1-9)
 * - Lender category (Bank, NBFC, Fintech, Others)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServiceableCreditor {
  creditorName: string;
  lookupNames: string[];
  isServicedByFreed: boolean;
  category: string;
  pressureScore: number | null;
  serviceableDebtTypes: string[];
  isDebarred: boolean;
}

// ── Module state ──────────────────────────────────────────────────────────────

let lookupMap: Map<string, ServiceableCreditor> | null = null;

// ── Parsing helpers ───────────────────────────────────────────────────────────

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
 * Parse the bracket+quote list format used in the CSV.
 * Example: `[""IDFCFIRSTBANK"" ""IDFCBANK"" ""IDFC""]` → ["IDFCFIRSTBANK", "IDFCBANK", "IDFC"]
 */
function parseBracketList(raw: string): string[] {
  if (!raw || raw === '[]') return [];
  // Strip outer brackets
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  // Split on "" "" (space-separated quoted items) or just extract quoted strings
  const matches = inner.match(/""([^"]*)""/g);
  if (matches) {
    return matches.map(m => m.replace(/""/g, '').trim()).filter(Boolean);
  }
  // Fallback: try splitting on spaces for unquoted values
  return inner.split(/\s+/).filter(Boolean);
}

/**
 * Normalize a lender name for lookup matching.
 * Strips corporate suffixes, punctuation, spaces → uppercase token string.
 */
function normalizeLenderName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bLIMITED\b|\bLTD\b|\bPVT\b|\bPRIVATE\b|\bINC\b|\bCORPORATION\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the serviceable creditors CSV into memory.
 * Called once at server startup.
 */
export function loadServiceableCreditors(): void {
  if (lookupMap) return;

  const csvPath = path.join(__dirname, '..', '..', '..', 'dataset', 'serviceable_creditors.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('[ServiceableCreditors] CSV not found at', csvPath);
    lookupMap = new Map();
    return;
  }

  const startTime = Date.now();
  lookupMap = new Map();

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');

  const header = parseCSVLine(lines[0]);
  const col: Record<string, number> = {};
  header.forEach((h, i) => { col[h] = i; });

  let serviceable = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const creditorName = fields[col['creditorName']] || '';
    if (!creditorName) continue;

    const lookupNames = parseBracketList(fields[col['lookupNameList']] || '');
    const isServicedByFreed = fields[col['isServicedByFreed']] === 'true';
    const category = fields[col['category']] || '';
    const pressureScoreRaw = fields[col['pressureScore']];
    const pressureScore = pressureScoreRaw ? parseInt(pressureScoreRaw, 10) : null;
    const serviceableDebtTypes = parseBracketList(fields[col['serviceableDebtTypeList']] || '');
    const isDebarred = fields[col['isDebarred']] === 'true';

    const creditor: ServiceableCreditor = {
      creditorName,
      lookupNames,
      isServicedByFreed,
      category,
      pressureScore: isNaN(pressureScore as number) ? null : pressureScore,
      serviceableDebtTypes,
      isDebarred,
    };

    if (isServicedByFreed) serviceable++;

    // Index by each lookup name
    for (const name of lookupNames) {
      lookupMap.set(name.toUpperCase(), creditor);
    }

    // Also index by normalized creditor name as fallback
    const normalizedName = normalizeLenderName(creditorName);
    if (normalizedName && !lookupMap.has(normalizedName)) {
      lookupMap.set(normalizedName, creditor);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[ServiceableCreditors] Loaded: ${lookupMap.size} lookup keys, ${serviceable} serviceable creditors in ${elapsed}ms`);
}

/**
 * Match a lender name against the serviceable creditors database.
 * Tries exact normalized match first, then progressively shorter prefixes.
 */
export function matchServiceableCreditor(lenderName: string): ServiceableCreditor | null {
  if (!lookupMap || lookupMap.size === 0) return null;

  const normalized = normalizeLenderName(lenderName);
  if (!normalized) return null;

  // Direct match
  const direct = lookupMap.get(normalized);
  if (direct) return direct;

  // Progressive prefix matching (strip from end)
  // e.g. "HDFCBANKLIMITED" → "HDFCBANK" → "HDFC"
  for (let len = normalized.length - 1; len >= 3; len--) {
    const prefix = normalized.slice(0, len);
    const match = lookupMap.get(prefix);
    if (match) return match;
  }

  return null;
}

/**
 * Check if a specific debt type is serviceable by a creditor.
 * Maps user-facing debt type labels to the CSV's enum format.
 */
export function isDebtTypeServiceable(creditor: ServiceableCreditor, userDebtType: string): boolean {
  if (!creditor.isServicedByFreed) return false;
  if (creditor.serviceableDebtTypes.length === 0) return false;

  const normalized = userDebtType.toUpperCase().replace(/[^A-Z]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  // Map common user-facing labels to CSV enums
  const mappings: Record<string, string[]> = {
    'CREDIT_CARD': ['CREDIT_CARD'],
    'PERSONAL_LOAN': ['PERSONAL_LOAN'],
    'CONSUMER_LOAN': ['CONSUMER_LOAN', 'PERSONAL_LOAN'],
    'BUSINESS_LOAN': ['BUSINESS_LOAN'],
    'SHORT_TERM_PERSONAL_LOAN_UNSECURED': ['PERSONAL_LOAN'],
    'SHORT_TERM_PERSONAL_LOAN': ['PERSONAL_LOAN'],
    'TEMPORARY_OVERDRAFT': ['TEMPORARY_OVERDRAFT'],
    'OTHERS': ['OTHERS'],
  };

  const candidates = mappings[normalized] || [normalized];

  for (const candidate of candidates) {
    if (creditor.serviceableDebtTypes.includes(candidate)) return true;
  }

  // Fallback: check if OTHERS is in the serviceable list (catch-all)
  if (creditor.serviceableDebtTypes.includes('OTHERS')) return true;

  return false;
}
