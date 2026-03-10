import Navbar from './Navbar';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="pwa-layout">
      <Navbar />
      <main className="pwa-main">{children}</main>
      <footer className="pwa-footer">
        <p>&copy; 2026 FREED. Your partner for debt freedom.</p>
      </footer>
    </div>
  );
}
