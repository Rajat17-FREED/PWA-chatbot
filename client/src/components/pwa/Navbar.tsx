import { Link, useLocation } from 'react-router-dom';
import './Navbar.css';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/credit-score', label: 'Credit Score' },
  { to: '/dep', label: 'DEP' },
  { to: '/dcp', label: 'DCP' },
  { to: '/drp', label: 'DRP' },
  { to: '/freed-shield', label: 'Shield' },
];

export default function Navbar() {
  const location = useLocation();

  return (
    <nav className="pwa-navbar">
      <div className="pwa-navbar__inner">
        <Link to="/" className="pwa-navbar__logo">
          <span className="pwa-navbar__logo-icon">F</span>
          <span className="pwa-navbar__logo-text">FREED</span>
        </Link>
        <div className="pwa-navbar__links">
          {navLinks.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`pwa-navbar__link ${location.pathname === link.to ? 'pwa-navbar__link--active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
