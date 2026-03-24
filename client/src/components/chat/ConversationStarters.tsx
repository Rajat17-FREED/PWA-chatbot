import type { ConversationStarter } from '../../types';
import './ConversationStarters.css';

interface ConversationStartersProps {
  starters: ConversationStarter[];
  onStarterClick: (text: string, intentTag?: string) => void;
}

export default function ConversationStarters({ starters, onStarterClick }: ConversationStartersProps) {
  if (starters.length === 0) return null;

  return (
    <div className="freed-starters">
      {starters.map((starter, i) => (
        <button
          key={i}
          className="freed-starters__chip"
          onClick={() => onStarterClick(starter.text, starter.intentTag)}
          style={{ animationDelay: `${i * 0.06}s` }}
        >
          <span className="freed-starters__text">{starter.text}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="freed-starters__arrow">
            <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}
