import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import LoginModal from '../components/auth/LoginModal';
import './HomePage.css';

const stats = [
  { value: '20,00,000+', label: 'Customers Counselled' },
  { value: '₹3,200+ Cr', label: 'Debt Managed' },
  { value: '15,000+', label: 'Accounts Settled' },
  { value: '4.7 / 5', label: 'Customer Rating' },
];

export default function HomePage() {
  const [showLogin, setShowLogin] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [scoreError, setScoreError] = useState('');
  const [scoreLoading, setScoreLoading] = useState(false);
  const { login } = useAuth();

  const handleViewScore = async () => {
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) {
      setScoreError('Please enter your name to view your credit score.');
      return;
    }
    setScoreError('');
    setScoreLoading(true);
    try {
      const result = await login(fullName);
      if (result.status === 'found') {
        // Login successful — App.tsx will render Dashboard with credit score
      } else if (result.status === 'multiple') {
        // Multiple matches, open login modal to disambiguate
        setShowLogin(true);
      } else {
        setScoreError("We couldn't find your profile. Please try with your registered name.");
      }
    } catch {
      setScoreError('Something went wrong. Please try again.');
    } finally {
      setScoreLoading(false);
    }
  };

  return (
    <div className="landing">
      {/* Navbar */}
      <nav className="landing-nav">
        <div className="landing-nav__inner">
          <div className="landing-nav__logo">
            <img src="/assets/freed-logo.png" alt="FREED" height="28" />
          </div>
          <button className="landing-nav__cta" onClick={() => setShowLogin(true)}>
            Get FREED
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero__bg">
          <div className="landing-hero__orb landing-hero__orb--1" />
          <div className="landing-hero__orb landing-hero__orb--2" />
        </div>
        <div className="landing-hero__content">
          <div className="landing-hero__icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="#E8732A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="landing-hero__title">
            No more Unmanageable Debt, Only <span>FREEDOM</span>
          </h1>
          <p className="landing-hero__subtitle">
            India's first and most trusted debt relief platform
          </p>
          <button className="landing-hero__btn" onClick={() => setShowLogin(true)}>
            Get Debt Free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </section>

      {/* Check Credit Score Section */}
      <section className="landing-credit">
        <h2 className="landing-credit__title">Check Free<br />Credit Score</h2>
        <div className="landing-credit__form">
          <div className="landing-credit__row">
            <input
              className="landing-credit__input"
              placeholder="First Name"
              value={firstName}
              onChange={e => { setFirstName(e.target.value); setScoreError(''); }}
            />
            <input
              className="landing-credit__input"
              placeholder="Last Name"
              value={lastName}
              onChange={e => { setLastName(e.target.value); setScoreError(''); }}
            />
          </div>
          {scoreError && (
            <p className="landing-credit__error">{scoreError}</p>
          )}
          <button
            className="landing-credit__btn"
            onClick={handleViewScore}
            disabled={scoreLoading}
          >
            {scoreLoading ? 'Looking up...' : 'View My Credit Score'}
            {!scoreLoading && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="landing-stats">
        {stats.map(s => (
          <div key={s.label} className="landing-stats__item">
            <div className="landing-stats__value">{s.value}</div>
            <div className="landing-stats__label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Featured In */}
      <section className="landing-featured">
        <p className="landing-featured__label">Featured In</p>
        <div className="landing-featured__logos">
          <span>THE TIMES OF INDIA</span>
          <span>The Economic Times</span>
          <span>CNBC</span>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer__powered">
          Powered by <img src="/assets/freed-logo.png" alt="FREED" height="18" style={{ filter: 'brightness(0) invert(1)', verticalAlign: 'middle', marginLeft: 4 }} />
        </div>
        <div className="landing-footer__links">
          <span>🔒 No Spam. Safe.</span>
        </div>
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
