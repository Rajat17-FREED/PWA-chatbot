/**
 * Knowledge Chunker — PDF parsing and text chunking for the RAG pipeline.
 *
 * Parses PDF files to plain text, then splits into overlapping passages
 * (~400 tokens each) suitable for embedding. For company KB chunks, detects
 * the FREED program/product section to support segment-aware boost in retrieval.
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
const SECTION_HINT_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /FREED\s*Shield|harassment|recovery\s*agent|collection\s*call|stop\s*call/i, hint: 'product_shield' },
  { pattern: /DRP|Debt\s*Resolution|settlement|negotiate.*lender|lender.*negotiat|delinquent.*account/i, hint: 'program_drp' },
  { pattern: /DCP|Debt\s*Consolidat|single\s*EMI|combine.*loan|multiple.*EMI/i, hint: 'program_dcp' },
  { pattern: /DEP|Debt\s*Eliminat|pay\s*off\s*faster|accelerated\s*repayment/i, hint: 'program_dep' },
  { pattern: /Goal\s*Tracker|score\s*goal|target\s*score|track.*progress/i, hint: 'product_goal_tracker' },
  { pattern: /Credit\s*(Score|Report|Insight|Health|Monitor)|CIBIL|score\s*improvement/i, hint: 'product_credit_insights' },
  { pattern: /Customer\s*Segment|eligibility|NTC|New\s*to\s*Credit|DRP\s*Eligible|DCP\s*Eligible/i, hint: 'customer_segments' },
];

function detectSectionHint(text: string): string | undefined {
  for (const { pattern, hint } of SECTION_HINT_PATTERNS) {
    if (pattern.test(text)) return hint;
  }
  return undefined;
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
 * 1. Split on double-newlines (paragraph boundaries)
 * 2. Accumulate paragraphs until maxChars is reached, then flush
 * 3. For paragraphs that exceed maxChars alone, split on sentence boundaries
 * 4. Each chunk carries overlap from the tail of the previous chunk for continuity
 * 5. Company chunks are tagged with a sectionHint for segment boosting
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

  // Split into paragraphs
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 30); // skip trivially short fragments

  let currentChunk = '';
  let prevTail = '';

  function flushChunk(text: string): void {
    const t = text.trim();
    if (t.length < 30) return;
    chunks.push({
      text: t,
      source,
      sectionHint: source === 'company' ? detectSectionHint(t) : undefined,
    });
    prevTail = t.slice(-overlapChars);
  }

  for (const para of paragraphs) {
    // Large paragraph: split on sentence boundaries
    if (para.length > maxChars) {
      // Flush accumulated current chunk first
      if (currentChunk.trim()) {
        flushChunk(currentChunk);
        currentChunk = '';
      }

      // Split on sentence endings
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
      // Start new chunk with overlap + this paragraph
      currentChunk = prevTail + '\n\n' + para;
    } else {
      currentChunk = withOverlap;
    }
  }

  // Flush the last chunk
  if (currentChunk.trim()) {
    flushChunk(currentChunk);
  }

  return chunks;
}
