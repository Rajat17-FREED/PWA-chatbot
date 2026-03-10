import './ChatHeader.css';

interface ChatHeaderProps {
  onClose: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onClearChat?: () => void;
}

export default function ChatHeader({ onClose, isMaximized, onToggleMaximize, onClearChat }: ChatHeaderProps) {
  return (
    <div className="freed-chat-header">
      <div className="freed-chat-header__info">
        <div className="freed-chat-header__avatar">
          <img src="/assets/freed-logo.png" alt="FREED" className="freed-chat-header__logo" />
        </div>
        <div>
          <div className="freed-chat-header__title">FREED Assistant</div>
          <div className="freed-chat-header__subtitle">Your financial wellness guide</div>
        </div>
      </div>
      <div className="freed-chat-header__actions">
        {/* Clear conversation button */}
        {onClearChat && (
          <button
            className="freed-chat-header__action-btn"
            onClick={onClearChat}
            aria-label="Start new conversation"
            title="New conversation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 12a9 9 0 1 1 3.3 7" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <path d="M3 19v-7h7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onToggleMaximize && (
          <button
            className="freed-chat-header__action-btn"
            onClick={onToggleMaximize}
            aria-label={isMaximized ? 'Minimize chat' : 'Maximize chat'}
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? (
              /* Minimize icon (restore down) */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="8" width="12" height="12" rx="2" stroke="white" strokeWidth="2" />
                <path d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2" stroke="white" strokeWidth="2" />
              </svg>
            ) : (
              /* Maximize icon */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="white" strokeWidth="2" />
              </svg>
            )}
          </button>
        )}
        <button className="freed-chat-header__action-btn" onClick={onClose} aria-label="Close chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6L18 18" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
