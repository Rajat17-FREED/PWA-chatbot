import type { ConversationStarter } from '../../types';
import './ConversationStarters.css';

interface ConversationStartersProps {
  starters: ConversationStarter[];
  onStarterClick: (text: string) => void;
}

export default function ConversationStarters({ starters, onStarterClick }: ConversationStartersProps) {
  if (starters.length === 0) return null;

  return (
    <div className="freed-starters">
      {starters.map((starter, i) => (
        <button
          key={i}
          className="freed-starters__chip"
          onClick={() => onStarterClick(starter.text)}
        >
          {starter.text}
        </button>
      ))}
    </div>
  );
}
