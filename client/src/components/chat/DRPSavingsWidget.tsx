import { useAuth } from '../../context/AuthContext';
import './DRPSavingsWidget.css';

function formatINR(amount: number): string {
  if (amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

interface DRPSavingsWidgetProps {
  totalDebt: number;
  settlementAmount: number;
  savings: number;
  debtFreeMonths: number;
}

export default function DRPSavingsWidget({
  totalDebt,
  settlementAmount,
  savings,
  debtFreeMonths,
}: DRPSavingsWidgetProps) {
  const { user, isLoggedIn } = useAuth();

  const maxBarHeight = 100;
  const withBarHeight = totalDebt > 0 ? Math.round((settlementAmount / totalDebt) * maxBarHeight) : 60;

  const handleClick = () => {
    if (isLoggedIn && user && user.segment === 'DRP_Eligible') {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'drp-redirect' } }));
    } else {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'paywall' } }));
    }
    window.dispatchEvent(new CustomEvent('freed-close-chat'));
  };

  return (
    <div className="drp-widget">
      <div className="drp-widget__header">
        <div className="drp-widget__headline">
          SETTLE & SAVE UPTO <span>50%</span>
        </div>
      </div>

      <div className="drp-widget__body">
        <div className="drp-widget__left">
          <div className="drp-widget__savings-label">Your Savings on Debt</div>
          <div className="drp-widget__savings-amount">{formatINR(savings)}*</div>
          <div className="drp-widget__divider" />
          <div className="drp-widget__debt-free-label">Debt Free In</div>
          <div className="drp-widget__debt-free-months">{debtFreeMonths} Months</div>
        </div>

        <div className="drp-widget__bars">
          <div className="drp-widget__bar-col">
            <div className="drp-widget__bar-amount">{formatINR(totalDebt)}</div>
            <div
              className="drp-widget__bar-visual drp-widget__bar-visual--without"
              style={{ height: `${maxBarHeight}px` }}
            >
              <span className="drp-widget__bar-emoji">😣</span>
            </div>
            <div className="drp-widget__bar-label">Repayment<br />Without FREED</div>
          </div>

          <div className="drp-widget__bar-col">
            <div className="drp-widget__bar-amount">{formatINR(settlementAmount)}*</div>
            <div
              className="drp-widget__bar-visual drp-widget__bar-visual--with"
              style={{ height: `${withBarHeight}px` }}
            >
              <span className="drp-widget__bar-emoji">😌</span>
            </div>
            <div className="drp-widget__bar-label">Repayment<br />With FREED</div>
          </div>
        </div>
      </div>

      <div className="drp-widget__tagline">
        <span className="drp-widget__tagline-line" />
        <span>India&apos;s 1<sup>st</sup> Debt Settlement Company</span>
        <span className="drp-widget__tagline-line" />
      </div>

      <button type="button" className="drp-widget__cta" onClick={handleClick}>
        Start Now <span className="drp-widget__cta-icon">✈</span>
      </button>
    </div>
  );
}
