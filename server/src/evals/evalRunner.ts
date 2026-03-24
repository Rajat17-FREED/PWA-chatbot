/**
 * Eval Runner — Executes golden dataset test cases through the chat pipeline
 * and collects both code-based and LLM-judge eval results.
 *
 * Can run against a live server via HTTP or be imported as a library.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AdvisorContext,
  ChatResponse,
  ResponseGroundingContext,
  Segment,
  ChatMessage,
} from '../types';

import { runCodeEvals, EvalResult, CodeEvalInput } from './codeEvals';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TestCaseTurn {
  userMessage: string;
  intentTag?: string;
  messageCount?: number;
}

export interface TestCase {
  id: string;
  user: string;           // leadRefId
  userName: string;
  segment: Segment;
  turns: TestCaseTurn[];
  expectedBehaviors: string[];
}

export interface TurnResult {
  turnIndex: number;
  userMessage: string;
  intentTag?: string;
  response: ChatResponse | null;
  advisorContext: AdvisorContext | null;
  grounding: ResponseGroundingContext | null;
  codeEvals: EvalResult[];
  error?: string;
}

export interface TestCaseResult {
  caseId: string;
  userName: string;
  segment: Segment;
  expectedBehaviors: string[];
  turns: TurnResult[];
  allPassed: boolean;
  failedEvals: string[];
  timestamp: string;
}

// ── Dataset Loading ──────────────────────────────────────────────────────────

const DATASET_PATH = path.join(__dirname, 'golden-dataset.json');

export function loadGoldenDataset(): TestCase[] {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`Golden dataset not found at ${DATASET_PATH}`);
  }
  return JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8')) as TestCase[];
}

export function saveGoldenDataset(dataset: TestCase[]): void {
  fs.writeFileSync(DATASET_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf-8');
}

// ── HTTP-Based Runner (calls live server) ────────────────────────────────────

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export async function runSingleCaseViaHttp(
  testCase: TestCase,
  serverUrl: string = DEFAULT_SERVER_URL,
): Promise<TestCaseResult> {
  const turnResults: TurnResult[] = [];
  const history: ChatMessage[] = [];

  for (let i = 0; i < testCase.turns.length; i++) {
    const turn = testCase.turns[i];
    const messageCount = turn.messageCount ?? (i + 1);

    try {
      const chatRes = await fetch(`${serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: turn.userMessage,
          leadRefId: testCase.user,
          history,
          messageCount,
          intentTag: turn.intentTag,
        }),
      });

      if (!chatRes.ok) {
        turnResults.push({
          turnIndex: i,
          userMessage: turn.userMessage,
          intentTag: turn.intentTag,
          response: null,
          advisorContext: null,
          grounding: null,
          codeEvals: [],
          error: `HTTP ${chatRes.status}: ${await chatRes.text()}`,
        });
        continue;
      }

      const response = await chatRes.json() as ChatResponse;

      // We don't have direct access to advisorContext/grounding when using HTTP
      // Run code evals with what we have
      const evalInput: CodeEvalInput = {
        response,
        advisorContext: null,
        grounding: null,
        segment: testCase.segment,
        userMessage: turn.userMessage,
        userName: testCase.userName.split(' ')[0], // first name
        messageCount,
        intentTag: turn.intentTag,
      };

      const codeEvalResults = runCodeEvals(evalInput);

      turnResults.push({
        turnIndex: i,
        userMessage: turn.userMessage,
        intentTag: turn.intentTag,
        response,
        advisorContext: null,
        grounding: null,
        codeEvals: codeEvalResults,
      });

      // Append to history for multi-turn
      history.push({ role: 'user', content: turn.userMessage });
      if (response.reply) {
        history.push({ role: 'assistant', content: response.reply });
      }
    } catch (err) {
      turnResults.push({
        turnIndex: i,
        userMessage: turn.userMessage,
        intentTag: turn.intentTag,
        response: null,
        advisorContext: null,
        grounding: null,
        codeEvals: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allEvals = turnResults.flatMap(t => t.codeEvals);
  const failedEvals = allEvals.filter(e => !e.passed).map(e => e.evalName);

  return {
    caseId: testCase.id,
    userName: testCase.userName,
    segment: testCase.segment,
    expectedBehaviors: testCase.expectedBehaviors,
    turns: turnResults,
    allPassed: failedEvals.length === 0 && turnResults.every(t => !t.error),
    failedEvals,
    timestamp: new Date().toISOString(),
  };
}

export async function runAllCasesViaHttp(
  serverUrl: string = DEFAULT_SERVER_URL,
  caseIds?: string[],
): Promise<TestCaseResult[]> {
  const dataset = loadGoldenDataset();
  const cases = caseIds
    ? dataset.filter(tc => caseIds.includes(tc.id))
    : dataset;

  const results: TestCaseResult[] = [];

  for (const testCase of cases) {
    console.log(`  Running: ${testCase.id} (${testCase.userName} / ${testCase.segment})`);
    const result = await runSingleCaseViaHttp(testCase, serverUrl);
    results.push(result);

    // Brief status
    const status = result.allPassed ? '✅' : '❌';
    const failInfo = result.failedEvals.length > 0
      ? ` [${result.failedEvals.join(', ')}]`
      : '';
    console.log(`  ${status} ${testCase.id}${failInfo}`);
  }

  return results;
}

// ── Results Storage ──────────────────────────────────────────────────────────

const RESULTS_DIR = path.join(__dirname, 'results');

export function ensureResultsDir(): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

export function saveResults(results: TestCaseResult[], prefix: string = 'eval'): string {
  ensureResultsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf-8');
  return filepath;
}

export function listResultFiles(): string[] {
  ensureResultsDir();
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('report-'))
    .sort()
    .reverse();
}

export function loadResults(filename: string): TestCaseResult[] {
  const filepath = path.join(RESULTS_DIR, filename);
  if (!fs.existsSync(filepath)) throw new Error(`Results file not found: ${filepath}`);
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}
