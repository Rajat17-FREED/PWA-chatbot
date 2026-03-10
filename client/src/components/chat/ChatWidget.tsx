import { useState, useEffect, useRef, useCallback } from 'react';
import ChatPanel from './ChatPanel';
import { useChat } from '../../hooks/useChat';
import './ChatWidget.css';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showInvite, setShowInvite] = useState(true);
  const [inviteVisible, setInviteVisible] = useState(false);

  // Lift chat state up so it persists across open/close
  const chat = useChat();

  // Drag state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number; moved: boolean } | null>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showInvite) return;
    const showTimer = setTimeout(() => setInviteVisible(true), 2000);
    const hideTimer = setTimeout(() => {
      setInviteVisible(false);
      setTimeout(() => setShowInvite(false), 400);
    }, 12000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [showInvite]);

  // Get default position based on screen size
  const getDefaultPosition = useCallback(() => {
    const isMobile = window.innerWidth <= 768;
    return {
      x: window.innerWidth - (isMobile ? 20 : Math.max(16, (window.innerWidth - 480) / 2 + 16)) - 88,
      y: window.innerHeight - (isMobile ? 150 : 112),
    };
  }, []);

  // Set default position on mount
  useEffect(() => {
    if (!position) {
      setPosition(getDefaultPosition());
    }
  }, [position, getDefaultPosition]);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!avatarRef.current) return;
    const pos = position || getDefaultPosition();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: pos.x,
      startPosY: pos.y,
      moved: false,
    };
    setIsDragging(true);
    avatarRef.current.setPointerCapture(e.pointerId);
  }, [position, getDefaultPosition]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    const newX = Math.max(0, Math.min(window.innerWidth - 88, dragRef.current.startPosX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 88, dragRef.current.startPosY + dy));
    setPosition({ x: newX, y: newY });
  }, [isDragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setIsDragging(false);
    if (!dragRef.current.moved) {
      // Was a click, not a drag
      setIsOpen(true);
      setShowInvite(false);
      setInviteVisible(false);
    }
    if (avatarRef.current) {
      avatarRef.current.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setShowInvite(false);
    setInviteVisible(false);
  };

  const handleDismissInvite = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInviteVisible(false);
    setTimeout(() => setShowInvite(false), 400);
  };

  const toggleMaximize = () => setIsMaximized(prev => !prev);

  // Listen for redirect events to minimize chat
  useEffect(() => {
    const handleCloseChat = () => {
      setIsOpen(false);
      setIsMaximized(false);
    };
    window.addEventListener('freed-close-chat', handleCloseChat);
    return () => window.removeEventListener('freed-close-chat', handleCloseChat);
  }, []);

  const avatarPos = position || getDefaultPosition();
  // Invite bubble position relative to avatar
  const inviteStyle: React.CSSProperties = position
    ? { left: Math.max(8, avatarPos.x - 180), top: avatarPos.y - 80, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <>
      {isOpen && (
        <ChatPanel
          onClose={() => setIsOpen(false)}
          isMaximized={isMaximized}
          onToggleMaximize={toggleMaximize}
          chat={chat}
        />
      )}

      {/* Speech bubble invite */}
      {showInvite && !isOpen && (
        <div
          className={`chat-invite-bubble ${inviteVisible ? 'chat-invite-bubble--visible' : ''}`}
          style={position ? inviteStyle : undefined}
          onClick={handleOpen}
        >
          <div className="chat-invite-bubble__content">
            <span className="chat-invite-bubble__wave">👋</span>
            <span className="chat-invite-bubble__text">
              Hi, I'm FREED Assistant,<br />
              Click to get financial help with AI.
            </span>
          </div>
          <button
            className="chat-invite-bubble__dismiss"
            onClick={handleDismissInvite}
            aria-label="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" fill="#6B7280" />
              <path d="M8 12H16" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="chat-invite-bubble__tail" />
        </div>
      )}

      {/* Circular chatbot avatar button - draggable */}
      <button
        ref={avatarRef}
        className={`freed-chat-avatar ${isOpen ? 'freed-chat-avatar--hidden' : ''} ${isDragging ? 'freed-chat-avatar--dragging' : ''}`}
        style={{ left: avatarPos.x, top: avatarPos.y, right: 'auto', bottom: 'auto' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label="Open FREED Chat"
      >
        <div className="freed-chat-avatar__ring">
          <div className="freed-chat-avatar__inner">
            <img
              src="/assets/freed-logo.png"
              alt="FREED"
              className="freed-chat-avatar__logo"
            />
          </div>
          <svg className="freed-chat-avatar__ring-text" viewBox="0 0 120 120">
            <defs>
              <path id="circlePath" d="M 60, 60 m -45, 0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0" />
            </defs>
            <text>
              <textPath href="#circlePath" startOffset="5%">
                FREED Assistant  •  Chat Now  •
              </textPath>
            </text>
          </svg>
        </div>
        <div className="freed-chat-avatar__pulse" />
      </button>
    </>
  );
}
