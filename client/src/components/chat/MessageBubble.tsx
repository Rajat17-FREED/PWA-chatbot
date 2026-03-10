import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../context/AuthContext';
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

interface MessageBubbleProps {
  content: string;
  role: 'user' | 'assistant';
  redirectUrl?: string;
  redirectLabel?: string;
  followUps?: string[];
  isLatest?: boolean;
  onFollowUpClick?: (text: string) => void;
}

export default function MessageBubble({
  content,
  role,
  redirectUrl,
  redirectLabel,
  followUps,
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
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="freed-message__text">{children}</p>,
              ul: ({ children }) => <ul className="freed-message__list">{children}</ul>,
              ol: ({ children }) => <ol className="freed-message__list freed-message__list--ordered">{children}</ol>,
              li: ({ children }) => <li className="freed-message__list-item">{children}</li>,
              strong: ({ children }) => <strong className="freed-message__bold">{children}</strong>,
              em: ({ children }) => <em>{children}</em>,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        ) : (
          <p className="freed-message__text">{content}</p>
        )}
      </div>
      {/* Follow-ups and redirect shown as options */}
      {showFollowUps && (hasFollowUps || hasRedirect) && (
        <div className="freed-followups">
          {/* Regular follow-up chips */}
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
          {/* Redirect shown as a special action chip */}
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
