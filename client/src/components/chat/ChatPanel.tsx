import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
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
