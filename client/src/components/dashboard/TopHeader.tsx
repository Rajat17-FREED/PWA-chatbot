import { useAuth } from '../../context/AuthContext';
import './TopHeader.css';

interface TopHeaderProps {
  onMenuOpen: () => void;
}

export default function TopHeader({ onMenuOpen }: TopHeaderProps) {
  const { user } = useAuth();

  return (
    <header className="top-header">
      <div className="top-header__logo">
        <img src="/assets/freed-logo.png" alt="FREED" height="28" />
      </div>
      <button className="top-header__user-pill" onClick={onMenuOpen} aria-label="Account menu">
        <div className="top-header__user-info">
          <span className="top-header__user-name">{user?.firstName} {user?.lastName}</span>
          {user?.leadRefId && (
            <span className="top-header__user-id">ID: {user.leadRefId.slice(-6)}</span>
          )}
        </div>
        <svg className="top-header__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </header>
  );
}
