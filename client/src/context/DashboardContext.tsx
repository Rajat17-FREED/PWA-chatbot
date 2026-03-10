import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export type TabId = 'home' | 'savings' | 'program' | 'shield';

interface DashboardContextValue {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
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

  return (
    <DashboardContext.Provider value={{ activeTab, setActiveTab, scrollToSection, registerSection }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
