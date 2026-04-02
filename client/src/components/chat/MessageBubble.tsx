import { createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import AccountTooltip from './AccountTooltip';
import LenderSelector from './LenderSelector';
import RedirectionWidget from './RedirectionWidget';
import InlineWidgetRenderer from './InlineWidgetRenderer';
import RepaymentMethodPopup from './RepaymentMethodPopup';
import type { MessageTooltips, TooltipGroup, LenderSelector as LenderSelectorType, InlineWidget, RepaymentMethodData } from '../../types';
import './MessageBubble.css';

// ── Contexts ──────────────────────────────────────────────────────────────────
// ParagraphTextContext: the plain-text content of the current <p> element.
// Consumed by the <strong> renderer to do clause-level context matching.
const ParagraphTextContext = createContext<string>('');

// TooltipsContext: the tooltip groups for this message.
// Defined once per MessageBubble, consumed by the <strong> renderer.
const TooltipsContext = createContext<MessageTooltips | undefined>(undefined);

// RepaymentMethodsContext: snowball/avalanche data for popup triggers.
const RepaymentMethodsContext = createContext<RepaymentMethodData | undefined>(undefined);

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

function normalizeAssistantContent(content: string): string {
  return content
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolve which tooltip group to show for a bold number.
 *
 * Strict approach:
 * - Only show tooltip when the bold number equals an account COUNT in a
 *   relevant group (active or overdue) and context keywords match.
 * - Never infer from sentence-level proximity for unrelated numbers.
 */
function resolveTooltipGroup(
  numStr: string,
  paragraphText: string,
  tooltips?: MessageTooltips
): TooltipGroup | null {
  if (!tooltips) return null;

  const num = parseInt(numStr.replace(/,/g, ''), 10);
  if (isNaN(num) || num === 0) return null;

  // Strict mode: only show tooltips when the bold number equals
  // the account COUNT in a relevant group. This prevents unrelated
  // numbers (score/amount/percentage) from opening account popups.
  const fullCtx = paragraphText.toLowerCase();

  const groups: Array<{ group: TooltipGroup; keywords: string[] }> = [];
  if (tooltips.overdue) {
    groups.push({
      group: tooltips.overdue,
      keywords: ['missed', 'overdue', 'slipped', 'late', 'delinquen', 'behind', 'payment issue', 'dpd'],
    });
  }
  if (tooltips.active) {
    groups.push({
      group: tooltips.active,
      keywords: ['active', 'managing', 'across', 'running', 'current', 'open', 'loan', 'account'],
    });
  }

  // Pass 1 — Exact count + contextual keyword (strictest, preferred).
  // Check both dedup'd count (accounts.length) and raw pre-dedup count (rawCount)
  for (const { group, keywords } of groups) {
    const matchesCount = group.accounts.length === num || (group.rawCount != null && group.rawCount === num);
    if (matchesCount && keywords.some(kw => fullCtx.includes(kw))) {
      return group;
    }
  }

  // Pass 2 — Relaxed: the AI may reference a subset of a group (e.g. "2 accounts
  // with missed payments" when 5 total exist). Allow when:
  //   (a) the bold number is ≤ the group size, AND
  //   (b) the context includes at least one strong keyword for the group.
  // Only applies to small account-like numbers (≤ 50) to avoid matching amounts.
  if (num <= 50) {
    for (const { group, keywords } of groups) {
      const groupSize = Math.max(group.accounts.length, group.rawCount ?? 0);
      if (num <= groupSize && keywords.some(kw => fullCtx.includes(kw))) {
        return group;
      }
    }
  }

  return null;
}

// ── Custom ReactMarkdown components (static — defined outside component) ──────
// These read from the two contexts above; no closures over props.

const YOUTUBE_MARKER_RE = /^\{\{youtube:([a-zA-Z0-9_-]+)\}\}$/;

const ParagraphComponent = ({ children }: any) => {
  const text = extractText(children);

  // Detect {{youtube:VIDEO_ID}} marker — render inline iframe instead of <p>
  const ytMatch = text.trim().match(YOUTUBE_MARKER_RE);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return (
      <div className="freed-message__inline-video">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`}
          title="Video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

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
  const repaymentMethods = useContext(RepaymentMethodsContext);
  const trimmed = rawText.trim();

  // ── Case 0: Repayment method trigger (snowball/avalanche) ──────────
  if (repaymentMethods) {
    const lower = trimmed.toLowerCase();
    if (/snowball\s*method/i.test(lower)) {
      return <RepaymentMethodPopup data={repaymentMethods} triggerText={trimmed} method="snowball" />;
    }
    if (/avalanche\s*method/i.test(lower)) {
      return <RepaymentMethodPopup data={repaymentMethods} triggerText={trimmed} method="avalanche" />;
    }
  }

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
  lenderSelector?: LenderSelectorType;
  inlineWidgets?: InlineWidget[];
  repaymentMethods?: RepaymentMethodData;
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
  lenderSelector,
  inlineWidgets,
  repaymentMethods,
  isLatest,
  onFollowUpClick,
}: MessageBubbleProps) {
  const normalizedContent = role === 'assistant' ? normalizeAssistantContent(content) : content;
  const normalizedFollowUps = (followUps || []).slice(0, 3);
  const showFollowUps = isLatest && role === 'assistant' && onFollowUpClick;
  const hasFollowUps = normalizedFollowUps.length > 0;
  const hasRedirect = redirectUrl && redirectLabel;
  const hasLenderSelector = isLatest && role === 'assistant' && lenderSelector && onFollowUpClick;

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
            <RepaymentMethodsContext.Provider value={repaymentMethods}>
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                {normalizedContent}
              </ReactMarkdown>
            </RepaymentMethodsContext.Provider>
          </TooltipsContext.Provider>
        ) : (
          <p className="freed-message__text">{normalizedContent}</p>
        )}
        {/* Carousel rendered inside the message bubble */}
        {inlineWidgets && inlineWidgets.filter(w => w.type === 'carousel').length > 0 && (
          <div className="freed-message__inline-carousel">
            <p className="freed-message__text"><strong className="freed-message__bold">WHAT COUNTS AS HARASSMENT</strong></p>
            {inlineWidgets.filter(w => w.type === 'carousel').map((widget, i) => (
              <InlineWidgetRenderer key={`carousel-${i}`} widget={widget} />
            ))}
          </div>
        )}
      </div>

      {/* Timestamp */}
      {timestamp && (
        <span className={`freed-message__timestamp freed-message__timestamp--${role}`}>
          {formatTimestamp(timestamp)}
        </span>
      )}

      {/* Interactive lender selector for harassment flow */}
      {hasLenderSelector && lenderSelector && onFollowUpClick && (
        <LenderSelector
          selector={lenderSelector}
          onSubmit={onFollowUpClick}
        />
      )}

      {/* Non-carousel inline widgets (hidden when lender selector is active) */}
      {showFollowUps && !hasLenderSelector && inlineWidgets && inlineWidgets.filter(w => w.type !== 'carousel').length > 0 && (
        <div className="freed-message__inline-widgets">
          {inlineWidgets.filter(w => w.type !== 'carousel').map((widget, i) => (
            <InlineWidgetRenderer key={`widget-${i}`} widget={widget} />
          ))}
        </div>
      )}

      {/* Redirection widget shown as rich card (hidden when lender selector is active) */}
      {showFollowUps && !hasLenderSelector && hasRedirect && redirectUrl && redirectLabel && (
        <RedirectionWidget url={redirectUrl} label={redirectLabel} />
      )}

      {/* Follow-ups shown as chips below the widget (hidden when lender selector is active) */}
      {showFollowUps && !hasLenderSelector && hasFollowUps && (
        <div className="freed-followups">
          {normalizedFollowUps.map((text, i) => (
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
        </div>
      )}
    </div>
  );
}
