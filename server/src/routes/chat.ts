import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { lookupByName, getUserByLeadRefId, getStartersForSegment, getAllLeadRefIds } from '../services/userLookup';
import { getChatResponse } from '../services/claude';
import { buildSystemPrompt, buildGeneralSystemPrompt } from '../prompts/system';
import { loadCreditorData, getCreditorAccounts } from '../services/creditorLookup';
import { loadCreditInsights, getCreditInsights } from '../services/creditInsightsLookup';
import { loadPhoneLookup, getPhoneForUser } from '../services/phoneLookup';
import { IdentifyRequest, ChatRequest, Segment } from '../types';

const router = Router();

// Load knowledge base once
let knowledgeBase = '';
try {
  knowledgeBase = fs.readFileSync(
    path.join(__dirname, '..', 'data', 'knowledge-base.txt'),
    'utf-8'
  );
  console.log(`Knowledge base loaded: ${knowledgeBase.length} characters`);
} catch (err) {
  console.error('Failed to load knowledge base:', err);
}

/**
 * Initialize all dataset lookups — called from index.ts at startup.
 */
export function initCreditorData(): void {
  const validIds = getAllLeadRefIds();
  loadCreditorData(validIds);
  loadCreditInsights(validIds);
  loadPhoneLookup(validIds);
}

// POST /api/identify - Look up user by name or phone number
router.post('/identify', (req: Request, res: Response) => {
  const { name } = req.body as IdentifyRequest;

  if (!name || !name.trim()) {
    res.json({
      status: 'not_found',
      message: 'Please enter your registered name or 10-digit mobile number to get started.',
    });
    return;
  }

  const result = lookupByName(name);
  res.json(result);
});

// POST /api/select - Select a specific user from disambiguation
router.post('/select', (req: Request, res: Response) => {
  const { leadRefId } = req.body as { leadRefId: string };

  if (!leadRefId) {
    res.status(400).json({ error: 'leadRefId is required' });
    return;
  }

  const user = getUserByLeadRefId(leadRefId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    status: 'found',
    user,
    starters: getStartersForSegment(user.segment),
    message: `Welcome, ${user.firstName}!`,
  });
});

// GET /api/starters/:segment - Get conversation starters for a segment
router.get('/starters/:segment', (req: Request, res: Response) => {
  const segment = req.params.segment as Segment;
  const starters = getStartersForSegment(segment);
  res.json({ starters });
});

// POST /api/chat - Send a message and get LLM response with enriched user context
router.post('/chat', async (req: Request, res: Response) => {
  const { message, leadRefId, history, messageCount } = req.body as ChatRequest;

  if (!message || !message.trim()) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    let systemPrompt: string;

    if (leadRefId) {
      const user = getUserByLeadRefId(leadRefId);
      if (user) {
        const creditorAccounts = getCreditorAccounts(leadRefId);
        const creditInsights = getCreditInsights(leadRefId);
        const phoneNumber = getPhoneForUser(leadRefId);
        const totalMessages = typeof messageCount === 'number' ? messageCount : (Array.isArray(history) ? history.length : 0);
        systemPrompt = buildSystemPrompt(user, knowledgeBase, creditorAccounts, creditInsights, phoneNumber, totalMessages);
      } else {
        systemPrompt = buildGeneralSystemPrompt(knowledgeBase);
      }
    } else {
      systemPrompt = buildGeneralSystemPrompt(knowledgeBase);
    }

    const chatHistory = Array.isArray(history) ? history.slice(-20) : [];
    const totalMessages = typeof messageCount === 'number' ? messageCount : (Array.isArray(history) ? history.length : 0);
    const response = await getChatResponse(systemPrompt, chatHistory, message, totalMessages);
    res.json(response);
  } catch (err: any) {
    console.error('Chat error:', err?.message || err);

    if (err?.status === 429) {
      res.status(429).json({
        reply: "I'm a bit busy right now. Could you try again in a moment?",
      });
      return;
    }

    res.status(500).json({
      reply: "I'm having trouble connecting right now. Please try again.",
    });
  }
});

export default router;
