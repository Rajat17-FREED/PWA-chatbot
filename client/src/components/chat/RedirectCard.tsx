import { useAuth } from '../../context/AuthContext';
import './RedirectCard.css';

// Map old route URLs to dashboard tab actions
const REDIRECT_TAB_MAP: Record<string, string> = {
  '/dep': 'program',
  '/drp': 'program',
  '/dcp': 'program',
  '/credit-score': 'home',
  '/goal-tracker': 'savings',
  '/freed-shield': 'shield',
  '/dispute': 'shield',
};

interface RedirectCardProps {
  url: string;
  label: string;
}

export default function RedirectCard({ url, label }: RedirectCardProps) {
  const { isLoggedIn } = useAuth();

  const handleClick = () => {
    if (url.startsWith('/')) {
      if (isLoggedIn) {
        // Dispatch a custom event that the Dashboard listens for
        const tab = REDIRECT_TAB_MAP[url] || 'home';
        window.dispatchEvent(new CustomEvent('freed-switch-tab', { detail: { tab } }));
      }
      // Minimize the chat panel so the user can see the screen behind
      window.dispatchEvent(new CustomEvent('freed-close-chat'));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button className="freed-redirect-card" onClick={handleClick}>
      <span className="freed-redirect-card__label">{label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="freed-redirect-card__icon">
        <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
