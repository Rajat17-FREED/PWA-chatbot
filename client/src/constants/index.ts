export const COLORS = {
  freedBlue: '#1B2B65',
  freedLightBlue: '#4A7BF7',
  freedBg: '#F5F7FA',
  white: '#FFFFFF',
  textPrimary: '#1B2B65',
  textSecondary: '#6B7280',
  botBubble: '#E8EEF8',
  userBubble: '#1B2B65',
  userText: '#FFFFFF',
  inputBorder: '#D1D5DB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
};

function resolveApiBase(): string {
  const envApiUrl = import.meta.env.VITE_API_URL?.trim();

  if (typeof window === 'undefined') {
    return envApiUrl || 'http://localhost:3001';
  }

  const host = window.location.hostname;
  const isLocalFrontend = host === 'localhost' || host === '127.0.0.1';
  const isTunnelUrl = !!envApiUrl && /devtunnels\.ms|ngrok|trycloudflare\.com/i.test(envApiUrl);

  // Local frontend sessions should talk to the local API by default.
  // This avoids stale tunnel URLs silently breaking login and chat.
  if (isLocalFrontend && (!envApiUrl || isTunnelUrl)) {
    return 'http://localhost:3001';
  }

  if (envApiUrl) {
    return envApiUrl;
  }

  return `${window.location.protocol}//${window.location.host}`;
}

export const API_BASE = resolveApiBase();

export const SEGMENT_LABELS: Record<string, string> = {
  DRP_Eligible: 'Debt Resolution',
  DRP_Ineligible: 'Financial Guidance',
  DCP_Eligible: 'Debt Consolidation',
  DCP_Ineligible: 'Credit Improvement',
  DEP: 'Debt Elimination',
  NTC: 'New to Credit',
  Others: 'Credit Wellness',
};
