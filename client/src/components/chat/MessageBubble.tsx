import { createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../context/AuthContext';
import AccountTooltip from './AccountTooltip';
import type { MessageTooltips, TooltipGroup } from '../../types';
import './MessageBubble.css';

// Map route URLs to dashboard tab actions
const REDIRECT_TAB_MAP: Record<string, string> = {
  '/dep': 'program',
  '/drp': 'program',
  '/dcp': 'program',
  '/credit-score': 'home',
  '/goal-tracker': 'savings',
  '/freed-shield': 'shield',
  '/dispute': 'shield',
};

// ── Contexts ──────────────────────────────────────────────────────────────────
// ParagraphTextContext: the plain-text content of the current <p> element.
// Consumed by the <strong> renderer to do clause-level context matching.
const ParagraphTextContext = createContext<string>('');

// TooltipsContext: the tooltip groups for this message.
// Defined once per MessageBubble, consumed by the <strong> renderer.
const TooltipsContext = createContext<MessageTooltips | undefined>(undefined);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively extract plain text from React children (strips markdown nodes). */
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in (children as any)) {
    return extractText((children as any).props?.children);
  }
  return '';
}

/** Format a timestamp for display below messages */
function formatTimestamp(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) return time;

  const dateStr = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  return `${dateStr}, ${time}`;
}

/**
 * Resolve which tooltip group to show for a bold number.
 *
 * Three-tier approach:
 *  Tier 0 — count match: If the bold number exactly matches the count of accounts
 *    in a tooltip group AND the context has relevant keywords, that's a strong match.
 *  Tier 1 — clause-level (strict): Split on commas/conjunctions and check the
 *    clause containing the number.
 *  Tier 2 — sentence-level (broad fallback): If no match at clause level, check
 *    the full sentence.
 */
function resolveTooltipGroup(
  numStr: string,
  paragraphText: string,
  tooltips?: MessageTooltips
): TooltipGroup | null {
  if (!tooltips) return null;

  const num = parseInt(numStr.replace(/,/g, ''), 10);
  if (isNaN(num) || num === 0) return null;

  // ── Tier 0: Count-based matching (strongest signal) ────────────────────
  // If bold number matches the exact count of accounts in a group AND context
  // has relevant keywords, this is almost certainly the right match.
  const fullCtx = paragraphText.toLowerCase();

  const groups: Array<{ key: keyof MessageTooltips; group: TooltipGroup; keywords: string[] }> = [
    { key: 'overdue', group: tooltips.overdue!, keywords: ['missed', 'overdue', 'slipped', 'late', 'delinquen', 'behind', 'payment issue', 'dpd'] },
    { key: 'active', group: tooltips.active!, keywords: ['active', 'managing', 'across', 'running', 'current', 'open', 'loan', 'account'] },
    { key: 'secured', group: tooltips.secured!, keywords: ['secured', 'home loan', 'vehicle', 'car loan', 'mortgage', 'housing'] },
    { key: 'unsecured', group: tooltips.unsecured!, keywords: ['unsecured', 'personal loan', 'credit card', 'consumer'] },
  ].filter(g => g.group);

  // Tier 0: exact count + any keyword match in full context
  // Check both dedup'd count (accounts.length) and raw pre-dedup count (rawCount)
  for (const { group, keywords } of groups) {
    const matchesCount = group.accounts.length === num || (group.rawCount != null && group.rawCount === num);
    if (matchesCount && keywords.some(kw => fullCtx.includes(kw))) {
      return group;
    }
  }

  // ── Tier 1: clause-level match (strict) ────────────────────────────────
  const clauses = paragraphText.split(/[,;]|\band\b|\bwith\b/i);
  const relevantClause = clauses.find(c => c.match(/\d+/g)?.includes(String(num)));
  const clauseCtx = (relevantClause ?? '').toLowerCase();

  if (clauseCtx) {
    if (tooltips.overdue &&
        (clauseCtx.includes('missed') || clauseCtx.includes('overdue') ||
         clauseCtx.includes('slipped') || clauseCtx.includes('late payment') ||
         clauseCtx.includes('behind') || clauseCtx.includes('delinquen'))) {
      return tooltips.overdue;
    }
    if (tooltips.active &&
        (clauseCtx.includes('active account') || clauseCtx.includes('active loan') ||
         clauseCtx.includes('managing') || clauseCtx.includes('across') || clauseCtx.includes('running'))) {
      return tooltips.active;
    }
    if (tooltips.secured &&
        (clauseCtx.includes('secured') || clauseCtx.includes('home loan') ||
         clauseCtx.includes('vehicle') || clauseCtx.includes('car loan'))) {
      return tooltips.secured;
    }
    if (tooltips.unsecured &&
        (clauseCtx.includes('unsecured') || clauseCtx.includes('personal loan') ||
         clauseCtx.includes('credit card'))) {
      return tooltips.unsecured;
    }
  }

  // ── Tier 2: sentence-level fallback ────────────────────────────────────
  const sentences = paragraphText.split(/[.!?]/);
  const relevantSentence = sentences.find(s => s.match(/\d+/g)?.includes(String(num))) ?? paragraphText;
  const sentCtx = relevantSentence.toLowerCase();

  if (tooltips.overdue &&
      (sentCtx.includes('missed payment') || sentCtx.includes('overdue') ||
       sentCtx.includes('slipped') || sentCtx.includes('late payment') || sentCtx.includes('behind'))) {
    return tooltips.overdue;
  }
  if (tooltips.active &&
      (sentCtx.includes('active account') || sentCtx.includes('active loan') ||
       sentCtx.includes('managing') || sentCtx.includes('across') ||
       (sentCtx.includes('account') && !sentCtx.includes('missed')))) {
    return tooltips.active;
  }
  if (tooltips.secured &&
      (sentCtx.includes('secured') || sentCtx.includes('home loan') ||
       sentCtx.includes('vehicle') || sentCtx.includes('car loan'))) {
    return tooltips.secured;
  }
  if (tooltips.unsecured &&
      (sentCtx.includes('unsecured') || sentCtx.includes('personal loan') ||
       sentCtx.includes('credit card'))) {
    return tooltips.unsecured;
  }

  return null;
}

// ── Custom ReactMarkdown components (static — defined outside component) ──────
// These read from the two contexts above; no closures over props.

const ParagraphComponent = ({ children }: any) => {
  const text = extractText(children);
  return (
    <ParagraphTextContext.Provider value={text}>
      <p className="freed-message__text">{children}</p>
    </ParagraphTextContext.Provider>
  );
};

const StrongComponent = ({ children }: any) => {
  const rawText = extractText(children);
  const paraText = useContext(ParagraphTextContext);
  const tooltips = useContext(TooltipsContext);
  const trimmed = rawText.trim();

  // ── Case 1: Pure integer e.g. **6**, **20** ────────────────────────────
  // Use the paragraph text for clause-level context matching.
  if (/^\d+$/.test(trimmed)) {
    const group = resolveTooltipGroup(trimmed, paraText, tooltips);
    if (group) {
      return <AccountTooltip value={trimmed} group={group} />;
    }
    return <strong className="freed-message__bold">{children}</strong>;
  }

  // ── Case 2: "N phrase" e.g. **24 active accounts**, **6 missed payments** ──
  // Model sometimes bolds the full phrase instead of just the number.
  // Extract the leading integer and use the phrase itself as rich context.
  const leadingNum = trimmed.match(/^(\d+)(\s.+)$/);
  if (leadingNum) {
    const numStr = leadingNum[1];
    const rest = leadingNum[2]; // e.g. " active accounts"
    // Combine the phrase with the paragraph text for better context matching
    const combinedCtx = trimmed + ' ' + paraText;
    const group = resolveTooltipGroup(numStr, combinedCtx, tooltips);
    if (group) {
      // Keep styling unified: tooltip on the number, rest stays bold inline
      return (
        <strong className="freed-message__bold">
          <AccountTooltip value={numStr} group={group} />
          {rest}
        </strong>
      );
    }
  }

  return <strong className="freed-message__bold">{children}</strong>;
};

// List item component — also sets ParagraphTextContext so tooltip
// matching works for bold numbers inside bullet points.
const ListItemComponent = ({ children }: any) => {
  const text = extractText(children);
  return (
    <ParagraphTextContext.Provider value={text}>
      <li className="freed-message__list-item">{children}</li>
    </ParagraphTextContext.Provider>
  );
};

const MARKDOWN_COMPONENTS = {
  p: ParagraphComponent,
  strong: StrongComponent,
  ul: ({ children }: any) => <ul className="freed-message__list">{children}</ul>,
  ol: ({ children }: any) => <ol className="freed-message__list freed-message__list--ordered">{children}</ol>,
  li: ListItemComponent,
  em: ({ children }: any) => <em>{children}</em>,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

// ── MessageBubble ─────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  content: string;
  role: 'user' | 'assistant';
  timestamp?: Date;
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
  tooltips?: MessageTooltips;
  isLatest?: boolean;
  onFollowUpClick?: (text: string) => void;
}

export default function MessageBubble({
  content,
  role,
  timestamp,
  redirectUrl,
  redirectLabel,
  followUps,
  tooltips,
  isLatest,
  onFollowUpClick,
}: MessageBubbleProps) {
  const { isLoggedIn } = useAuth();
  const showFollowUps = isLatest && role === 'assistant' && onFollowUpClick;
  const hasFollowUps = followUps && followUps.length > 0;
  const hasRedirect = redirectUrl && redirectLabel;

  const handleRedirectClick = () => {
    if (!redirectUrl) return;
    if (redirectUrl.startsWith('/')) {
      if (isLoggedIn) {
        const tab = REDIRECT_TAB_MAP[redirectUrl] || 'home';
        window.dispatchEvent(new CustomEvent('freed-switch-tab', { detail: { tab } }));
      }
      window.dispatchEvent(new CustomEvent('freed-close-chat'));
    } else {
      window.open(redirectUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className={`freed-message freed-message--${role}`}>
      {role === 'assistant' && (
        <div className="freed-message__avatar">
          <img
            src="/assets/freed-logo.png"
            alt="FREED"
            className="freed-message__avatar-img"
          />
        </div>
      )}
      <div className={`freed-message__bubble freed-message__bubble--${role}`}>
        {role === 'assistant' ? (
          // Provide both contexts so the static components above can read them
          <TooltipsContext.Provider value={tooltips}>
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>
              {content}
            </ReactMarkdown>
          </TooltipsContext.Provider>
        ) : (
          <p className="freed-message__text">{content}</p>
        )}
      </div>

      {/* Timestamp */}
      {timestamp && (
        <span className={`freed-message__timestamp freed-message__timestamp--${role}`}>
          {formatTimestamp(timestamp)}
        </span>
      )}

      {/* Follow-ups and redirect shown as options */}
      {showFollowUps && (hasFollowUps || hasRedirect) && (
        <div className="freed-followups">
          {hasFollowUps && followUps.map((text, i) => (
            <button
              key={i}
              className="freed-followups__chip"
              onClick={() => onFollowUpClick(text)}
            >
              {text}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="freed-followups__arrow">
                <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
          {hasRedirect && (
            <button
              className="freed-followups__chip freed-followups__chip--redirect"
              onClick={handleRedirectClick}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="freed-followups__redirect-icon">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {redirectLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
