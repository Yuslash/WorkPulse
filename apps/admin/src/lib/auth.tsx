import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AdminUser, LoginResponse, RegisterOrganizationRequest, Role } from '@workpulse/shared';
import { roleAtLeast } from '@workpulse/shared';
import { api, setAccessToken, setUnauthenticatedHandler } from './api';

/**
 * Session state for the dashboard.
 *
 * The access token deliberately lives in memory only. The refresh token is an
 * httpOnly cookie the browser sends on its own, so a XSS payload cannot read
 * either one out of localStorage.
 */

interface AuthContextValue {
  user: AdminUser | null;
  /** True until the initial silent-refresh attempt settles. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterOrganizationRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** RBAC helper for hiding controls the user cannot use. */
  can: (role: Role) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // On load, try to resume from the refresh cookie so a page reload does
    // not force a fresh sign-in.
    (async () => {
      try {
        const session = await api.post<LoginResponse>('/api/auth/refresh');
        if (cancelled) return;

        setAccessToken(session.accessToken);
        setUser(session.user);
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // When a refresh finally fails mid-session, drop to the login screen
    // rather than leaving a dashboard full of errors.
    setUnauthenticatedHandler(() => {
      setAccessToken(null);
      setUser(null);
    });

    return () => setUnauthenticatedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.post<LoginResponse>('/api/auth/login', { email, password });
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const register = useCallback(async (input: RegisterOrganizationRequest) => {
    const session = await api.post<LoginResponse>('/api/auth/register', input);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      // Clear locally even if the server call fails, so the UI never gets
      // stuck in a signed-in state the server has already revoked.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (role: Role) => (user ? roleAtLeast(user.role, role) : false),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, register, logout, can }),
    [user, loading, login, register, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
