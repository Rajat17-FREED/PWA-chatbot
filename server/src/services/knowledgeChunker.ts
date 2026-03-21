/**
 * Knowledge Chunker — PDF parsing and text chunking for the RAG pipeline.
 *
 * Parses PDF files to plain text, then splits into overlapping passages
 * (~400 tokens each) suitable for embedding. Chunks are tagged with
 * sectionHints for both company KB (FREED programs) and general KB
 * (finance domain topics) to support segment/intent-aware boost in retrieval.
 *
 * Table-aware: detects tabular data from PDF extraction and keeps table
 * blocks together as atomic chunks to preserve structured information.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const pdfParse = require('pdf-parse');
import fs from 'fs';

export interface TextChunk {
  text: string;
  source: 'company' | 'general';
  sectionHint?: string;
}

// ── Section hint detection for company KB ────────────────────────────────────
// Patterns ordered from most specific to least specific
const COMPANY_HINT_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /FREED\s*Shield|harassment|recovery\s*agent|collection\s*call|stop\s*call/i, hint: 'product_shield' },
  { pattern: /DRP|Debt\s*Resolution|settlement|negotiate.*lender|lender.*negotiat|delinquent.*account/i, hint: 'program_drp' },
  { pattern: /DCP|Debt\s*Consolidat|single\s*EMI|combine.*loan|multiple.*EMI/i, hint: 'program_dcp' },
  { pattern: /DEP|Debt\s*Eliminat|pay\s*off\s*faster|accelerated\s*repayment/i, hint: 'program_dep' },
  { pattern: /Goal\s*Tracker|score\s*goal|target\s*score|track.*progress/i, hint: 'product_goal_tracker' },
  { pattern: /Credit\s*(Score|Report|Insight|Health|Monitor)|CIBIL|score\s*improvement/i, hint: 'product_credit_insights' },
  { pattern: /Customer\s*Segment|eligibility|NTC|New\s*to\s*Credit|DRP\s*Eligible|DCP\s*Eligible/i, hint: 'customer_segments' },
];

// ── Section hint detection for general KB ────────────────────────────────────
const GENERAL_HINT_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /interest\s*rate.*range|flat\s*rate|reducing\s*balance|APR|annual\s*percentage|lending\s*rate|rate.*loan\s*type/i, hint: 'general_interest_rates' },
  { pattern: /FOIR|fixed\s*obligation.*income|lender.*evaluat|borrower.*evaluat|loan\s*approval|eligibility\s*criteria/i, hint: 'general_loan_eligibility' },
  { pattern: /credit\s*bureau|TransUnion|Experian|Equifax|CRIF|CIBIL.*score|score\s*range|bureau.*comparison/i, hint: 'general_credit_bureaus' },
  { pattern: /credit\s*score.*affect|score.*factor|payment\s*history|credit\s*utiliz|enquir|score.*change|score.*impact/i, hint: 'general_credit_score' },
  { pattern: /home\s*loan|auto\s*loan|vehicle\s*loan|gold\s*loan|education\s*loan|loan\s*against\s*property|LAP\b|loan\s*against\s*FD/i, hint: 'general_secured_loans' },
  { pattern: /personal\s*loan|credit\s*card|BNPL|buy\s*now\s*pay\s*later|unsecured\s*loan|app.*loan|instant\s*loan/i, hint: 'general_unsecured_loans' },
  { pattern: /\bEMI\b|equated\s*monthly|principal\s*component|interest\s*component|prepay|foreclos/i, hint: 'general_emi_repayment' },
  { pattern: /minimum\s*due|credit\s*card\s*interest|revolving|billing\s*cycle|interest.*free\s*period/i, hint: 'general_credit_card_debt' },
  { pattern: /delinquen|DPD|days\s*past\s*due|NPA|non.*performing|SMA|default|missed.*payment|overdue/i, hint: 'general_delinquency' },
  { pattern: /\bNBFC|non.*banking|Bajaj\s*Finance|Muthoot|Shriram|Tata\s*Capital/i, hint: 'general_nbfc' },
  { pattern: /digital\s*(lending|platform)|KreditBee|MoneyView|Fibe|Navi\b|app.*based.*loan/i, hint: 'general_digital_lending' },
  { pattern: /\bbank\b.*lend|\bSBI\b|\bHDFC\b.*bank|\bICICI\b.*bank|top.*bank|bank.*India/i, hint: 'general_banks' },
  { pattern: /secured\s*vs\s*unsecured|secured.*unsecured.*comparison|collateral.*required/i, hint: 'general_loan_comparison' },
  { pattern: /fixed\s*vs\s*floating|fixed.*interest.*floating|EBLR|repo\s*rate|benchmark\s*rate/i, hint: 'general_rate_types' },
];

function detectSectionHint(text: string, source: 'company' | 'general'): string | undefined {
  const patterns = source === 'company' ? COMPANY_HINT_PATTERNS : GENERAL_HINT_PATTERNS;
  for (const { pattern, hint } of patterns) {
    if (pattern.test(text)) return hint;
  }
  return undefined;
}

// ── Table Detection ──────────────────────────────────────────────────────────

/**
 * Detect whether a block of text lines contains tabular data from PDF extraction.
 *
 * PDF tables extracted by pdf-parse appear as lines where columns are separated
 * by 2+ consecutive spaces. We detect tables by checking if multiple consecutive
 * lines share this multi-space column pattern.
 */
function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 10) return false;
  // A table line typically has 2+ groups of content separated by 2+ spaces
  // e.g. "Home Loan   8.25%–10.5%   8.5%–13%   N/A"
  const columnGaps = trimmed.match(/\S\s{2,}\S/g);
  return (columnGaps !== null && columnGaps.length >= 1);
}

/**
 * Pre-process text to identify and mark table blocks so they aren't split.
 *
 * Scans for consecutive lines that look like table rows (multi-space column
 * separators), groups them with their preceding header/title line, and wraps
 * them as atomic blocks. Also captures the line immediately before the first
 * table row as context (typically the table title).
 *
 * Returns an array of text segments — some are regular paragraphs, some are
 * table blocks marked with a [TABLE] prefix for the chunker to handle.
 */
function extractTableBlocks(text: string): string[] {
  const lines = text.split('\n');
  const segments: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check if this line starts a table block
    if (isTableLine(lines[i])) {
      // Look back for a title/header line (non-table, non-empty)
      let tableBlock = '';
      // Grab the preceding non-empty line as context if it's a title
      if (segments.length > 0) {
        const lastSeg = segments[segments.length - 1].trim();
        // If the previous segment ends with a short line (likely a table title),
        // extract it and prepend to the table
        const lastLines = lastSeg.split('\n');
        const lastLine = lastLines[lastLines.length - 1].trim();
        if (lastLine.length > 0 && lastLine.length < 200 && !isTableLine(lastLine)) {
          // Remove the title line from previous segment and prepend to table
          if (lastLines.length > 1) {
            segments[segments.length - 1] = lastLines.slice(0, -1).join('\n');
          } else {
            segments.pop();
          }
          tableBlock = lastLine + '\n';
        }
      }

      // Collect consecutive table lines
      while (i < lines.length && (isTableLine(lines[i]) || lines[i].trim().length === 0)) {
        // Allow blank lines within tables (row separators)
        if (lines[i].trim().length === 0) {
          // Only include blank line if there are more table lines after
          let hasMore = false;
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (isTableLine(lines[j])) { hasMore = true; break; }
          }
          if (!hasMore) break;
        }
        tableBlock += lines[i] + '\n';
        i++;
      }

      if (tableBlock.trim().length > 30) {
        segments.push('[TABLE]\n' + tableBlock.trim());
      }
    } else {
      // Regular line — accumulate into current segment
      const line = lines[i];
      if (segments.length > 0 && !segments[segments.length - 1].startsWith('[TABLE]')) {
        segments[segments.length - 1] += '\n' + line;
      } else {
        segments.push(line);
      }
      i++;
    }
  }

  return segments.map(s => s.trim()).filter(s => s.length > 0);
}

// ── PDF Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a PDF file and return its extracted plain text.
 */
export async function parsePdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

// ── Text Chunking ─────────────────────────────────────────────────────────────

/**
 * Split a large text into overlapping passages suitable for embedding.
 *
 * Strategy:
 * 1. Pre-scan for table blocks and mark them as atomic units
 * 2. Split remaining text on double-newlines (paragraph boundaries)
 * 3. Accumulate paragraphs until maxChars is reached, then flush
 * 4. For paragraphs that exceed maxChars alone, split on sentence boundaries
 * 5. Table blocks are kept intact — they may slightly exceed maxChars
 * 6. Each chunk carries overlap from the tail of the previous chunk
 * 7. Both company and general chunks are tagged with sectionHints
 *
 * @param text        Raw text to chunk
 * @param source      'company' (FREED programs) or 'general' (finance domain)
 * @param maxChars    Target max chars per chunk (~400 tokens at 4 chars/token)
 * @param overlapChars Chars of tail from previous chunk prepended to next chunk
 */
export function chunkText(
  text: string,
  source: 'company' | 'general',
  maxChars = 1600,
  overlapChars = 150
): TextChunk[] {
  const chunks: TextChunk[] = [];

  // Clean: collapse excessive blank lines, trim whitespace
  const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();

  // Extract table blocks as atomic units
  const segments = extractTableBlocks(cleaned);

  let prevTail = '';

  function flushChunk(chunkText: string): void {
    const t = chunkText.trim();
    if (t.length < 30) return;
    chunks.push({
      text: t,
      source,
      sectionHint: detectSectionHint(t, source),
    });
    prevTail = t.slice(-overlapChars);
  }

  let currentChunk = '';

  for (const segment of segments) {
    // ── Table block: emit as a single atomic chunk ──────────────────────
    if (segment.startsWith('[TABLE]')) {
      // Flush any accumulated text first
      if (currentChunk.trim()) {
        flushChunk(currentChunk);
        currentChunk = '';
      }

      const tableContent = segment.slice('[TABLE]\n'.length).trim();

      // If table is small enough, try to merge with surrounding context
      if (tableContent.length <= maxChars * 0.6 && prevTail) {
        // Prepend overlap for continuity
        flushChunk(prevTail + '\n\n' + tableContent);
      } else if (tableContent.length <= maxChars * 1.5) {
        // Table fits in one chunk (allow 50% overflow for tables)
        flushChunk(tableContent);
      } else {
        // Very large table: split at row boundaries, preserving the header row
        const tableLines = tableContent.split('\n');
        const headerLine = tableLines[0]; // Usually the column headers
        let tableChunk = headerLine;

        for (let i = 1; i < tableLines.length; i++) {
          const candidate = tableChunk + '\n' + tableLines[i];
          if (candidate.length > maxChars && tableChunk.length > 30) {
            flushChunk(tableChunk);
            // Repeat header row in next chunk for context
            tableChunk = headerLine + '\n' + tableLines[i];
          } else {
            tableChunk = candidate;
          }
        }
        if (tableChunk.trim().length > 30) {
          flushChunk(tableChunk);
        }
      }
      continue;
    }

    // ── Regular text: split on paragraph boundaries ────────────────────
    const paragraphs = segment
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 30);

    for (const para of paragraphs) {
      // Large paragraph: split on sentence boundaries
      if (para.length > maxChars) {
        if (currentChunk.trim()) {
          flushChunk(currentChunk);
          currentChunk = '';
        }

        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentChunk = prevTail ? prevTail + '\n' : '';

        for (const sentence of sentences) {
          if ((sentChunk + sentence).length > maxChars && sentChunk.trim().length > 30) {
            flushChunk(sentChunk);
            sentChunk = prevTail + ' ' + sentence;
          } else {
            sentChunk += (sentChunk.endsWith('\n') || sentChunk === '' ? '' : ' ') + sentence;
          }
        }

        if (sentChunk.trim()) {
          currentChunk = sentChunk.trim();
        }
        continue;
      }

      // Normal paragraph: accumulate
      const withOverlap = currentChunk
        ? currentChunk + '\n\n' + para
        : prevTail
          ? prevTail + '\n\n' + para
          : para;

      if (withOverlap.length > maxChars && currentChunk) {
        flushChunk(currentChunk);
        currentChunk = prevTail + '\n\n' + para;
      } else {
        currentChunk = withOverlap;
      }
    }
  }

  // Flush the last chunk
  if (currentChunk.trim()) {
    flushChunk(currentChunk);
  }

  return chunks;
}
