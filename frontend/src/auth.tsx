import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = 'chess-admin.token';
const AuthContext = createContext<AuthState | null>(null);

/** Read the current token outside React (used by the API client). */
export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data && typeof data === 'object' && 'error' in data && String(data.error)) ||
        'Request failed',
    );
  }
  return data as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Validate a stored token on boot; drop it if the server rejects it.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    let alive = true;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('invalid session'))))
      .then((u: User) => alive && setUser(u))
      .catch(() => {
        if (!alive) return;
        localStorage.removeItem(STORAGE_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  const accept = useCallback((res: { token: string; user: User }) => {
    localStorage.setItem(STORAGE_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      accept(await post('/auth/login', { email, password }));
    },
    [accept],
  );

  const register = useCallback(
    async (email: string, name: string, password: string) => {
      accept(await post('/auth/register', { email, name, password }));
    },
    [accept],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, register, logout }),
    [user, token, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
