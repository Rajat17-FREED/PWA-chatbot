import { useAuth } from '../../context/AuthContext';
import './DEPSavingsWidget.css';

function formatINR(amount: number): string {
  if (amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

interface DEPSavingsWidgetProps {
  interestWithout: number;
  interestWith: number;
  interestSaved: number;
  debtFreeMonths: number;
}

export default function DEPSavingsWidget({
  interestWithout,
  interestWith,
  interestSaved,
  debtFreeMonths,
}: DEPSavingsWidgetProps) {
  const { user, isLoggedIn } = useAuth();

  const maxBarHeight = 100;
  const withBarHeight = interestWithout > 0 ? Math.round((interestWith / interestWithout) * maxBarHeight) : 60;

  const handleClick = () => {
    if (isLoggedIn && user && user.segment === 'DEP') {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'dep-redirect' } }));
    } else {
      window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view: 'paywall' } }));
    }
    window.dispatchEvent(new CustomEvent('freed-close-chat'));
  };

  return (
    <div className="dep-widget">
      <div className="dep-widget__header">
        <div className="dep-widget__headline">
          ELIMINATE YOUR DEBT FASTER
        </div>
      </div>

      <div className="dep-widget__body">
        <div className="dep-widget__left">
          <div className="dep-widget__savings-label">Save Interest Upto</div>
          <div className="dep-widget__savings-amount">{formatINR(interestSaved)}*</div>
          <div className="dep-widget__divider" />
          <div className="dep-widget__months-label">In Just</div>
          <div className="dep-widget__months-amount">{debtFreeMonths} Months</div>
        </div>

        <div className="dep-widget__bars">
          <div className="dep-widget__bar-col">
            <div className="dep-widget__bar-amount">{formatINR(interestWithout)}</div>
            <div
              className="dep-widget__bar-visual dep-widget__bar-visual--without"
              style={{ height: `${maxBarHeight}px` }}
            >
              <span className="dep-widget__bar-emoji">😣</span>
            </div>
            <div className="dep-widget__bar-label">Interest Paid<br />Without FREED</div>
          </div>

          <div className="dep-widget__bar-col">
            <div className="dep-widget__bar-amount">{formatINR(interestWith)}*</div>
            <div
              className="dep-widget__bar-visual dep-widget__bar-visual--with"
              style={{ height: `${withBarHeight}px` }}
            >
              <span className="dep-widget__bar-emoji">😌</span>
            </div>
            <div className="dep-widget__bar-label">Interest Paid<br />With FREED</div>
          </div>
        </div>
      </div>

      <div className="dep-widget__tagline">
        <span className="dep-widget__tagline-line" />
        <span>India&apos;s 1<sup>st</sup> Debt Relief Company</span>
        <span className="dep-widget__tagline-line" />
      </div>

      <button type="button" className="dep-widget__cta" onClick={handleClick}>
        Start Now <span className="dep-widget__cta-icon">✈</span>
      </button>
    </div>
  );
}
