import type { User } from '../../../types';
import CreditScoreChart from '../CreditScoreChart';
import CreditScoreGauge from '../CreditScoreGauge';
import './HomeTab.css';

interface HomeTabProps {
  user: User;
}

function getScoreLevel(score: number | null): string {
  if (!score) return '';
  if (score >= 750) return 'Excellent';
  if (score >= 700) return 'Good';
  if (score >= 650) return 'Fair';
  if (score >= 550) return 'Rebuilding';
  return 'Critical';
}

export default function HomeTab({ user }: HomeTabProps) {
  const seg = user.segment;
  const scoreLevel = getScoreLevel(user.creditScore);

  return (
    <div className="home-tab">
      {/* Credit Score Section */}
      <section className="home-tab__section" id="credit-score">
        {(seg === 'DEP' || seg === 'DCP_Eligible' || seg === 'DCP_Ineligible' || seg === 'NTC' || seg === 'Others') ? (
          <CreditScoreChart score={user.creditScore} />
        ) : (
          <CreditScoreGauge score={user.creditScore} />
        )}
      </section>

      {/* Elite Credit Club - for high scores */}
      {user.creditScore && user.creditScore >= 750 && (
        <section className="home-tab__elite">
          <div className="elite-card">
            <div className="elite-card__header">
              <strong>Elite Credit Club</strong>
              <span className="elite-card__powered">Powered by <strong>experian</strong></span>
            </div>
            <p className="elite-card__text">
              A level only ~10% achieve. This score unlocks access to the best interest rates and premium credit offers.
            </p>
            <span className="elite-card__date">Last updated: {user.creditPull?.pulledDate || 'Recently'}</span>
          </div>
        </section>
      )}

      {/* Score context card for non-elite scores */}
      {user.creditScore && user.creditScore < 750 && (
        <section className="home-tab__score-context">
          <div className="score-context-card">
            <div className="score-context-card__header">
              <strong>{scoreLevel} Score</strong>
              <span className="score-context-card__powered">Powered by <strong>experian</strong></span>
            </div>
            <p className="score-context-card__text">
              {user.creditScore >= 700
                ? "You're on a great track! A few improvements could unlock even better offers."
                : user.creditScore >= 650
                  ? "Your score is fair. With some focused steps, you can move into the good range."
                  : "Let's work together to improve your score. Small changes can make a big difference."
              }
            </p>
            <span className="score-context-card__date">Last updated: {user.creditPull?.pulledDate || 'Recently'}</span>
          </div>
        </section>
      )}

      {/* NTC - No Credit Score Special Section */}
      {seg === 'NTC' && (
        <section className="home-tab__ntc">
          <div className="ntc-hero">
            <div className="ntc-hero__content">
              <h2 className="ntc-hero__title">No score doesn't mean no story, it just hasn't started yet.</h2>
              <div className="ntc-hero__illustration">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <path d="M40 10L44 30H60L48 42L52 62L40 52L28 62L32 42L20 30H36L40 10Z" fill="#E8732A" opacity="0.2"/>
                  <path d="M35 70V20L40 5L45 20V70H35Z" fill="var(--freed-navy)" opacity="0.3"/>
                  <circle cx="40" cy="18" r="6" fill="var(--freed-orange)"/>
                  <path d="M30 65L40 45L50 65" fill="var(--freed-orange)" opacity="0.5"/>
                </svg>
              </div>
            </div>
            <button className="ntc-hero__btn">
              Refresh Score
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          <div className="ntc-tips">
            <div className="ntc-tips__header">
              <span className="ntc-tips__star">✦</span>
              <strong>Building Credit for the First Time</strong>
              <span className="ntc-tips__star">✦</span>
            </div>
            <p className="ntc-tips__sub">What you need to know</p>

            <div className="ntc-tips__list">
              <div className="ntc-tip">
                <div className="ntc-tip__icon">🤝</div>
                <div>
                  <strong>Apply with a Co-Applicant or Guarantor</strong>
                  <p>If you have no credit history, applying for a loan or credit card with someone who has a strong credit score can improve your chances of approval.</p>
                </div>
              </div>
              <div className="ntc-tip">
                <div className="ntc-tip__icon">💳</div>
                <div>
                  <strong>Use a Secured Credit Card</strong>
                  <p>A secured credit card backed by a fixed deposit (FD) is a great way to build credit. These cards have lower interest rates and are designed for those with little or no credit history.</p>
                </div>
              </div>
              <div className="ntc-tip">
                <div className="ntc-tip__icon">📄</div>
                <div>
                  <strong>Opt for Personal or Micro Loans</strong>
                  <p>Taking small, low-interest loans (₹5K - ₹20K) and repaying them on time helps establish a positive credit history.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Smart Credit Analysis - DEP/DRP */}
      {(seg === 'DEP' || seg === 'DRP_Eligible' || seg === 'DRP_Ineligible') && (
        <section className="home-tab__section">
          <h3 className="home-tab__heading">Smart Credit Analysis</h3>
          <div className="credit-analysis-cards">
            <div className="analysis-card analysis-card--wrap">
              <span className="analysis-card__label">Your 2025</span>
              <strong className="analysis-card__title">CREDIT<br/>WRAP</strong>
              <div className="analysis-card__visual">
                <div className="analysis-card__donut" />
              </div>
            </div>
            <div className="analysis-card analysis-card--snapshot">
              <span className="analysis-card__label">Monthly</span>
              <strong className="analysis-card__title">CREDIT<br/>SNAPSHOTS</strong>
              <div className="analysis-card__visual">
                <div className="analysis-card__bars">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 6-Month Boost Journey */}
      {(seg === 'DEP' || seg === 'DRP_Eligible' || seg === 'DRP_Ineligible') && user.creditScore && (
        <section className="home-tab__section">
          <h3 className="home-tab__heading">Let's Boost Your Score</h3>
          <p className="home-tab__subheading">Better score. Lower interest. Smarter you</p>
          <div className="boost-journey">
            <div className="boost-journey__header">
              <span>Your 6-Month Boost Journey</span>
              <span className="boost-journey__points">+27 Points*</span>
            </div>
            <div className="boost-journey__chart">
              <div className="boost-journey__y-axis">
                <span>{Math.min(user.creditScore + 50, 900)}</span>
                <span>{user.creditScore}</span>
                <span>{Math.max(user.creditScore - 50, 300)}</span>
              </div>
              <div className="boost-journey__line">
                <svg viewBox="0 0 280 80" preserveAspectRatio="none">
                  <path d="M0 60 Q40 55 70 50 T140 35 T210 20 T280 10" stroke="#10B981" strokeWidth="2.5" fill="none" />
                  <circle cx="70" cy="50" r="4" fill="var(--freed-navy)" />
                </svg>
              </div>
              <div className="boost-journey__months">
                <span>JAN</span><span>FEB</span><span>MAR</span><span>APR</span><span>MAY</span><span>JUN</span><span>JUL</span>
              </div>
            </div>
            <div className="boost-journey__swipe">
              <span className="boost-journey__arrows">&raquo;&raquo;&raquo;</span>
              Swipe to see how
            </div>
          </div>
        </section>
      )}

      {/* DRP-specific: Settlement Overview */}
      {seg === 'DRP_Eligible' && (
        <section className="home-tab__section">
          <div className="drp-status-banner">
            <div className="drp-status-banner__item">
              <span className="drp-status-banner__label">Debt Free In</span>
              <strong className="drp-status-banner__value">34 Months</strong>
            </div>
            <div className="drp-status-banner__item">
              <span className="drp-status-banner__label">Account Settled</span>
              <strong className="drp-status-banner__value">0 <span>/4</span></strong>
            </div>
          </div>

          <div className="drp-savings-card">
            <h3>Break Free from Debt</h3>
            <p className="drp-savings-card__amount">Save up to</p>
            <div className="drp-savings-card__percent">50%</div>
            <p className="drp-savings-card__sub">on your total outstanding debt</p>
          </div>
        </section>
      )}

      {/* Quick Actions - for identified users */}
      {(seg === 'DRP_Eligible' || seg === 'DRP_Ineligible' || seg === 'DEP') && (
        <section className="home-tab__section">
          <h3 className="home-tab__heading">Quick Actions</h3>
          <div className="quick-actions">
            <div className="quick-action-card">
              <span className="quick-action-card__title">Upcoming Payment</span>
              <strong className="quick-action-card__value">
                ₹{user.monthlyObligation ? user.monthlyObligation.toLocaleString('en-IN') : '---'}
              </strong>
              <span className="quick-action-card__sub">Next due</span>
            </div>
            <div className="quick-action-card">
              <span className="quick-action-card__title">Credit Score</span>
              <strong className="quick-action-card__value quick-action-card__value--score">
                {user.creditScore || '---'}
              </strong>
              <span className="quick-action-card__sub">
                Last Updated: {user.creditPull?.pulledDate?.split(',')[0] || 'N/A'}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Others - credit overview */}
      {seg === 'Others' && (
        <section className="home-tab__section">
          <div className="others-hero">
            <h2>Awesome! We have your credit report</h2>
            <p>Let's see how you're doing and explore ways to improve your financial health.</p>
          </div>
          <div className="others-stats">
            <div className="others-stat">
              <span className="others-stat__label">Active Accounts</span>
              <strong className="others-stat__value">{user.creditPull?.accountsActiveCount || 0}</strong>
            </div>
            <div className="others-stat">
              <span className="others-stat__label">Total Outstanding</span>
              <strong className="others-stat__value">
                ₹{user.creditPull?.accountsTotalOutstanding
                  ? (user.creditPull.accountsTotalOutstanding / 100000).toFixed(1) + 'L'
                  : '0'}
              </strong>
            </div>
          </div>
        </section>
      )}

      {/* FREED Pulse - Bottom CTA */}
      <section className="home-tab__section">
        <div className="pulse-cta">
          <div className="pulse-cta__header">
            <span className="pulse-cta__your">YOUR</span>
            <strong className="pulse-cta__pulse">Pulse</strong>
          </div>
          <p className="pulse-cta__sub">BY FREED INTELLIGENCE</p>
          <p className="pulse-cta__desc">
            Get tailored tips from your credit data and see how lenders view you.
          </p>
        </div>
      </section>

      {/* Bottom spacer for bottom nav */}
      <div style={{ height: 80 }} />
    </div>
  );
}
