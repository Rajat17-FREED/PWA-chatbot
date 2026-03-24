import './TypingIndicator.css';

export default function TypingIndicator() {
  return (
    <div className="freed-message freed-message--assistant">
      <div className="freed-message__avatar">
        <img
          src="/assets/freed-logo.png"
          alt="FREED"
          className="freed-message__avatar-img"
        />
      </div>
      <div className="freed-typing">
        <div className="freed-typing__dot" />
        <div className="freed-typing__dot" />
        <div className="freed-typing__dot" />
      </div>
    </div>
  );
}
