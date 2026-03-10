import { SEGMENT_LABELS } from '../../constants';
import type { Segment } from '../../types';
import './UserDisambiguation.css';

interface Candidate {
  leadRefId: string;
  firstName: string;
  lastName: string;
  segment: Segment;
}

interface UserDisambiguationProps {
  candidates: Candidate[];
  onSelect: (leadRefId: string) => void;
}

export default function UserDisambiguation({ candidates, onSelect }: UserDisambiguationProps) {
  return (
    <div className="freed-disambig">
      {candidates.map(c => (
        <button
          key={c.leadRefId}
          className="freed-disambig__card"
          onClick={() => onSelect(c.leadRefId)}
        >
          <div className="freed-disambig__name">
            {c.firstName} {c.lastName}
          </div>
          <div className="freed-disambig__segment">
            {SEGMENT_LABELS[c.segment] || c.segment}
          </div>
        </button>
      ))}
    </div>
  );
}
