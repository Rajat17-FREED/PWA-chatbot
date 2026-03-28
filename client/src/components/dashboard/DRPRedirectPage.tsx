import { useMemo, useState } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { useAuth } from '../../context/AuthContext';
import './DRPRedirectPage.css';

function formatINR(amount: number | null | undefined): string {
  if (!amount || amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function getCompactScoreTone(score: number | null): { color: string; text: string } {
  if (!score) return { color: '#94A3B8', text: 'No score yet' };
  if (score >= 750) return { color: '#16A34A', text: 'Excellent' };
  if (score >= 700) return { color: '#22C55E', text: 'Good' };
  if (score >= 650) return { color: '#F97316', text: 'Fair' };
  return { color: '#EF4444', text: 'Needs attention' };
}

type AccountFilter = 'eligible' | 'ineligible';

export default function DRPRedirectPage() {
  const { setCurrentView } = useDashboard();
  const { user } = useAuth();
  const [showSettlementInfo, setShowSettlementInfo] = useState(false);
  const [activeFilter, setActiveFilter] = useState<AccountFilter>('eligible');

  if (!user) return null;

  const scoreTone = getCompactScoreTone(user.creditScore);
  const allAccounts = user.accountHighlights || [];
  const eligibleAccounts = allAccounts.filter(account => account.isSettlementEligible);
  const ineligibleAccounts = allAccounts.filter(account => !account.isSettlementEligible);
  const visibleAccounts = activeFilter === 'eligible'
    ? (eligibleAccounts.length > 0 ? eligibleAccounts : ineligibleAccounts)
    : (ineligibleAccounts.length > 0 ? ineligibleAccounts : eligibleAccounts);

  const eligibleOutstanding = useMemo(
    () => eligibleAccounts.reduce((sum, account) => sum + (account.outstandingAmount ?? 0), 0),
    [eligibleAccounts]
  );
  const unsecuredOutstanding = user.creditPull?.unsecuredAccountsTotalOutstanding ?? 0;
  const settlementBase = eligibleOutstanding || unsecuredOutstanding;
  const settlementSavings = Math.round(settlementBase * 0.5);
  const fallbackAccounts = activeFilter === 'eligible'
    ? [
        {
          id: 'eligible-summary',
          lenderName: `${user.creditPull?.accountsDelinquentCount ?? 0} Delinquent Accounts`,
          debtType: 'Summary from your latest credit pull',
          outstandingAmount: settlementBase,
          isSettlementEligible: true,
          isDelinquent: true,
        },
      ]
    : [
        {
          id: 'ineligible-summary',
          lenderName: `${Math.max((user.creditPull?.accountsActiveCount ?? 0) - (user.creditPull?.accountsDelinquentCount ?? 0), 0)} Current Accounts`,
          debtType: 'Outside the immediate settlement list',
          outstandingAmount: user.creditPull?.accountsTotalOutstanding ?? 0,
          isSettlementEligible: false,
          isDelinquent: false,
        },
      ];
  const renderedAccounts = (visibleAccounts.length > 0 ? visibleAccounts : fallbackAccounts).slice(0, 4);

  return (
    <div className="drp-page">
      <div className="drp-page__topbar">
        <button type="button" className="drp-page__back" onClick={() => setCurrentView('dashboard')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <img src="/assets/freed-logo.png" alt="FREED" className="drp-page__logo" />
        <div className="drp-page__locale-pill">V</div>
      </div>

      <div className="drp-page__progress">
        <div className="drp-page__progress-step drp-page__progress-step--active">
          <span className="drp-page__progress-dot" />
          <small>Debt Profile</small>
        </div>
        <div className="drp-page__progress-line" />
        <div className="drp-page__progress-step"><span className="drp-page__progress-dot" /></div>
        <div className="drp-page__progress-line" />
        <div className="drp-page__progress-step"><span className="drp-page__progress-dot" /></div>
        <div className="drp-page__progress-line" />
        <div className="drp-page__progress-step"><span className="drp-page__progress-dot" /></div>
      </div>

      <section className="drp-page__score-card">
        <div>
          <strong>Your Credit Score</strong>
          <span>Powered by Experian</span>
        </div>
        <div className="drp-page__score-value" style={{ color: scoreTone.color }}>
          {user.creditScore ?? '---'}
        </div>
      </section>

      <section className="drp-page__hero">
        <div className="drp-page__hero-kicker">
          <span />
          <strong>GREAT NEWS!</strong>
          <span />
        </div>
        <p className="drp-page__hero-copy">You can settle and save</p>
        <div className="drp-page__hero-amount">{formatINR(settlementSavings)}*</div>

        <button
          type="button"
          className="drp-page__settlement-trigger"
          onClick={() => setShowSettlementInfo(current => !current)}
        >
          What is settlement?
          <span className={`drp-page__settlement-chevron ${showSettlementInfo ? 'drp-page__settlement-chevron--open' : ''}`}>
            ▸
          </span>
        </button>

        {showSettlementInfo && (
          <div className="drp-page__settlement-body">
            FREED negotiates with eligible lenders so you can close delinquent unsecured debts at a reduced amount through a structured plan.
          </div>
        )}
      </section>

      <section className="drp-page__trust">
        <h2>India&apos;s 1st Loan Relief Platform</h2>
        <p>Trusted by 30K+ customers  •  Save up to 50%</p>
      </section>

      <section className="drp-page__accounts">
        <h3>Loan accounts for settlement</h3>

        <div className="drp-page__toggle">
          <button
            type="button"
            className={`drp-page__toggle-btn ${activeFilter === 'eligible' ? 'drp-page__toggle-btn--active' : ''}`}
            onClick={() => setActiveFilter('eligible')}
          >
            Eligible
          </button>
          <button
            type="button"
            className={`drp-page__toggle-btn ${activeFilter === 'ineligible' ? 'drp-page__toggle-btn--active' : ''}`}
            onClick={() => setActiveFilter('ineligible')}
          >
            Not Eligible
          </button>
        </div>

        <div className="drp-page__account-list">
          {renderedAccounts.map(account => {
            const estimatedSettlement = Math.round((account.outstandingAmount ?? 0) * 0.5);
            return (
              <article key={account.id} className="drp-page__account-card">
                <div className="drp-page__account-logo" aria-hidden="true">
                  <span />
                </div>
                <div className="drp-page__account-copy">
                  <strong>{account.lenderName}</strong>
                  <span>
                    {account.debtType || 'Loan Account'}
                    {'maxDPD' in account && account.maxDPD ? `  •  ${account.maxDPD} DPD` : ''}
                  </span>
                </div>

                {account.isSettlementEligible ? (
                  <div className="drp-page__account-values">
                    <small>Total Outstanding</small>
                    <span className="drp-page__account-strike">{formatINR(account.outstandingAmount)}</span>
                    <strong>{formatINR(estimatedSettlement)}</strong>
                  </div>
                ) : (
                  <div className="drp-page__account-values drp-page__account-values--muted">
                    <small>Status</small>
                    <strong>{account.isDelinquent ? 'Needs review' : 'Current account'}</strong>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <div className="drp-page__footer">
        <button type="button" className="drp-page__cta">Let&apos;s See How</button>
      </div>
    </div>
  );
}
