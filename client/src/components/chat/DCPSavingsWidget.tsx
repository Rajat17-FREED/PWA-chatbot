import { useAuth } from '../../context/AuthContext';
import './DCPSavingsWidget.css';

function formatINR(amount: number): string {
  if (amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

interface DCPSavingsWidgetProps {
  currentTotalEMI: number;
  consolidatedEMI: number;
  emiSavings: number;
  tenureMonths: number;
}

export default function DCPSavingsWidget({
  currentTotalEMI,
  consolidatedEMI,
  emiSavings,
}: DCPSavingsWidgetProps) {
  const { user, isLoggedIn } = useAuth();

  const maxBarHeight = 100;
  const withBarHeight = currentTotalEMI > 0 ? Math.round((consolidatedEMI / currentTotalEMI) * maxBarHeight) : 60;

  const handleClick = () => {
    if (isLoggedIn && user && user.segment === 'DCP_Eligible') {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'dcp-redirect' } }));
    } else {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'paywall' } }));
    }
    window.dispatchEvent(new CustomEvent('freed-close-chat'));
  };

  return (
    <div className="dcp-widget">
      <div className="dcp-widget__header">
        <div className="dcp-widget__headline">
          REDUCE YOUR MONTHLY EMIs BY <span>{formatINR(emiSavings)}*</span>
        </div>
      </div>

      <div className="dcp-widget__body">
        <div className="dcp-widget__left">
          <div className="dcp-widget__savings-label">Your Savings on EMI</div>
          <div className="dcp-widget__savings-amount">{formatINR(emiSavings)}*</div>
          <div className="dcp-widget__divider" />
          <div className="dcp-widget__emi-label">New Monthly EMI</div>
          <div className="dcp-widget__emi-amount">{formatINR(consolidatedEMI)}*</div>
        </div>

        <div className="dcp-widget__bars">
          <div className="dcp-widget__bar-col">
            <div className="dcp-widget__bar-amount">{formatINR(currentTotalEMI)}</div>
            <div
              className="dcp-widget__bar-visual dcp-widget__bar-visual--without"
              style={{ height: `${maxBarHeight}px` }}
            >
              <span className="dcp-widget__bar-emoji">😣</span>
            </div>
            <div className="dcp-widget__bar-label">Monthly Payment<br />Without FREED</div>
          </div>

          <div className="dcp-widget__bar-col">
            <div className="dcp-widget__bar-amount">{formatINR(consolidatedEMI)}*</div>
            <div
              className="dcp-widget__bar-visual dcp-widget__bar-visual--with"
              style={{ height: `${withBarHeight}px` }}
            >
              <span className="dcp-widget__bar-emoji">😌</span>
            </div>
            <div className="dcp-widget__bar-label">Monthly Payment<br />With FREED</div>
          </div>
        </div>
      </div>

      <div className="dcp-widget__tagline">
        <span className="dcp-widget__tagline-line" />
        <span>India&apos;s 1<sup>st</sup> Debt Relief Company</span>
        <span className="dcp-widget__tagline-line" />
      </div>

      <button type="button" className="dcp-widget__cta" onClick={handleClick}>
        Start Now <span className="dcp-widget__cta-icon">✈</span>
      </button>
    </div>
  );
}
