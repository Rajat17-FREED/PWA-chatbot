/**
 * extractCreditReports.ts — CIBIL / INProfileResponse format
 *
 * Processes a large NDJSON dump (raw-json.json) from MongoDB where each line
 * is one user's credit pull:
 *   { _id: {$oid}, mobile, firstName, lastName, crJson: { INProfileResponse: {...} }, bureau }
 *
 * User matching strategy: dump.mobile → lead-complete.csv.dedupeId → leadRefId
 *
 * Output: compact credit-reports.json keyed by leadRefId, used at runtime by
 * creditReportLookup.ts to enrich system prompts and tooltips.
 *
 * Usage:
 *   npx tsx server/src/scripts/extractCreditReports.ts [options]
 *
 * Options:
 *   --input=<path>          NDJSON input file (default: dataset/raw-json.json)
 *   --output=<path>         Output JSON file (default: dataset/credit-reports.json)
 *   --filter-users-json=<p> ONLY extract users listed in this users.json (recommended
 *                           for large dumps — avoids building a multi-GB output file)
 *   --max=<n>               Stop after N records (for testing)
 *
 * Example (recommended for production):
 *   npx tsx server/src/scripts/extractCreditReports.ts \
 *     --filter-users-json=server/src/data/users.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { EnrichedCreditReport, EnrichedAccount, DPDSummary, PortfolioSummary } from '../types';

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputFile = args.find(a => a.startsWith('--input='))?.split('=').slice(1).join('=')
  ?? path.join(__dirname, '..', '..', '..', 'dataset', 'raw-json.json');
const outputFile = args.find(a => a.startsWith('--output='))?.split('=').slice(1).join('=')
  ?? path.join(__dirname, '..', '..', '..', 'dataset', 'credit-reports.json');
const filterUsersJson = args.find(a => a.startsWith('--filter-users-json='))?.split('=').slice(1).join('=')
  ?? path.join(__dirname, '..', 'data', 'users.json'); // default: always filter to known users
const maxRecords = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '0', 10);

// ── MongoDB Extended JSON unwrapper ──────────────────────────────────────────
// The dump uses MongoDB's strict extended JSON format where ints/longs are
// wrapped objects. This helper unwraps them recursively so the rest of the
// code can treat values as plain JS primitives.

function unwrap(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(unwrap);

  // MongoDB extended types
  if ('$numberInt' in val)  return parseInt(val.$numberInt, 10);
  if ('$numberLong' in val) return parseInt(val.$numberLong, 10);
  if ('$numberDouble' in val) return parseFloat(val.$numberDouble);
  if ('$numberDecimal' in val) return parseFloat(val.$numberDecimal);
  if ('$oid' in val)        return val.$oid;
  if ('$date' in val) {
    const ts = typeof val.$date === 'object' ? unwrap(val.$date) : val.$date;
    return new Date(ts).toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // Recurse into plain objects
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    result[k] = unwrap(v);
  }
  return result;
}

// ── CIBIL Account type code → human-readable name + secured flag ─────────────

const CIBIL_TYPES: Record<number, { debtType: string; secured: boolean }> = {
  1:  { debtType: 'Auto Loan',                    secured: true  },
  2:  { debtType: 'Housing Loan',                 secured: true  },
  3:  { debtType: 'Property Loan',                secured: true  },
  4:  { debtType: 'Loan Against Property',        secured: true  },
  5:  { debtType: 'Personal Loan',                secured: false },
  6:  { debtType: 'Personal Loan (Secured)',      secured: true  },
  7:  { debtType: 'Credit Card',                  secured: false },
  8:  { debtType: 'Leasing',                      secured: false },
  9:  { debtType: 'Consumer Loan',                secured: false },
  10: { debtType: 'Business Loan',                secured: false },
  11: { debtType: 'Education Loan',               secured: false },
  13: { debtType: 'Vehicle Loan',                 secured: true  },
  14: { debtType: 'Car Loan',                     secured: true  },
  15: { debtType: 'Business Loan (Small)',        secured: false },
  17: { debtType: 'Property Collateral Loan',     secured: true  },
  18: { debtType: 'Agriculture Loan',             secured: false },
  21: { debtType: 'Overdraft',                    secured: false },
  22: { debtType: 'Two-Wheeler Loan',             secured: true  },
  23: { debtType: 'Non-Funded Credit',            secured: false },
  24: { debtType: 'Loan to Professional',         secured: false },
  26: { debtType: 'Secured Credit Card',          secured: true  },
  27: { debtType: 'Microfinance Loan',            secured: false },
  29: { debtType: 'Rural Business Loan',          secured: false },
  31: { debtType: 'Home Loan',                    secured: true  },
  35: { debtType: 'Kisan Credit Card',            secured: false },
  36: { debtType: 'Tractor Loan',                 secured: true  },
  37: { debtType: 'Corporate Credit Card',        secured: false },
  38: { debtType: 'Loan on Credit Card',          secured: false },
  39: { debtType: 'PMAY Loan',                    secured: true  },
  40: { debtType: 'Short Term Personal Loan',     secured: false },
  41: { debtType: 'Business Loan (Micro)',        secured: false },
  42: { debtType: 'Mudra Loan',                   secured: false },
  43: { debtType: 'Business Loan (Medium)',       secured: false },
  50: { debtType: 'Consumer Loan',                secured: false },
};

// ── DPD computation from CIBIL Payment_History_Profile ───────────────────────
// The profile string encodes payment history, newest-first:
// '0' = current, '1' = 30 DPD, '2' = 60 DPD, ... '8' = 730+ DPD
// 'N','X' = no payment due/no data (skip)

const CIBIL_DPD_MAP: Record<string, number> = {
  '0': 0, '1': 30, '2': 60, '3': 90, '4': 120,
  '5': 150, '6': 180, '7': 365, '8': 730, 'A': 730,
};

function computeDPDFromProfile(
  profile: string | null | undefined,
  latestHistory: any           // CAIS_Account_History — may be object or array
): DPDSummary {
  const dpds: number[] = [];

  // Parse Payment_History_Profile string (most reliable, multi-month)
  if (profile && typeof profile === 'string') {
    for (const ch of profile.toUpperCase()) {
      if (ch in CIBIL_DPD_MAP) dpds.push(CIBIL_DPD_MAP[ch]);
      // 'N', 'X', other = no data, skip
    }
  }

  // If still empty, try CAIS_Account_History (may be object or array)
  if (dpds.length === 0 && latestHistory) {
    const entries: any[] = Array.isArray(latestHistory) ? latestHistory : [latestHistory];
    for (const e of entries) {
      const dpd = typeof e?.Days_Past_Due === 'number' ? e.Days_Past_Due : 0;
      dpds.push(dpd);
    }
  }

  if (dpds.length === 0) {
    return { maxDPD: 0, currentDPD: 0, monthsWithDPD: 0, totalMonths: 0, recentTrend: [], improving: false, worstPeriod: null };
  }

  const maxDPD = Math.max(0, ...dpds);
  const currentDPD = dpds[0] ?? 0;
  const monthsWithDPD = dpds.filter(d => d > 0).length;
  const recentTrend = dpds.slice(0, 6);

  const recent3 = recentTrend.slice(0, 3);
  const older3 = recentTrend.slice(3, 6);
  const avgRecent = recent3.length > 0 ? recent3.reduce((s, v) => s + v, 0) / recent3.length : 0;
  const avgOlder  = older3.length  > 0 ? older3.reduce((s, v)  => s + v, 0) / older3.length  : 0;
  const improving = older3.length > 0 && avgRecent < avgOlder;

  return { maxDPD, currentDPD, monthsWithDPD, totalMonths: dpds.length, recentTrend, improving, worstPeriod: null };
}

// ── Account extraction (CIBIL format) ────────────────────────────────────────

function extractAccount(raw: any): EnrichedAccount | null {
  const typeCode = typeof raw.Account_Type === 'number' ? raw.Account_Type : 0;
  const typeInfo = CIBIL_TYPES[typeCode] ?? { debtType: 'Loan', secured: false };

  const lenderName: string = raw.Subscriber_Name || 'Unknown';
  if (!lenderName || lenderName === 'Unknown') return null;

  // Status: closed if Date_Closed is present and non-zero
  const dateClosed: number | null = raw.Date_Closed > 0 ? raw.Date_Closed : null;
  const status = dateClosed ? 'CLOSED' : 'ACTIVE';

  const outstandingAmount: number | null = raw.Current_Balance > 0 ? raw.Current_Balance : 0;
  const overdueAmount: number | null = raw.Amount_Past_Due > 0 ? raw.Amount_Past_Due : 0;
  const sanctionedAmount: number | null = raw.Highest_Credit_or_Original_Loan_Amount > 0 ? raw.Highest_Credit_or_Original_Loan_Amount : null;
  const creditLimit: number | null = raw.Credit_Limit_Amount > 0 ? raw.Credit_Limit_Amount : null;

  const writtenOffStatus: string | null = raw.Written_off_Settled_Status
    && raw.Written_off_Settled_Status !== '' && raw.Written_off_Settled_Status !== '00'
    ? raw.Written_off_Settled_Status : null;

  const suitFiled: string | null = raw.SuitFiled_WilfulDefault
    && raw.SuitFiled_WilfulDefault !== '' && raw.SuitFiled_WilfulDefault !== '00'
    ? raw.SuitFiled_WilfulDefault : null;

  const dpd = computeDPDFromProfile(raw.Payment_History_Profile, raw.CAIS_Account_History);

  // Format dates (YYYYMMDD int → YYYY-MM-DD string)
  const fmtDate = (d: number | null) => {
    if (!d || d <= 0) return null;
    const s = String(d).padStart(8, '0');
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };

  return {
    lenderName,
    status,
    accountType: typeInfo.secured ? 'SECURED' : 'UNSECURED',
    debtType: typeInfo.debtType,
    outstandingAmount,
    overdueAmount,
    creditLimit,
    sanctionedAmount,
    roi: null,         // CIBIL reports don't include interest rates
    repaymentTenure: null,
    estimatedEMI: null,
    openDate: fmtDate(raw.Open_Date),
    closedDate: fmtDate(dateClosed),
    lastPaymentDate: null,
    delinquency: null,
    writtenOffStatus,
    suitFiled,
    dpd,
  };
}

// ── Portfolio summary ────────────────────────────────────────────────────────

function computeSummary(accounts: EnrichedAccount[], rawSummary: any): PortfolioSummary {
  const active = accounts.filter(a => a.status === 'ACTIVE');
  const closed = accounts.filter(a => a.status === 'CLOSED');

  // Use bureau's pre-computed outstanding totals (more accurate than summing accounts)
  const totalOutstanding   = rawSummary?.Outstanding_Balance_All ?? accounts.reduce((s, a) => s + (a.outstandingAmount || 0), 0);
  const securedOutstanding = rawSummary?.Outstanding_Balance_Secured ?? 0;
  const unsecuredOutstanding = rawSummary?.Outstanding_Balance_UnSecured ?? (totalOutstanding - securedOutstanding);

  // Our own delinquent count (reliable)
  const delinquentCount = accounts.filter(a =>
    a.dpd.maxDPD > 0 || (a.overdueAmount && a.overdueAmount > 0)
  ).length;

  const securedActive    = active.filter(a => a.accountType === 'SECURED');
  const unsecuredActive  = active.filter(a => a.accountType !== 'SECURED');
  const creditCards      = active.filter(a => a.debtType === 'Credit Card' || a.debtType === 'Secured Credit Card');
  const personalLoans    = active.filter(a => a.debtType.toLowerCase().includes('personal loan') || a.debtType.toLowerCase().includes('short term'));

  // Largest outstanding active debt
  const activeWithDebt = active.filter(a => a.outstandingAmount && a.outstandingAmount > 0);
  const largestDebt: PortfolioSummary['largestDebt'] = activeWithDebt.length > 0
    ? (() => {
        const sorted = [...activeWithDebt].sort((a, b) => (b.outstandingAmount || 0) - (a.outstandingAmount || 0));
        return { lender: sorted[0].lenderName, amount: sorted[0].outstandingAmount!, type: sorted[0].debtType };
      })()
    : null;

  // Worst DPD account
  const worstDPDAccount: PortfolioSummary['worstDPDAccount'] = (() => {
    let worst: EnrichedAccount | null = null;
    let worstVal = 0;
    for (const a of accounts) {
      if (a.dpd.maxDPD > worstVal) { worstVal = a.dpd.maxDPD; worst = a; }
    }
    return worst ? { lender: worst.lenderName, maxDPD: worstVal, type: worst.debtType } : null;
  })();

  return {
    activeCount: active.length,
    closedCount: closed.length,
    delinquentCount,
    totalOutstanding,
    securedOutstanding,
    unsecuredOutstanding,
    securedActiveCount: securedActive.length,
    unsecuredActiveCount: unsecuredActive.length,
    creditCardCount: creditCards.length,
    personalLoanCount: personalLoans.length,
    highestROI: null,   // CIBIL reports don't include interest rates
    lowestROI: null,
    largestDebt,
    worstDPDAccount,
  };
}

// ── Full report extraction ───────────────────────────────────────────────────

function extractReport(doc: any): EnrichedCreditReport | null {
  const profile = doc.crJson?.INProfileResponse;
  if (!profile) return null;

  // Credit score
  const creditScore: number | null = profile.SCORE?.BureauScore > 0 ? profile.SCORE.BureauScore : null;
  const bureau: string = doc.bureau || doc.vendor || 'CIBIL';
  const reportDate: string = doc.pulledDate ? String(doc.pulledDate).split('T')[0] : '';

  // Accounts
  const caisAccount = profile.CAIS_Account;
  if (!caisAccount) return null;

  let rawAccounts: any[] = caisAccount.CAIS_Account_DETAILS;
  if (!Array.isArray(rawAccounts)) {
    rawAccounts = rawAccounts ? [rawAccounts] : [];
  }

  const allAccounts = rawAccounts
    .map(a => extractAccount(a))
    .filter((a): a is EnrichedAccount => a !== null);

  if (allAccounts.length === 0) return null;

  // Sort: ACTIVE first (by outstanding desc), then CLOSED (by outstanding desc)
  allAccounts.sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
    return (b.outstandingAmount || 0) - (a.outstandingAmount || 0);
  });

  // Cap accounts: all active + significant closed (DPD history or written off)
  const activeAccounts = allAccounts.filter(a => a.status === 'ACTIVE');
  const significantClosed = allAccounts.filter(a =>
    a.status !== 'ACTIVE' && (
      a.dpd.maxDPD > 0 || (a.outstandingAmount && a.outstandingAmount > 0) ||
      a.writtenOffStatus || a.suitFiled
    )
  );
  const cappedAccounts = [
    ...activeAccounts,
    ...significantClosed.slice(0, Math.max(0, 40 - activeAccounts.length)),
  ];

  // Raw summary for totals
  const rawSummary = caisAccount.CAIS_Summary?.Total_Outstanding_Balance ?? null;
  const summary = computeSummary(allAccounts, rawSummary);

  // Enquiries
  const caps = profile.CAPS ?? profile.CAPS_Application_Enquiry_Details;
  let rawEnquiries: any[] = caps?.CAPS_Application_Enquiry_Details ?? [];
  if (!Array.isArray(rawEnquiries)) rawEnquiries = rawEnquiries ? [rawEnquiries] : [];

  const enquiries = rawEnquiries.slice(0, 20).map((e: any) => ({
    reason: e.CAPS_Enquiry_Reason || e.EnquiryReason || e.Reason || 'Unknown',
    amount: e.CAPS_Loan_Amount > 0 ? e.CAPS_Loan_Amount : null,
  }));

  return { creditScore, bureau, reportDate, summary, accounts: cappedAccounts, enquiries };
}

// ── Mobile → leadRefId index from lead-complete.csv ──────────────────────────

function normalizePhone(phone: string): string {
  let p = String(phone).replace(/[\s\-+]/g, '');
  if (p.startsWith('91') && p.length === 12) p = p.slice(2);
  return p;
}

function loadMobileIndex(csvPath: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(csvPath)) {
    console.warn(`  ⚠ lead-complete.csv not found at ${csvPath} — will key by _id.$oid`);
    return index;
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) return index;

  const header = lines[0].split(',');
  const col: Record<string, number> = {};
  header.forEach((c, i) => { col[c.trim()] = i; });

  const idCol = col['_id'] ?? col['leadRefId'] ?? -1;
  const phoneCol = col['dedupeId'] ?? col['mobile'] ?? -1;

  if (idCol < 0 || phoneCol < 0) {
    console.warn(`  ⚠ Could not find _id or dedupeId columns in lead-complete.csv`);
    return index;
  }

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    const leadRefId = fields[idCol]?.trim();
    const phone = fields[phoneCol]?.trim();
    if (!leadRefId || !phone) continue;
    const normalized = normalizePhone(phone);
    if (normalized.length >= 10) index.set(normalized, leadRefId);
  }

  console.log(`  ✓ Loaded ${index.size} mobile → leadRefId mappings from lead-complete.csv`);
  return index;
}

// ── Main streaming processor ─────────────────────────────────────────────────

async function processFile(): Promise<void> {
  const absInput  = path.resolve(inputFile);
  const absOutput = path.resolve(outputFile);

  if (!fs.existsSync(absInput)) {
    console.error(`Input file not found: ${absInput}`);
    process.exit(1);
  }

  const stats = fs.statSync(absInput);
  const fileSizeGB = (stats.size / 1024 / 1024 / 1024).toFixed(1);
  const csvPath = path.join(path.dirname(absOutput), 'lead-complete.csv');

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  FREED Credit Report Extraction (CIBIL format)       ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`  Input:  ${absInput} (${fileSizeGB} GB)`);
  console.log(`  Output: ${absOutput}`);
  if (maxRecords) console.log(`  Max records: ${maxRecords}`);
  console.log();

  // Build mobile → leadRefId lookup from lead-complete.csv
  const mobileIndex = loadMobileIndex(csvPath);

  // Load whitelist of known leadRefIds from users.json (optional but recommended)
  // Without a whitelist the full dump is extracted (can be very large for 70GB files)
  let whitelist: Set<string> | null = null;
  const absFilter = filterUsersJson ? path.resolve(filterUsersJson) : null;
  if (absFilter && fs.existsSync(absFilter)) {
    try {
      const usersData = JSON.parse(fs.readFileSync(absFilter, 'utf-8'));
      const userList: { leadRefId: string }[] = usersData.users ?? usersData;
      whitelist = new Set(userList.map((u: any) => u.leadRefId).filter(Boolean));
      console.log(`  ✓ Whitelist loaded: ${whitelist.size} users from ${path.basename(absFilter)}`);
    } catch (e: any) {
      console.warn(`  ⚠ Could not load filter users.json: ${e.message}`);
    }
  } else {
    console.log(`  ⚠ No whitelist file — extracting ALL users (output may be large)`);
  }
  console.log();

  const results: Record<string, EnrichedCreditReport> = {};
  let linesRead = 0;
  let processed = 0;
  let noId = 0;
  let noReport = 0;
  let errors = 0;
  const startTime = Date.now();

  const fileStream = fs.createReadStream(absInput);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[' || trimmed === ']' || trimmed === ',') continue;

    // Strip trailing comma if the file is a JSON array format
    const jsonStr = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;

    linesRead++;
    if (maxRecords && processed >= maxRecords) break;

    try {
      const rawDoc = JSON.parse(jsonStr);
      const doc = unwrap(rawDoc);

      // Find leadRefId via mobile number
      const mobile = normalizePhone(doc.mobile || '');
      let userId: string | null = null;

      if (mobile.length >= 10 && mobileIndex.size > 0) {
        userId = mobileIndex.get(mobile) || null;
      }

      // Fallback: use _id if no mobile match (still useful for later cross-ref)
      if (!userId) {
        const oid = rawDoc._id?.$oid || rawDoc._id;
        if (oid) userId = String(oid);
      }

      if (!userId) {
        noId++;
        continue;
      }

      // Skip users not in whitelist (avoids building a multi-GB output for large dumps)
      if (whitelist && !whitelist.has(userId)) continue;

      const report = extractReport(doc);
      if (!report) {
        noReport++;
        continue;
      }

      results[userId] = report;
      processed++;

      if (linesRead % 50000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(linesRead / ((Date.now() - startTime) / 1000));
        const whitelistInfo = whitelist ? ` | found ${processed}/${whitelist.size} target users` : '';
        console.log(`  ✓ ${linesRead} lines | ${rate}/s | ${elapsed}s${whitelistInfo}`);
      }
    } catch (e: any) {
      errors++;
      if (errors <= 5) {
        console.warn(`  ✗ Parse error on line ${linesRead}: ${e.message?.slice(0, 80)}`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const outputSize = JSON.stringify(results).length;
  const outputMB = (outputSize / 1024 / 1024).toFixed(1);

  console.log(`\n  ═══════════════════════════════════════════════════`);
  console.log(`  ✓ Done in ${elapsed}s`);
  console.log(`  ✓ Lines read: ${linesRead}`);
  console.log(`  ✓ Extracted: ${processed} users`);
  if (whitelist) {
    const missing = [...whitelist].filter(id => !results[id]);
    console.log(`  ✓ Whitelist coverage: ${processed}/${whitelist.size} target users found`);
    if (missing.length > 0 && missing.length <= 20) {
      console.log(`  ✗ Missing leadRefIds: ${missing.join(', ')}`);
    }
  }
  console.log(`  ✗ No user ID match: ${noId}`);
  console.log(`  ✗ No report data: ${noReport}`);
  console.log(`  ✗ Parse errors: ${errors}`);
  console.log(`  📦 Output size: ${outputMB} MB`);

  // Ensure output dir exists
  const outputDir = path.dirname(absOutput);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(absOutput, JSON.stringify(results, null, 0));
  console.log(`  💾 Written to: ${absOutput}`);

  // Sample output
  const keys = Object.keys(results);
  if (keys.length > 0) {
    const sample = results[keys[0]];
    console.log(`\n  📋 Sample (${keys[0]}):`);
    console.log(`     Score: ${sample.creditScore} | Active: ${sample.summary.activeCount} | Closed: ${sample.summary.closedCount}`);
    console.log(`     Outstanding: ₹${sample.summary.totalOutstanding?.toLocaleString('en-IN')}`);
    console.log(`     Delinquent accounts: ${sample.summary.delinquentCount}`);
    console.log(`     Accounts extracted: ${sample.accounts.length}`);
    if (sample.summary.largestDebt) {
      console.log(`     Largest debt: ${sample.summary.largestDebt.lender} — ₹${sample.summary.largestDebt.amount?.toLocaleString('en-IN')}`);
    }
    if (sample.summary.worstDPDAccount) {
      console.log(`     Worst DPD: ${sample.summary.worstDPDAccount.lender} — ${sample.summary.worstDPDAccount.maxDPD} days`);
    }
  }
}

processFile().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
