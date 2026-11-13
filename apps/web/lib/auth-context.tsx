'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { AuthUser, authLogin, authLogout, authMe, LicenseBlockedError } from './api';
import { LicenseBlockedScreen } from '../components/LicenseBlockedScreen';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  licenseBlocked: boolean;
  licenseMessage: string;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setLicenseBlocked: (message: string) => void;
  /** ¿El usuario tiene al menos uno de los permisos? '*' satisface todo. */
  can: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseBlocked, setLicenseBlockedState] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState('');

  useEffect(() => {
    authMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof LicenseBlockedError) {
        setLicenseBlockedState(true);
        setLicenseMessage(event.reason.message);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const session = await authLogin(identifier, password);
    setUser(session);
    setLicenseBlockedState(false);
    return session;
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
    setLicenseBlockedState(false);
  }, []);

  const setLicenseBlocked = useCallback((message: string) => {
    setLicenseBlockedState(true);
    setLicenseMessage(message);
  }, []);

  const can = useCallback(
    (...permissions: string[]) => {
      const granted = user?.permissions;
      if (!granted?.length) return false;
      if (granted.includes('*')) return true;
      return permissions.some((p) => granted.includes(p));
    },
    [user],
  );

  if (licenseBlocked) {
    return <LicenseBlockedScreen message={licenseMessage} onLogout={logout} />;
  }

  return (
    <AuthContext.Provider value={{ user, loading, licenseBlocked, licenseMessage, login, logout, setLicenseBlocked, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
