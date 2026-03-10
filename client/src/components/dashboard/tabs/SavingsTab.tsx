import type { User } from '../../../types';
import './SavingsTab.css';

interface SavingsTabProps {
  user: User;
}

export default function SavingsTab({ user }: SavingsTabProps) {
  const seg = user.segment;
  const outstanding = user.creditPull?.accountsTotalOutstanding || 0;
  const unsecured = user.creditPull?.unsecuredAccountsTotalOutstanding || 0;

  // Calculate estimated savings based on segment
  const interestSaved = seg === 'DEP'
    ? Math.round(outstanding * 0.15)
    : seg === 'DRP_Eligible'
    ? Math.round(unsecured * 0.5)
    : Math.round(outstanding * 0.1);

  return (
    <div className="savings-tab">
      {/* Payoff Plan Header */}
      {(seg === 'DEP' || seg === 'DRP_Eligible' || seg === 'DRP_Ineligible') && (
        <section className="savings-tab__section">
          <div className="savings-tab__plan-header">
            <h2>Your Payoff Plan</h2>
            <button className="savings-tab__view-plan">View Plan</button>
          </div>

          <div className="savings-cards">
            <div className="savings-card savings-card--saved">
              <span className="savings-card__label">Interest Saved:</span>
              <strong className="savings-card__value">₹{(interestSaved / 1000).toFixed(0)}K</strong>
              <div className="savings-card__icon">💰</div>
            </div>
            <div className="savings-card savings-card--outstanding">
              <span className="savings-card__label">Current Outstanding:</span>
              <strong className="savings-card__value">₹{(outstanding / 1000).toFixed(0)}K</strong>
              <div className="savings-card__icon">📊</div>
            </div>
          </div>
        </section>
      )}

      {/* Monthly Target */}
      {seg === 'DEP' && (
        <section className="savings-tab__section">
          <div className="monthly-target">
            <div className="monthly-target__header">
              <h3>This Month's Target</h3>
              <span className="monthly-target__month">
                {new Date().toLocaleString('en-IN', { month: 'long' })}
              </span>
            </div>
            <p className="monthly-target__sub">Recommended Extra Payments</p>

            <div className="monthly-target__items">
              <div className="monthly-target__item">
                <div className="monthly-target__bank">
                  <div className="monthly-target__bank-icon">🏦</div>
                  <div>
                    <strong>HDFC Bank</strong>
                    <span>CC - XXXX 5007</span>
                  </div>
                </div>
                <strong className="monthly-target__amount">₹25,000</strong>
              </div>
              <div className="monthly-target__item">
                <div className="monthly-target__bank">
                  <div className="monthly-target__bank-icon">🏦</div>
                  <div>
                    <strong>ICICI Bank</strong>
                    <span>CC - XXXX 3021</span>
                  </div>
                </div>
                <strong className="monthly-target__amount">₹15,000</strong>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* DRP Settlement Progress */}
      {seg === 'DRP_Eligible' && (
        <section className="savings-tab__section">
          <div className="settlement-card">
            <h3>First Account Settlement</h3>
            <div className="settlement-card__bank">
              <div className="settlement-card__bank-icon">🏦</div>
              <div>
                <strong>ICICI Bank</strong>
                <span>CC - XXXX 0234</span>
              </div>
              <div className="settlement-card__date">
                Settlement By<br/>
                <strong>🏆 April 2025</strong>
              </div>
            </div>

            <div className="settlement-card__details">
              <div className="settlement-card__detail">
                <span>Outstanding Amount</span>
                <strong>₹{outstanding > 0 ? (outstanding / 1000).toFixed(0) + 'K' : '50,000'}</strong>
              </div>
              <div className="settlement-card__detail">
                <span>Last Paid</span>
                <strong>23-Aug-2023</strong>
              </div>
              <div className="settlement-card__detail">
                <span>Payment via FREED</span>
                <strong className="settlement-card__freed-amount">₹25,000</strong>
              </div>
            </div>

            <div className="settlement-card__timeline">
              <div className="settlement-card__timeline-dots">
                {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG'].map((m, i) => (
                  <div key={m} className="settlement-card__timeline-step">
                    <div className={`settlement-card__dot ${i < 2 ? 'settlement-card__dot--done' : i === 7 ? 'settlement-card__dot--goal' : ''}`} />
                    <span>{m}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="settlement-card__footer">
              <span>Amount Remaining for settlement: ₹25,000</span>
              <button className="settlement-card__link">View Details &rsaquo;</button>
            </div>
          </div>
        </section>
      )}

      {/* DCP / NTC / Others - Educational content */}
      {(seg === 'DCP_Eligible' || seg === 'DCP_Ineligible' || seg === 'NTC' || seg === 'Others') && (
        <section className="savings-tab__section">
          <div className="savings-edu">
            <h3>Understanding Your Financial Health</h3>
            <p>Here's how your finances are shaping up and ways to improve.</p>

            <div className="savings-edu__cards">
              <div className="savings-edu__card">
                <span className="savings-edu__card-icon">📊</span>
                <strong>FOIR Ratio</strong>
                <p className="savings-edu__card-value">
                  {user.foirPercentage ? `${user.foirPercentage}%` : 'N/A'}
                </p>
                <p className="savings-edu__card-desc">
                  {user.foirPercentage && user.foirPercentage > 50
                    ? 'Your obligations are high. Consider reducing EMIs.'
                    : 'Your debt-to-income ratio is healthy!'}
                </p>
              </div>
              <div className="savings-edu__card">
                <span className="savings-edu__card-icon">💰</span>
                <strong>Monthly Income</strong>
                <p className="savings-edu__card-value">
                  ₹{user.monthlyIncome ? user.monthlyIncome.toLocaleString('en-IN') : 'N/A'}
                </p>
                <p className="savings-edu__card-desc">
                  {user.monthlyObligation
                    ? `₹${user.monthlyObligation.toLocaleString('en-IN')} goes to EMIs`
                    : 'No active obligations found'}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Outstanding Change Alert */}
      {outstanding > 0 && seg === 'DEP' && (
        <section className="savings-tab__section">
          <div className="outstanding-alert">
            <span>Your Total Outstanding has changed</span>
            <p>Recalculate your plan</p>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </section>
      )}

      <div style={{ height: 80 }} />
    </div>
  );
}
