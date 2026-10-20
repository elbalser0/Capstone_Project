import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, setTokenProvider } from '../api/client';
import { sharedKeys } from '../api/hooks/shared';
import type { Me } from '../api/types';

// One login for everyone. The role is not chosen here: after sign-in the app asks
// GET /api/me, lands on the Faculty pages, and shows the Faculty | Committee toggle
// only when the answer is role "AC".

interface Session {
  email: string;
  token: string;
}

/**
 * How a sign-in turns into a bearer token. "demo" works today with any password.
 * For Firebase, add an adapter that calls signInWithEmailAndPassword and returns
 * user.getIdToken(); nothing else in the app changes.
 */
interface AuthAdapter {
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
}

const demoAdapter: AuthAdapter = {
  async signIn(email) {
    const clean = email.trim().toLowerCase();
    return { email: clean, token: `demo:${clean}` };
  },
  async signOut() {},
};

/** Which sign-in is in use ("demo" unless VITE_AUTH_MODE says otherwise). */
export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'demo';

const adapters: Record<string, AuthAdapter> = { demo: demoAdapter };
const adapter = adapters[AUTH_MODE] ?? demoAdapter;

const STORAGE_KEY = 'assessment-helper.session';

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private windows); the session then lasts until reload.
  }
}

interface AuthContextValue {
  session: Session | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => {
    const saved = readSession();
    setTokenProvider(async () => saved?.token ?? null);
    return saved;
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!email.trim() || !password) throw new Error('Enter your email and password.');
      const next = await adapter.signIn(email, password);
      setTokenProvider(async () => next.token);
      try {
        const me = await api<Me>('/me');
        queryClient.setQueryData(sharedKeys.me, me);
        writeSession(next);
        setSession(next);
      } catch (err) {
        setTokenProvider(async () => null);
        if (err instanceof ApiError && err.status === 401) throw new Error('No account matches that email.');
        throw err;
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await adapter.signOut();
    setTokenProvider(async () => null);
    writeSession(null);
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
