import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

export type TabId = 'home' | 'savings' | 'program' | 'shield';
export type ViewId = 'dashboard' | 'paywall' | 'dcp-redirect' | 'drp-redirect';

interface DashboardContextValue {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  currentView: ViewId;
  setCurrentView: (view: ViewId) => void;
  scrollToSection: (sectionId: string) => void;
  registerSection: (id: string, ref: HTMLElement | null) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// Map old routes to tab actions
export const REDIRECT_MAP: Record<string, { tab: TabId; section?: string }> = {
  '/dep': { tab: 'program' },
  '/drp': { tab: 'program' },
  '/dcp': { tab: 'program' },
  '/credit-score': { tab: 'home', section: 'credit-score' },
  '/goal-tracker': { tab: 'savings' },
  '/freed-shield': { tab: 'shield' },
  '/dispute': { tab: 'shield' },
};

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [currentView, setCurrentView] = useState<ViewId>('dashboard');
  const sectionsRef = useRef<Map<string, HTMLElement>>(new Map());

  const registerSection = useCallback((id: string, ref: HTMLElement | null) => {
    if (ref) {
      sectionsRef.current.set(id, ref);
    } else {
      sectionsRef.current.delete(id);
    }
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const el = sectionsRef.current.get(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Listen for view-switch events from chat widgets
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.view) {
        setCurrentView(detail.view as ViewId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('freed-open-view', handler);
    return () => window.removeEventListener('freed-open-view', handler);
  }, []);

  return (
    <DashboardContext.Provider value={{ activeTab, setActiveTab, currentView, setCurrentView, scrollToSection, registerSection }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
