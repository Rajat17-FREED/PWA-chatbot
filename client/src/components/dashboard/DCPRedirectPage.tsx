import { useDashboard } from '../../context/DashboardContext';
import { useAuth } from '../../context/AuthContext';
import './DCPRedirectPage.css';

function formatINR(amount: number | null | undefined): string {
  if (!amount || amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function getScoreState(score: number | null) {
  if (!score) {
    return { title: 'Builds confidence', subtitle: 'Start with one planned repayment track.', accent: '#94A3B8' };
  }
  if (score >= 750) {
    return { title: 'Looks strong', subtitle: 'You are in a good place to simplify your EMIs.', accent: '#14B8A6' };
  }
  if (score >= 700) {
    return { title: 'Is improving', subtitle: 'A simpler EMI structure can reduce monthly stress.', accent: '#1D4ED8' };
  }
  if (score >= 650) {
    return { title: 'Needs Improving', subtitle: 'Managing too many EMIs can be stressful.', accent: '#EF4444' };
  }
  return { title: 'Needs urgent care', subtitle: 'Reducing EMI overload can help stabilise your profile.', accent: '#EF4444' };
}

function calculateNewEMI(totalOutstanding: number | null): number {
  if (!totalOutstanding || totalOutstanding <= 0) return 0;
  const monthlyRate = 0.1 / 12;
  const tenureMonths = 60;
  const emi =
    (totalOutstanding * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
    (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  return Math.round(emi);
}

function CompactScoreRing({ score }: { score: number | null }) {
  const boundedScore = score ? Math.max(300, Math.min(900, score)) : 300;
  const percent = ((boundedScore - 300) / 600) * 100;
  const accent =
    boundedScore >= 750 ? '#16A34A' :
    boundedScore >= 700 ? '#22C55E' :
    boundedScore >= 650 ? '#F97316' :
    '#EF4444';

  return (
    <div className="dcp-page__score-ring">
      <div
        className="dcp-page__score-ring-track"
        style={{ background: `conic-gradient(${accent} ${percent}%, #F6DAD4 ${percent}% 100%)` }}
      >
        <div className="dcp-page__score-ring-core">
          <strong>{score ?? '---'}</strong>
          <span>Powered by Experian</span>
        </div>
      </div>
    </div>
  );
}

export default function DCPRedirectPage() {
  const { setCurrentView } = useDashboard();
  const { user } = useAuth();

  if (!user) return null;

  const scoreState = getScoreState(user.creditScore);
  const unsecuredOutstanding = user.creditPull?.unsecuredAccountsTotalOutstanding ?? 0;
  const totalOutstanding = user.creditPull?.accountsTotalOutstanding ?? 0;
  const currentMonthlyEmi = user.monthlyObligation ?? 0;
  const newMonthlyEmi = calculateNewEMI(unsecuredOutstanding || totalOutstanding);
  const savings = Math.max(0, currentMonthlyEmi - newMonthlyEmi);

  const highInterestAccounts = [...(user.accountHighlights || [])]
    .filter(account => account.category !== 'secured')
    .sort((a, b) => {
      const rateDiff = (b.interestRate ?? 0) - (a.interestRate ?? 0);
      if (rateDiff !== 0) return rateDiff;
      return (b.outstandingAmount ?? 0) - (a.outstandingAmount ?? 0);
    })
    .slice(0, 3);
  const displayedAccounts = highInterestAccounts.length > 0
    ? highInterestAccounts
    : [
        {
          id: 'summary-unsecured',
          lenderName: 'Unsecured Balances',
          debtType: `${user.creditPull?.accountsActiveCount ?? 0} active account${(user.creditPull?.accountsActiveCount ?? 0) === 1 ? '' : 's'}`,
          outstandingAmount: unsecuredOutstanding || totalOutstanding,
          interestRate: null,
        },
      ];

  const currentBarHeight = Math.max(40, Math.min(120, currentMonthlyEmi / 550));
  const newBarHeight = Math.max(32, Math.min(120, newMonthlyEmi / 550));

  return (
    <div className="dcp-page">
      <div className="dcp-page__topbar">
        <img src="/assets/freed-logo.png" alt="FREED" className="dcp-page__logo" />
        <div className="dcp-page__user-pill">
          <strong>{user.firstName} {user.lastName}</strong>
          <span>ID: {user.leadRefId.slice(-6)}</span>
        </div>
      </div>

      <section className="dcp-page__hero-card">
        <div className="dcp-page__hero-copy">
          <p className="dcp-page__eyebrow">Hey {user.firstName}, Your Credit</p>
          <h1 className="dcp-page__hero-title" style={{ color: scoreState.accent }}>
            {scoreState.title}
          </h1>
          <p className="dcp-page__hero-subtitle">{scoreState.subtitle}</p>
        </div>
        <CompactScoreRing score={user.creditScore} />
      </section>

      <section className="dcp-page__focus-card">
        <div className="dcp-page__sparkle-row" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2 className="dcp-page__section-title">Consolidate Your Loans</h2>
        <p className="dcp-page__section-subtitle">One loan. One EMI. One Due Date.</p>
        <div className="dcp-page__savings-copy">
          <span>Reduce your EMI by</span>
          <strong>{formatINR(savings)}</strong>
          <small>On your monthly payments</small>
        </div>
      </section>

      <section className="dcp-page__comparison-card">
        <div className="dcp-page__comparison-copy">
          <span className="dcp-page__comparison-label">New Monthly EMI</span>
          <small>After consolidation</small>
          <strong className="dcp-page__comparison-value">{formatINR(newMonthlyEmi)}</strong>
        </div>

        <div className="dcp-page__bars" aria-hidden="true">
          <div className="dcp-page__bar-group">
            <div className="dcp-page__bar dcp-page__bar--current" style={{ height: `${currentBarHeight}px` }} />
            <span>Current EMI</span>
            <strong>{formatINR(currentMonthlyEmi)}</strong>
          </div>
          <div className="dcp-page__bar-group">
            <div className="dcp-page__bar dcp-page__bar--new" style={{ height: `${newBarHeight}px` }} />
            <span>EMI after consolidation</span>
            <strong>{formatINR(newMonthlyEmi)}</strong>
          </div>
        </div>

        <p className="dcp-page__comparison-note">
          *Monthly payment is estimated using your current total outstanding and a structured 60-month repayment plan.
        </p>
      </section>

      <section className="dcp-page__accounts">
        <div className="dcp-page__section-head">
          <span className="dcp-page__alert" aria-hidden="true">!</span>
          <div>
            <h3>Accounts with High Interest</h3>
            <p>{highInterestAccounts.length || user.creditPull?.accountsActiveCount || 0} credit accounts adding pressure to your monthly budget</p>
          </div>
        </div>

        <div className="dcp-page__account-list">
          {displayedAccounts.map(account => (
            <article key={account.id} className="dcp-page__account-row">
              <div className="dcp-page__account-avatar">{account.lenderName.slice(0, 1)}</div>
              <div className="dcp-page__account-copy">
                <strong>{account.lenderName}</strong>
                <span>
                  {account.debtType || 'Loan Account'}
                  {'interestRate' in account && account.interestRate ? `  •  ${account.interestRate.toFixed(1)}% ROI` : ''}
                </span>
              </div>
              <div className="dcp-page__account-values">
                <span>{formatINR(account.outstandingAmount)}</span>
                <small>Outstanding</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="dcp-page__support-card">
        <h3>Your Journey, our Support</h3>
        <div className="dcp-page__support-stats">
          <div>
            <strong>100 Cr+</strong>
            <span>Debt Enrolled</span>
          </div>
          <div className="dcp-page__support-divider" />
          <div>
            <strong>10,000+</strong>
            <span>Happy Customers</span>
          </div>
        </div>
        <div className="dcp-page__support-points">
          <p>One monthly payment instead of many</p>
          <p>Potentially lower EMI pressure on your cash flow</p>
          <p>Clearer repayment rhythm for your credit profile</p>
        </div>
      </section>

      <div className="dcp-page__footer">
        <button type="button" className="dcp-page__cta">Get Personalised Plan</button>
        <button type="button" className="dcp-page__secondary" onClick={() => setCurrentView('dashboard')}>
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
