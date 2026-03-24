import { useState, useMemo } from 'react';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import { API_BASE } from '../../constants';
import type { ChatState } from '../../types';
import './ChatPanel.css';

interface ChatPanelProps {
  onClose: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  chat: {
    state: ChatState;
    handleInput: (text: string) => void;
    handleSelectUser: (leadRefId: string) => void;
    sendMessage: (text: string, intentTag?: string) => void;
    clearConversation: () => void;
  };
}

export default function ChatPanel({ onClose, isMaximized, onToggleMaximize, chat }: ChatPanelProps) {
  const { state, handleInput, handleSelectUser, sendMessage, clearConversation } = chat;
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const evalMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('eval') === 'true';
  }, []);

  const captureForEval = async () => {
    if (!state.user || state.messages.length === 0) return;
    setCaptureStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/evals/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadRefId: state.user.leadRefId,
          userName: `${state.user.firstName} ${state.user.lastName}`,
          segment: state.user.segment,
          messages: state.messages.map(m => ({ role: m.role, content: m.content })),
          intentTag: state.messages.find(m => m.retryIntentTag)?.retryIntentTag,
        }),
      });
      if (!res.ok) throw new Error('Capture failed');
      setCaptureStatus('done');
      setTimeout(() => setCaptureStatus('idle'), 3000);
    } catch {
      setCaptureStatus('error');
      setTimeout(() => setCaptureStatus('idle'), 3000);
    }
  };

  return (
    <div className={`freed-chat-panel ${isMaximized ? 'freed-chat-panel--maximized' : ''}`}>
      <ChatHeader
        onClose={onClose}
        isMaximized={isMaximized}
        onToggleMaximize={onToggleMaximize}
        onClearChat={clearConversation}
      />
      <MessageList
        messages={state.messages}
        isLoading={state.isLoading}
        phase={state.phase}
        candidates={state.candidates}
        starters={state.starters}
        onSelectUser={handleSelectUser}
        onStarterClick={sendMessage}
        onFollowUpClick={sendMessage}
      />
      {evalMode && state.phase === 'chatting' && state.messages.length > 0 && (
        <button
          className="freed-chat-eval-capture"
          onClick={captureForEval}
          disabled={captureStatus === 'saving'}
          title="Capture this conversation as an eval test case"
        >
          {captureStatus === 'idle' && 'Flag for Eval'}
          {captureStatus === 'saving' && 'Saving...'}
          {captureStatus === 'done' && 'Captured!'}
          {captureStatus === 'error' && 'Failed'}
        </button>
      )}
      <ChatInput
        onSend={handleInput}
        disabled={state.isLoading}
        isLoading={state.isLoading}
        placeholder={
          state.phase === 'greeting'
            ? 'Enter your name...'
            : state.phase === 'disambiguating'
              ? 'Select from above or type your full name...'
              : 'Type your message...'
        }
      />
    </div>
  );
}
