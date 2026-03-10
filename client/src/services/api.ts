import { API_BASE } from '../constants';
import type { IdentifyResponse, ChatResponse, Message } from '../types';

export async function identifyUser(name: string): Promise<IdentifyResponse> {
  const res = await fetch(`${API_BASE}/api/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Identify failed: ${res.status}`);
  return res.json();
}

export async function selectUser(leadRefId: string): Promise<IdentifyResponse> {
  const res = await fetch(`${API_BASE}/api/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadRefId }),
  });
  if (!res.ok) throw new Error(`Select failed: ${res.status}`);
  return res.json();
}

export async function sendChatMessage(
  message: string,
  leadRefId: string,
  history: Message[],
  messageCount: number
): Promise<ChatResponse> {
  const chatHistory = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }));

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, leadRefId, history: chatHistory, messageCount }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return res.json();
}
