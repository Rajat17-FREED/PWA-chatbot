import { useState, type KeyboardEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SEGMENT_LABELS } from '../../constants';
import type { Segment } from '../../types';
import './LoginModal.css';

interface LoginModalProps {
  onClose: () => void;
}

type Step = 'name' | 'disambiguate';

export default function LoginModal({ onClose }: LoginModalProps) {
  const { login, selectUser, isLoading } = useAuth();
  const [step, setStep] = useState<Step>('name');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<Array<{ leadRefId: string; firstName: string; lastName: string; segment: Segment }>>([]);

  const handleSubmit = async () => {
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!fullName) {
      setError('Please enter your name');
      return;
    }
    setError('');
    const result = await login(fullName);
    if (result.status === 'found') {
      onClose();
    } else if (result.status === 'multiple' && result.candidates) {
      setCandidates(result.candidates);
      setStep('disambiguate');
    } else {
      setError(result.message || 'No profile found. Please check your name and try again.');
    }
  };

  const handleSelect = async (leadRefId: string) => {
    await selectUser(leadRefId);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="login-modal" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button className="login-modal__close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Logo */}
        <div className="login-modal__logo">
          <img src="/assets/freed-logo.png" alt="FREED" height="36" />
        </div>

        {step === 'name' ? (
          <>
            <h2 className="login-modal__title">Welcome Back!</h2>
            <p className="login-modal__subtitle">Please Login to continue</p>

            <div className="login-modal__form">
              <label className="login-modal__label">Name (as per PAN)</label>
              <div className="login-modal__name-row">
                <input
                  className="login-modal__input"
                  placeholder="First Name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
                <input
                  className="login-modal__input"
                  placeholder="Last Name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>

              {error && <p className="login-modal__error">{error}</p>}
            </div>

            <button
              className="login-modal__btn"
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="login-modal__spinner" />
              ) : (
                <>
                  Continue
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 6 }}>
                    <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <h2 className="login-modal__title">Select Your Profile</h2>
            <p className="login-modal__subtitle">We found multiple matches</p>

            <div className="login-modal__candidates">
              {candidates.map(c => (
                <button
                  key={c.leadRefId}
                  className="login-modal__candidate"
                  onClick={() => handleSelect(c.leadRefId)}
                  disabled={isLoading}
                >
                  <div className="login-modal__candidate-name">
                    {c.firstName} {c.lastName}
                  </div>
                  <div className="login-modal__candidate-segment">
                    {SEGMENT_LABELS[c.segment] || c.segment}
                  </div>
                </button>
              ))}
            </div>

            <button
              className="login-modal__back"
              onClick={() => { setStep('name'); setCandidates([]); }}
            >
              &larr; Try a different name
            </button>
          </>
        )}
      </div>
    </div>
  );
}
