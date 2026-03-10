import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import './ChatInput.css';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  isLoading?: boolean;
  placeholder: string;
}

export default function ChatInput({ onSend, disabled, isLoading, placeholder }: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wasLoadingRef = useRef(false);

  // Auto-focus input when bot finishes responding
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
    wasLoadingRef.current = !!isLoading;
  }, [isLoading]);

  // Also focus on initial mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="freed-chat-input">
      <input
        ref={inputRef}
        type="text"
        className="freed-chat-input__field"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        className="freed-chat-input__send"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
