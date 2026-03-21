import { useAutoScroll } from '../../hooks/useAutoScroll';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import ConversationStarters from './ConversationStarters';
import UserDisambiguation from './UserDisambiguation';
import type { Message, ConversationStarter, ChatPhase, Segment } from '../../types';
import './MessageList.css';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  phase: ChatPhase;
  candidates: Array<{ leadRefId: string; firstName: string; lastName: string; segment: Segment }>;
  starters: ConversationStarter[];
  onSelectUser: (leadRefId: string) => void;
  onStarterClick: (text: string, intentTag?: string) => void;
  onFollowUpClick: (text: string) => void;
}

export default function MessageList({
  messages,
  isLoading,
  phase,
  candidates,
  starters,
  onSelectUser,
  onStarterClick,
  onFollowUpClick,
}: MessageListProps) {
  const scrollRef = useAutoScroll([messages.length, isLoading, phase]);

  // Find the last assistant message index for showing follow-ups only on latest
  const lastAssistantIdx = messages.reduce(
    (last, msg, idx) => (msg.role === 'assistant' ? idx : last),
    -1
  );

  return (
    <div className="freed-message-list" ref={scrollRef}>
      {messages.map((msg, idx) => (
        <MessageBubble
          key={msg.id}
          content={msg.content}
          role={msg.role}
          timestamp={msg.timestamp}
          redirectUrl={msg.redirectUrl}
          redirectLabel={msg.redirectLabel}
          followUps={msg.followUps}
          tooltips={msg.tooltips}
          lenderSelector={msg.lenderSelector}
          isLatest={idx === lastAssistantIdx && !isLoading && phase === 'chatting'}
          onFollowUpClick={onFollowUpClick}
        />
      ))}

      {phase === 'disambiguating' && candidates.length > 0 && (
        <UserDisambiguation candidates={candidates} onSelect={onSelectUser} />
      )}

      {phase === 'starters' && starters.length > 0 && (
        <ConversationStarters starters={starters} onStarterClick={onStarterClick} />
      )}

      {isLoading && <TypingIndicator />}
    </div>
  );
}
