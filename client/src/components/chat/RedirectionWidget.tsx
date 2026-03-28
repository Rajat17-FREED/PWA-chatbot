import { useAuth } from '../../context/AuthContext';
import type { Segment } from '../../types';
import './RedirectionWidget.css';

interface WidgetConfig {
  imageSrc: string;
  imageAlt: string;
}

const WIDGET_CONFIGS: Record<string, WidgetConfig> = {
  '/goal-tracker': {
    imageSrc: '/assets/ci/widgets/goal-tracker.png',
    imageAlt: 'Goal tracker redirection card',
  },
  '/dep': {
    imageSrc: '/assets/ci/widgets/payment-reminder.png',
    imageAlt: 'Payment reminder redirection card',
  },
  '/credit-score': {
    imageSrc: '/assets/ci/widgets/credit-report.png',
    imageAlt: 'Credit report redirection card',
  },
  '/dcp': {
    imageSrc: '/assets/ci/widgets/consolidation-program.png',
    imageAlt: 'Debt consolidation redirection card',
  },
  '/drp': {
    imageSrc: '/assets/ci/widgets/settlement-program.png',
    imageAlt: 'Debt settlement redirection card',
  },
  '/freed-shield': {
    imageSrc: '/assets/ci/widgets/freed-shield.png',
    imageAlt: 'FREED Shield redirection card',
  },
};

// Routes that always go to paywall regardless of segment
const ALWAYS_PAYWALL_ROUTES = ['/freed-shield', '/credit-score', '/goal-tracker', '/dep'];

function getViewForRedirect(url: string, segment: Segment): string {
  if (ALWAYS_PAYWALL_ROUTES.includes(url)) return 'paywall';
  if (url === '/dcp' && segment === 'DCP_Eligible') return 'dcp-redirect';
  if (url === '/drp' && segment === 'DRP_Eligible') return 'drp-redirect';
  return 'paywall';
}

interface RedirectionWidgetProps {
  url: string;
  label: string;
}

export default function RedirectionWidget({ url, label }: RedirectionWidgetProps) {
  const { user, isLoggedIn } = useAuth();
  const config = WIDGET_CONFIGS[url];

  const handleClick = () => {
    if (url.startsWith('/')) {
      if (isLoggedIn && user) {
        const view = getViewForRedirect(url, user.segment);
        window.dispatchEvent(new CustomEvent('freed-open-view', { detail: { view } }));
      }
      window.dispatchEvent(new CustomEvent('freed-close-chat'));
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!config) {
    return (
      <button type="button" className="rw rw--fallback" onClick={handleClick}>
        <span>{label}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12H19M19 12L12 5M19 12L12 19"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="rw"
      onClick={handleClick}
      aria-label={label}
    >
      <img className="rw__image" src={config.imageSrc} alt={config.imageAlt} />
      <span className="rw__sr-only">{label}</span>
    </button>
  );
}
