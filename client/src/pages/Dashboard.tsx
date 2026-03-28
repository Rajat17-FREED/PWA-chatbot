import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { DashboardProvider, useDashboard, type TabId } from '../context/DashboardContext';
import TopHeader from '../components/dashboard/TopHeader';
import BottomNav from '../components/dashboard/BottomNav';
import SideMenu from '../components/dashboard/SideMenu';
import HomeTab from '../components/dashboard/tabs/HomeTab';
import SavingsTab from '../components/dashboard/tabs/SavingsTab';
import ProgramTab from '../components/dashboard/tabs/ProgramTab';
import ShieldTab from '../components/dashboard/tabs/ShieldTab';
import PaywallPage from '../components/dashboard/PaywallPage';
import DCPRedirectPage from '../components/dashboard/DCPRedirectPage';
import DRPRedirectPage from '../components/dashboard/DRPRedirectPage';
import './Dashboard.css';

function DashboardContent() {
  const { user } = useAuth();
  const { activeTab, setActiveTab, currentView } = useDashboard();
  const [menuOpen, setMenuOpen] = useState(false);

  // Listen for tab-switch events from RedirectCard
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setActiveTab(detail.tab as TabId);
        // Scroll to top when switching tabs
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('freed-switch-tab', handler);
    return () => window.removeEventListener('freed-switch-tab', handler);
  }, [setActiveTab]);

  if (!user) return null;

  const isOverlayView = currentView !== 'dashboard';

  const renderOverlay = () => {
    switch (currentView) {
      case 'paywall':
        return <PaywallPage />;
      case 'dcp-redirect':
        return <DCPRedirectPage />;
      case 'drp-redirect':
        return <DRPRedirectPage />;
      default:
        return null;
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'home':
        return <HomeTab user={user} />;
      case 'savings':
        return <SavingsTab user={user} />;
      case 'program':
        return <ProgramTab user={user} />;
      case 'shield':
        return <ShieldTab />;
      default:
        return <HomeTab user={user} />;
    }
  };

  return (
    <div className={`dashboard ${isOverlayView ? 'dashboard--overlay' : ''}`}>
      {!isOverlayView && (
        <TopHeader
          onMenuOpen={() => setMenuOpen(true)}
        />
      )}

      <main
        className={`dashboard__content ${isOverlayView ? 'dashboard__content--overlay' : ''}`}
        key={isOverlayView ? currentView : activeTab}
      >
        {isOverlayView ? renderOverlay() : renderTab()}
      </main>

      {!isOverlayView && (
        <>
          <BottomNav />
          <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <DashboardProvider>
      <DashboardContent />
    </DashboardProvider>
  );
}
