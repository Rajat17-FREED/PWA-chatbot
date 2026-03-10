import './TypingIndicator.css';

export default function TypingIndicator() {
  return (
    <div className="freed-message freed-message--assistant">
      <div className="freed-message__avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="#E8732A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="freed-typing">
        <div className="freed-typing__dot" />
        <div className="freed-typing__dot" />
        <div className="freed-typing__dot" />
      </div>
    </div>
  );
}
