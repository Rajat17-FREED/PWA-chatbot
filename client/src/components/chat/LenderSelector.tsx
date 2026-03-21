import { useState, useRef } from 'react';
import type { LenderSelector as LenderSelectorType } from '../../types';
import './LenderSelector.css';

interface LenderSelectorProps {
  selector: LenderSelectorType;
  onSubmit: (selectedText: string) => void;
  disabled?: boolean;
}

function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export default function LenderSelector({ selector, onSubmit, disabled }: LenderSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherText, setOtherText] = useState('');
  const [otherChecked, setOtherChecked] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const toggleLender = (name: string) => {
    if (submitted) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleOther = () => {
    if (submitted) return;
    setOtherChecked(prev => !prev);
    if (!otherChecked) {
      setTimeout(() => otherInputRef.current?.focus(), 100);
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    const lenders = [...selected];
    if (otherChecked && otherText.trim()) {
      lenders.push(otherText.trim());
    }
    if (lenders.length === 0) return;

    setSubmitted(true);
    const message = lenders.length === 1
      ? `I'm facing harassment from ${lenders[0]}`
      : `I'm facing harassment from ${lenders.slice(0, -1).join(', ')} and ${lenders[lenders.length - 1]}`;
    onSubmit(message);
  };

  const hasSelection = selected.size > 0 || (otherChecked && otherText.trim().length > 0);

  return (
    <div className={`freed-lender-selector ${submitted ? 'freed-lender-selector--submitted' : ''}`}>
      <p className="freed-lender-selector__prompt">{selector.prompt}</p>

      <div className="freed-lender-selector__options">
        {selector.lenders.map((lender) => (
          <label
            key={lender.name}
            className={`freed-lender-selector__option ${selected.has(lender.name) ? 'freed-lender-selector__option--selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(lender.name)}
              onChange={() => toggleLender(lender.name)}
              disabled={submitted || disabled}
              className="freed-lender-selector__checkbox"
            />
            <div className="freed-lender-selector__info">
              <span className="freed-lender-selector__name">{lender.name}</span>
              <span className="freed-lender-selector__meta">
                {lender.debtType && <span>{lender.debtType}</span>}
                {lender.overdueAmount ? (
                  <span className="freed-lender-selector__overdue">
                    {formatINR(lender.overdueAmount)} overdue
                  </span>
                ) : lender.maxDPD ? (
                  <span className="freed-lender-selector__dpd">
                    {lender.maxDPD} days past due
                  </span>
                ) : null}
              </span>
            </div>
          </label>
        ))}

        {selector.allowOther && (
          <label
            className={`freed-lender-selector__option freed-lender-selector__option--other ${otherChecked ? 'freed-lender-selector__option--selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={otherChecked}
              onChange={toggleOther}
              disabled={submitted || disabled}
              className="freed-lender-selector__checkbox"
            />
            <div className="freed-lender-selector__info freed-lender-selector__other-info">
              <span className="freed-lender-selector__name">Other lender</span>
              {otherChecked && (
                <input
                  ref={otherInputRef}
                  type="text"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder="Enter lender name"
                  disabled={submitted || disabled}
                  className="freed-lender-selector__other-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && hasSelection) handleSubmit();
                  }}
                />
              )}
            </div>
          </label>
        )}
      </div>

      {!submitted && (
        <button
          className="freed-lender-selector__submit"
          onClick={handleSubmit}
          disabled={!hasSelection || disabled}
        >
          {hasSelection
            ? `Continue with ${selected.size + (otherChecked && otherText.trim() ? 1 : 0)} lender${(selected.size + (otherChecked && otherText.trim() ? 1 : 0)) > 1 ? 's' : ''}`
            : 'Select at least one lender'}
        </button>
      )}
    </div>
  );
}
