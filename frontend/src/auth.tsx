import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** Key used by the old localStorage scheme; cleared on boot. */
const LEGACY_KEY = 'chess-admin.token';

const AuthContext = createContext<AuthState | null>(null);

// ── Access token: memory only ───────────────────────────────────────────────
// Deliberately a module variable and never persisted. Anything in
// localStorage/sessionStorage is readable by any injected script; the refresh
// token lives in an httpOnly cookie the browser will not hand to JavaScript.

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

function setAccessToken(token: string | null): void {
  accessToken = token;
}

interface SessionResponse {
  accessToken: string;
  user: User;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // carries the refresh cookie
    body: body === undefined ? undefined : JSON.stringify(body),
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

// ── Refresh, with a queue so concurrent 401s cause one round trip ───────────

let refreshInFlight: Promise<SessionResponse | null> | null = null;

/**
 * Ask the server for a new access token using the refresh cookie.
 *
 * EVERY refresh must go through here. The server rotates the token on each use
 * and treats a replayed one as theft, so two concurrent calls would revoke the
 * whole session. Concurrent callers therefore share a single request, and all
 * settle together so no promise is left hanging on failure.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const data = await post<SessionResponse>('/auth/refresh');
      setAccessToken(data.accessToken);
      return data;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      // Cleared after the microtask so everyone awaiting this attempt shares it.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

/** Convenience for the HTTP client: just the new access token, or null. */
export async function refreshAccessToken(): Promise<string | null> {
  return (await refreshSession())?.accessToken ?? null;
}

/** Called when the session is gone, so the UI can drop back to the login screen. */
let onSessionLost: (() => void) | null = null;
export function notifySessionLost(): void {
  onSessionLost?.();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot: drop any token left by the old localStorage scheme, then try to
  // restore the session from the cookie. Without this the user would be
  // bounced to the login screen on every reload.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // storage may be unavailable (private mode); nothing to clean up then
    }

    let alive = true;
    // Must go through the shared path: StrictMode runs this effect twice in
    // development, and two refreshes would replay the rotated token and look
    // like a stolen session to the server.
    refreshSession()
      .then((data) => {
        if (!alive) return;
        setUser(data?.user ?? null);
      })
      .finally(() => alive && setLoading(false));

    onSessionLost = () => {
      setAccessToken(null);
      setUser(null);
    };
    return () => {
      alive = false;
      onSessionLost = null;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await post<SessionResponse>('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const data = await post<SessionResponse>('/auth/register', { email, name, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } catch {
      // Even if the call fails, drop the local session.
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
