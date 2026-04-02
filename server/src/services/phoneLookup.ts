import * as fs from 'fs';
import * as path from 'path';

/**
 * Maps phone number (dedupeId) → leadRefId.
 * Loaded once at startup from lead-complete.csv.
 */
let phoneIndex: Map<string, string> | null = null;

/**
 * Maps leadRefId → phone number (dedupeId).
 */
let leadToPhone: Map<string, string> | null = null;

function normalizePhone(phone: string): string {
  // Strip spaces, dashes, country code prefix (+91 or 91)
  let p = phone.replace(/[\s\-]/g, '');
  if (p.startsWith('+91')) p = p.slice(3);
  else if (p.startsWith('91') && p.length === 12) p = p.slice(2);
  return p;
}

/**
 * Load phone lookups from lead-complete.csv, filtered to valid users.
 */
export function loadPhoneLookup(validLeadRefIds: Set<string>): void {
  if (phoneIndex) return;

  const csvPath = path.join(__dirname, '..', '..', '..', 'dataset', 'lead-phone-trimmed.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('lead-complete.csv not found at', csvPath);
    phoneIndex = new Map();
    leadToPhone = new Map();
    return;
  }

  phoneIndex = new Map();
  leadToPhone = new Map();
  let loaded = 0;

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) return;

  const header = lines[0].split(',');
  const colIndex: Record<string, number> = {};
  header.forEach((col, i) => { colIndex[col.trim()] = i; });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split(',');
    // In lead-complete.csv, the _id column matches users.json leadRefId values
    const leadRefId = fields[colIndex['_id']]?.trim();
    const dedupeId = fields[colIndex['dedupeId']]?.trim();

    if (!leadRefId || !dedupeId) continue;
    if (!validLeadRefIds.has(leadRefId)) continue;

    const normalizedPhone = normalizePhone(dedupeId);
    if (normalizedPhone && normalizedPhone.length >= 10) {
      phoneIndex.set(normalizedPhone, leadRefId);
      leadToPhone.set(leadRefId, normalizedPhone);
      loaded++;
    }
  }

  console.log(`Phone lookup loaded: ${loaded} users`);
}

/**
 * Look up a leadRefId by phone number (dedupeId).
 * Returns null if not found.
 */
export function lookupByPhone(phone: string): string | null {
  if (!phoneIndex) return null;
  const normalized = normalizePhone(phone);
  return phoneIndex.get(normalized) || null;
}

/**
 * Get phone number for a leadRefId.
 */
export function getPhoneForUser(leadRefId: string): string | null {
  if (!leadToPhone) return null;
  return leadToPhone.get(leadRefId) || null;
}

/**
 * Check if input looks like a phone number (10+ digits).
 */
export function looksLikePhone(input: string): boolean {
  const stripped = input.replace(/[\s\-+]/g, '');
  return /^\d{10,12}$/.test(stripped);
}
