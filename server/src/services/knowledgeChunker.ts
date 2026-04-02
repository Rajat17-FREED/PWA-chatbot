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
  { pattern: /interest\s*rate.*range|flat\s*rate|reducing\s*balance|APR|annual\s*percentage|lending\s*rate|rate.*loan\s*type|interest.*p\.a\./i, hint: 'general_interest_rates' },
  { pattern: /FOIR|fixed\s*obligation.*income|lender.*evaluat|borrower.*evaluat|loan\s*approval|eligibility\s*criteria|loan.*approv|risk.*assess/i, hint: 'general_loan_eligibility' },
  { pattern: /credit\s*bureau|TransUnion|Experian|Equifax|CRIF|CIBIL.*score|score\s*range|bureau.*comparison|credit\s*report\s*(contain|vs\b)|report.*bureau/i, hint: 'general_credit_bureaus' },
  { pattern: /credit\s*score.*affect|score.*factor|payment\s*history|credit\s*utiliz|enquir|score.*change|score.*impact|weightage|credit\s*age|credit\s*mix/i, hint: 'general_credit_score' },
  { pattern: /home\s*loan|auto\s*loan|vehicle\s*loan|gold\s*loan|education\s*loan|loan\s*against\s*property|LAP\b|loan\s*against\s*FD|secured\s*loan|collateral/i, hint: 'general_secured_loans' },
  { pattern: /personal\s*loan|credit\s*card|BNPL|buy\s*now\s*pay\s*later|unsecured\s*loan|app.*loan|instant\s*loan|consumer\s*durable/i, hint: 'general_unsecured_loans' },
  { pattern: /\bEMI\b|equated\s*monthly|principal\s*component|interest\s*component|prepay|foreclos|amortiz|loan\s*tenure/i, hint: 'general_emi_repayment' },
  { pattern: /minimum\s*due|credit\s*card\s*interest|revolving|billing\s*cycle|interest.*free\s*period|credit\s*card\s*debt|statement\s*date/i, hint: 'general_credit_card_debt' },
  { pattern: /delinquen|DPD|days\s*past\s*due|NPA|non.*performing|SMA|default|missed.*payment|overdue|SARFAESI|recovery\s*process|collection/i, hint: 'general_delinquency' },
  { pattern: /\bNBFC|non.*banking|Bajaj\s*Finance|Muthoot|Shriram|Tata\s*Capital|HDB\s*Financial|Mahindra\s*Finance/i, hint: 'general_nbfc' },
  { pattern: /digital\s*(lending|platform)|KreditBee|MoneyView|Fibe|Navi\b|app.*based.*loan|PhonePe.*lend|CASHe|PaySense|fintech/i, hint: 'general_digital_lending' },
  { pattern: /\bbank\b.*lend|\bSBI\b|\bHDFC\b.*bank|\bICICI\b.*bank|top.*bank|bank.*India|Axis\s*Bank|Bank\s*of\s*Baroda|Canara\s*Bank|PNB\b|Kotak/i, hint: 'general_banks' },
  { pattern: /secured\s*vs\s*unsecured|secured.*unsecured.*comparison|collateral.*required|bank.*vs.*NBFC|banks.*NBFCs.*digital/i, hint: 'general_loan_comparison' },
  { pattern: /fixed\s*vs\s*floating|fixed.*interest.*floating|EBLR|repo\s*rate|benchmark\s*rate|rate\s*type/i, hint: 'general_rate_types' },
  { pattern: /RBI.*guideline|fair\s*practices|ombudsman|consumer\s*right|borrower.*right|complain|grievance/i, hint: 'general_delinquency' },
  { pattern: /snowball|avalanche|debt.*repay.*strateg|repayment\s*plan|debt.*free|pay.*off.*debt/i, hint: 'general_emi_repayment' },
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
 * Detect whether a line is part of tabular data from PDF extraction.
 *
 * pdf-parse outputs tables with irregular spacing — multi-space gaps between
 * columns, and multi-line cells where content wraps. We use two heuristics:
 * 1. Column gap detection (2+ spaces between content blocks)
 * 2. Continuation line detection (starts with spaces, follows a table line)
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
 * Detect if a line is a continuation of a multi-line table cell.
 * pdf-parse wraps long cell content to the next line, often with leading spaces
 * or indentation matching the column position.
 */
function isTableContinuation(line: string, prevWasTable: boolean): boolean {
  if (!prevWasTable) return false;
  const trimmed = line.trim();
  if (trimmed.length < 5 || trimmed.length > 200) return false;
  // Continuation lines often: start with spaces, don't start with bullets/numbers/headings
  const startsWithSpace = line.length > 0 && /^\s{2,}/.test(line);
  const looksLikeNewSection = /^(\d+\.\s|#{1,3}\s|Section\s|•\s|\*\s)/.test(trimmed);
  if (looksLikeNewSection) return false;
  // If the line starts with significant indentation and doesn't look like a new paragraph, it's continuation
  if (startsWithSpace) return true;
  // Also catch lines that are short and don't end with a period (truncated cell text)
  if (trimmed.length < 80 && !trimmed.endsWith('.') && !trimmed.endsWith(':')) return true;
  return false;
}

// ── Markdown table normalization ─────────────────────────────────────────────

/**
 * Known table patterns in the knowledge base PDFs.
 * Each pattern matches a table header line and defines the expected columns.
 * When matched, we parse subsequent lines into a clean markdown table.
 */
const TABLE_HEADER_PATTERNS: Array<{
  pattern: RegExp;
  columns: string[];
}> = [
  { pattern: /^Score Range\s+Category\s+What It Means$/i, columns: ['Score Range', 'Category', 'What It Means'] },
  { pattern: /^Loan Type\s+Interest Rate Range$/i, columns: ['Loan Type', 'Interest Rate Range'] },
  { pattern: /^Bureau\s+Score\s*Range\s+Primarily Used By\s+Strength$/i, columns: ['Bureau', 'Score Range', 'Primarily Used By', 'Strength'] },
  { pattern: /^#\s+Bank\s+Type\s+Known For$/i, columns: ['#', 'Bank', 'Type', 'Known For'] },
  { pattern: /^#\s+NBFC\s+Known For$/i, columns: ['#', 'NBFC', 'Known For'] },
  { pattern: /^#\s+Platform\s+Known For$/i, columns: ['#', 'Platform', 'Known For'] },
  { pattern: /^Parameter\s+(Details|Banks|New Vehicle)/i, columns: [] }, // variable columns
  { pattern: /^Borrower Profile\s+Typical Outcome$/i, columns: ['Borrower Profile', 'Typical Outcome'] },
  { pattern: /^Type\s+When It Happens\s+Impact on Score$/i, columns: ['Type', 'When It Happens', 'Impact on Score'] },
  { pattern: /^Step\s+Deadline\s+What Happens$/i, columns: ['Step', 'Deadline', 'What Happens'] },
  { pattern: /^\s*Credit Score\s+Credit Report$/i, columns: ['', 'Credit Score', 'Credit Report'] },
];

/**
 * Normalize messy pdf-parse table output into clean markdown tables.
 * Scans text for known table header patterns, collects rows (including
 * multi-line wrapped cells), and emits clean `| col1 | col2 |` markdown.
 */
function normalizeTablesInText(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // Check if this line matches a known table header
    let matched = false;
    for (const { pattern } of TABLE_HEADER_PATTERNS) {
      if (pattern.test(trimmed)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      // Found a known table header — collect lines until a clear section break.
      // For known tables, we use section-boundary detection instead of column-gap
      // heuristics, since pdf-parse table output has irregular spacing.
      const tableLines: string[] = [lines[i]];
      i++;
      let emptyLineCount = 0;

      while (i < lines.length) {
        const line = lines[i];
        const lineTrimmed = line.trim();

        // Clear section break indicators — stop collecting
        const isSectionBreak = /^\d+\.\d+(\.\d+)?\s+[A-Z]/.test(lineTrimmed) // "3.1.3 Top 10..."
          || /^Section\s+\d+/i.test(lineTrimmed)                             // "Section 4:..."
          || /^#{1,3}\s/.test(lineTrimmed)                                    // markdown headings
          || /^\(Rates?\s+are\s+indicative/i.test(lineTrimmed);               // disclaimer after rate table

        // Check if this line starts a NEW known table header
        let isNewTable = false;
        for (const { pattern } of TABLE_HEADER_PATTERNS) {
          if (pattern.test(lineTrimmed)) { isNewTable = true; break; }
        }

        if (isSectionBreak || isNewTable) break;

        if (lineTrimmed.length === 0) {
          emptyLineCount++;
          // Two consecutive blank lines = definite table end
          if (emptyLineCount >= 2) break;
          // Single blank line — check if more table-like content follows
          let hasMore = false;
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextTrimmed = lines[j].trim();
            if (nextTrimmed.length > 0) {
              // If the next non-empty line looks like a section break, stop
              if (/^\d+\.\d+/.test(nextTrimmed) || /^Section\s/i.test(nextTrimmed)) break;
              hasMore = true;
              break;
            }
          }
          if (!hasMore) break;
          i++;
          continue;
        }

        emptyLineCount = 0;

        // For known tables: if line has multi-space gaps, it's a table row
        if (isTableLine(line)) {
          tableLines.push(line);
        } else {
          // Short line without gaps: likely a wrapped cell continuation
          // Append to previous line rather than starting a new line
          if (tableLines.length > 0 && lineTrimmed.length < 120) {
            tableLines[tableLines.length - 1] += ' ' + lineTrimmed;
          } else {
            // Long non-table line after table = table is over
            break;
          }
        }
        i++;
      }

      // Emit the table as a marked block
      const cleanedTable = tableLines
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n');

      if (cleanedTable.length > 50) {
        result.push('[TABLE]\n' + cleanedTable);
      } else {
        result.push(cleanedTable);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Pre-process text to identify and mark table blocks so they aren't split.
 *
 * Now uses a two-pass approach:
 * 1. normalizeTablesInText() detects known table headers and marks blocks
 * 2. Fallback column-gap detection for tables not matched by known patterns
 *
 * Returns an array of text segments — some are regular paragraphs, some are
 * table blocks marked with a [TABLE] prefix for the chunker to handle.
 */
function extractTableBlocks(text: string): string[] {
  // Pass 1: normalize known table patterns
  const normalized = normalizeTablesInText(text);
  const lines = normalized.split('\n');
  const segments: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Already-marked table blocks from normalization pass
    if (line.trim() === '[TABLE]') {
      // Collect all subsequent non-empty lines as the table content.
      // The normalizeTablesInText pass already handled continuation merging,
      // so these lines are clean table rows. Stop at blank lines or next marker.
      let tableBlock = '';
      i++; // skip the [TABLE] marker
      while (i < lines.length) {
        const tl = lines[i];
        if (tl.trim() === '[TABLE]') break;
        // A blank line ends the table block (normalization already filtered blanks within tables)
        if (tl.trim().length === 0) break;
        tableBlock += tl + '\n';
        i++;
      }

      if (tableBlock.trim().length > 30) {
        // Grab preceding title from last segment if available
        let title = '';
        if (segments.length > 0 && !segments[segments.length - 1].startsWith('[TABLE]')) {
          const lastSeg = segments[segments.length - 1].trim();
          const lastLines = lastSeg.split('\n');
          const lastLine = lastLines[lastLines.length - 1].trim();
          if (lastLine.length > 0 && lastLine.length < 200 && !isTableLine(lastLine)) {
            if (lastLines.length > 1) {
              segments[segments.length - 1] = lastLines.slice(0, -1).join('\n');
            } else {
              segments.pop();
            }
            title = lastLine + '\n';
          }
        }
        segments.push('[TABLE]\n' + title + tableBlock.trim());
      }
      continue;
    }

    // Fallback: column-gap based table detection for unmarked tables
    if (isTableLine(line)) {
      let tableBlock = '';
      if (segments.length > 0 && !segments[segments.length - 1].startsWith('[TABLE]')) {
        const lastSeg = segments[segments.length - 1].trim();
        const lastLines = lastSeg.split('\n');
        const lastLine = lastLines[lastLines.length - 1].trim();
        if (lastLine.length > 0 && lastLine.length < 200 && !isTableLine(lastLine)) {
          if (lastLines.length > 1) {
            segments[segments.length - 1] = lastLines.slice(0, -1).join('\n');
          } else {
            segments.pop();
          }
          tableBlock = lastLine + '\n';
        }
      }

      while (i < lines.length && (isTableLine(lines[i]) || isTableContinuation(lines[i], true) || lines[i].trim().length === 0)) {
        if (lines[i].trim().length === 0) {
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
