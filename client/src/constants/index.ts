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

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const SEGMENT_LABELS: Record<string, string> = {
  DRP_Eligible: 'Debt Resolution',
  DRP_Ineligible: 'Financial Guidance',
  DCP_Eligible: 'Debt Consolidation',
  DCP_Ineligible: 'Credit Improvement',
  DEP: 'Debt Elimination',
  NTC: 'New to Credit',
  Others: 'Credit Wellness',
};
