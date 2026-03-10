import { useAuth } from '../../context/AuthContext';
import './SideMenu.css';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SideMenu({ isOpen, onClose }: SideMenuProps) {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();

  const handleLogout = () => {
    logout();
    onClose();
  };

  return (
    <>
      <div
        className={`side-menu-overlay ${isOpen ? 'side-menu-overlay--visible' : ''}`}
        onClick={onClose}
      />
      <aside className={`side-menu ${isOpen ? 'side-menu--open' : ''}`}>
        <div className="side-menu__header">
          <button className="side-menu__back" onClick={onClose} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="side-menu__title">Account Details</span>
        </div>

        <div className="side-menu__profile">
          <div className="side-menu__avatar">{initials}</div>
          <div className="side-menu__info">
            <div className="side-menu__name">{user.firstName} {user.lastName}</div>
            <div className="side-menu__meta">{user.segment.replace('_', ' ')}</div>
          </div>
        </div>

        <div className="side-menu__subscription">
          <div className="side-menu__sub-row">
            <span className="side-menu__sub-label">Premium</span>
            <span className="side-menu__sub-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Pulse
            </span>
          </div>
          <p className="side-menu__sub-text">Your personalized credit insights are active.</p>
        </div>

        <div className="side-menu__links">
          <button className="side-menu__link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Help
            <svg className="side-menu__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="side-menu__link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Invoice
            <svg className="side-menu__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="side-menu__footer">
          <button className="side-menu__logout" onClick={handleLogout}>
            Log out
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 6 }}>
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className="side-menu__version">App Version 1.0.0<br />&copy; FREED.care</p>
        </div>
      </aside>
    </>
  );
}
