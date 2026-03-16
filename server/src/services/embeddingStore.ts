/**
 * Embedding Store — core RAG retrieval engine.
 *
 * At startup: parses both PDF knowledge bases, chunks the text, and embeds
 * all chunks using OpenAI text-embedding-3-small in batches. Chunks are stored
 * in-memory as { text, embedding, source, sectionHint }.
 *
 * Per query: embeds the user message (1 API call), runs cosine similarity
 * against all stored chunks, selects the top-k passages that fit within the
 * 7000-char injection budget, and applies segment/intent-based boosting to
 * guarantee that domain-relevant company KB sections are always represented.
 */

import OpenAI from 'openai';
import { chunkText, TextChunk } from './knowledgeChunker';

// Lazy init — dotenv.config() must run before this is called
let openai: OpenAI;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmbeddingChunk {
  text: string;
  embedding: number[];
  source: 'company' | 'general';
  sectionHint?: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

let store: EmbeddingChunk[] = [];
let isReady = false;

// ── Boost maps ────────────────────────────────────────────────────────────────

/**
 * Which sectionHints should always appear in results for a given user segment.
 * Prevents the retriever from returning only general finance content for users
 * who need a specific FREED program.
 */
const SEGMENT_BOOST_MAP: Record<string, string[]> = {
  DRP_Eligible:   ['program_drp', 'product_shield'],
  DRP_Ineligible: ['program_drp', 'product_credit_insights'],
  DCP_Eligible:   ['program_dcp'],
  DCP_Ineligible: ['program_dcp', 'product_credit_insights'],
  DEP:            ['program_dep'],
  NTC:            ['product_credit_insights'],
  Others:         ['product_credit_insights', 'product_goal_tracker'],
};

const INTENT_BOOST_MAP: Record<string, string[]> = {
  INTENT_HARASSMENT:        ['product_shield', 'program_drp'],
  INTENT_SCORE_IMPROVEMENT: ['product_credit_insights', 'product_goal_tracker'],
  INTENT_SCORE_DIAGNOSIS:   ['product_credit_insights'],
  INTENT_GOAL_TRACKING:     ['product_goal_tracker'],
  INTENT_LOAN_ELIGIBILITY:  ['customer_segments'],
  INTENT_DELINQUENCY_STRESS:['program_drp', 'product_shield'],
  INTENT_EMI_OPTIMISATION:  ['program_dcp', 'program_dep'],
};

// ── Math utilities ────────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Embedding helpers ─────────────────────────────────────────────────────────

/**
 * Embed a list of texts in batches of 500 (safe under OpenAI's 2048 limit).
 * Returns embeddings in the same order as the input texts.
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 500;
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    // OpenAI returns embeddings in the same order as input
    const sorted = response.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the in-memory embedding store from raw company and general KB text.
 * Called once at server startup — takes ~3–6s and costs ~$0.009 in embeddings.
 */
export async function buildEmbeddingStore(
  companyText: string,
  generalText: string
): Promise<void> {
  const startTime = Date.now();

  const companyChunks: TextChunk[] = chunkText(companyText, 'company');
  const generalChunks: TextChunk[] = chunkText(generalText, 'general');
  const allChunks = [...companyChunks, ...generalChunks];

  console.log(`[RAG] Chunked → company: ${companyChunks.length}, general: ${generalChunks.length}. Embedding...`);

  const allTexts = allChunks.map(c => c.text);
  const embeddings = await embedBatch(allTexts);

  store = allChunks.map((chunk, i) => ({
    text: chunk.text,
    embedding: embeddings[i],
    source: chunk.source,
    sectionHint: chunk.sectionHint,
  }));

  isReady = true;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[RAG] Embedding store ready: ${store.length} total chunks in ${elapsed}s`);
}

/**
 * Retrieve the most relevant passages for a user query.
 *
 * 1. Embeds userMessage (1 API call, ~50 tokens)
 * 2. Cosine similarity vs all stored chunks (~1ms for 1300 chunks)
 * 3. Greedy selection: fill charBudget with top-scoring chunks
 * 4. Segment/intent boost: if required section hints aren't covered, inject
 *    the best-scoring chunk for each missing hint
 *
 * @param userMessage  The user's raw chat message
 * @param segment      User's FREED segment (e.g. 'DRP_Eligible')
 * @param intentTag    Intent classifier result (e.g. 'INTENT_HARASSMENT')
 * @param charBudget   Max chars to inject into the prompt (default: 7000)
 */
export async function retrieveKnowledge(
  userMessage: string,
  segment?: string | null,
  intentTag?: string | null,
  charBudget = 7000
): Promise<string> {
  if (!isReady || store.length === 0) return '';

  const queryStart = Date.now();

  // Embed the user message
  const queryResponse = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: userMessage,
  });
  const queryEmbedding = queryResponse.data[0].embedding;

  // Score all chunks
  type ScoredChunk = { score: number; chunk: EmbeddingChunk };
  const scored: ScoredChunk[] = store.map(chunk => ({
    score: cosineSim(queryEmbedding, chunk.embedding),
    chunk,
  }));
  scored.sort((a, b) => b.score - a.score);

  // Determine which sectionHints need to be boosted
  const requiredHints = new Set<string>();
  if (segment && SEGMENT_BOOST_MAP[segment]) {
    for (const h of SEGMENT_BOOST_MAP[segment]) requiredHints.add(h);
  }
  if (intentTag && INTENT_BOOST_MAP[intentTag]) {
    for (const h of INTENT_BOOST_MAP[intentTag]) requiredHints.add(h);
  }

  // ── Greedy selection pass ─────────────────────────────────────────────────
  const selected: ScoredChunk[] = [];
  const coveredHints = new Set<string>();
  const selectedSet = new Set<EmbeddingChunk>();
  let totalChars = 0;

  for (const item of scored) {
    if (totalChars + item.chunk.text.length > charBudget) break;
    selected.push(item);
    selectedSet.add(item.chunk);
    totalChars += item.chunk.text.length;
    if (item.chunk.sectionHint) coveredHints.add(item.chunk.sectionHint);
  }

  // ── Boost pass: inject best-scoring chunk for each uncovered required hint ─
  for (const hint of requiredHints) {
    if (coveredHints.has(hint)) continue;

    const candidate = scored.find(
      item =>
        item.chunk.sectionHint === hint &&
        !selectedSet.has(item.chunk) &&
        totalChars + item.chunk.text.length <= charBudget
    );

    if (candidate) {
      selected.push(candidate);
      selectedSet.add(candidate.chunk);
      totalChars += candidate.chunk.text.length;
      coveredHints.add(hint);
    }
  }

  // Re-sort by similarity for coherent ordering in the prompt
  selected.sort((a, b) => b.score - a.score);

  const elapsed = Date.now() - queryStart;
  console.log(`[RAG] Retrieved ${selected.length} chunks (${totalChars} chars) in ${elapsed}ms`);

  return selected.map(item => item.chunk.text).join('\n\n---\n\n');
}

/** Returns true once buildEmbeddingStore() has completed. */
export function isEmbeddingStoreReady(): boolean {
  return isReady;
}
