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
import './Dashboard.css';

function DashboardContent() {
  const { user } = useAuth();
  const { activeTab, setActiveTab } = useDashboard();
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
    <div className="dashboard">
      <TopHeader
        onMenuOpen={() => setMenuOpen(true)}
      />

      <main className="dashboard__content" key={activeTab}>
        {renderTab()}
      </main>

      <BottomNav />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
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
