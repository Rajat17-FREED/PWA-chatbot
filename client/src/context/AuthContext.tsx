import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { User, ConversationStarter } from '../types';
import * as api from '../services/api';

interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
  starters: ConversationStarter[];
  welcomeMessage: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (name: string) => Promise<{ status: string; candidates?: any[]; message?: string }>;
  selectUser: (leadRefId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    user: null,
    starters: [],
    welcomeMessage: null,
    isLoading: false,
  });

  const login = useCallback(async (name: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const result = await api.identifyUser(name);
      if (result.status === 'found' && result.user) {
        setState({
          isLoggedIn: true,
          user: result.user,
          starters: result.starters || [],
          welcomeMessage: result.message || null,
          isLoading: false,
        });
        return { status: 'found' };
      } else if (result.status === 'multiple') {
        setState(s => ({ ...s, isLoading: false }));
        return { status: 'multiple', candidates: result.candidates, message: result.message };
      } else {
        setState(s => ({ ...s, isLoading: false }));
        return { status: 'not_found', message: result.message };
      }
    } catch {
      setState(s => ({ ...s, isLoading: false }));
      return { status: 'error', message: 'Something went wrong. Please try again.' };
    }
  }, []);

  const selectUser = useCallback(async (leadRefId: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const result = await api.selectUser(leadRefId);
      if (result.status === 'found' && result.user) {
        setState({
          isLoggedIn: true,
          user: result.user,
          starters: result.starters || [],
          welcomeMessage: result.message || null,
          isLoading: false,
        });
      }
    } catch {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  const logout = useCallback(() => {
    setState({ isLoggedIn: false, user: null, starters: [], welcomeMessage: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, selectUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
