import { useQueryClient } from '@tanstack/react-query';
import { FirebaseError } from 'firebase/app';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, type Auth } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, setTokenProvider } from '../api/client';
import { sharedKeys } from '../api/hooks/shared';
import type { Me } from '../api/types';
import { getFirebaseAuth, setTabPersistence } from './firebase';

// One login for everyone. The role is not chosen here: after sign-in the app asks
// GET /api/me, lands on the Faculty pages, and shows the Faculty | Committee toggle
// only when the answer is role "AC".

interface Session {
  email: string;
  /** Demo sessions only; Firebase hands out a fresh ID token for every request. */
  token?: string;
}

/** The demo adapter turns any password into a fake bearer token. Firebase is handled below. */
const demoAdapter = {
  async signIn(email: string): Promise<Session> {
    const clean = email.trim().toLowerCase();
    return { email: clean, token: `demo:${clean}` };
  },
};

/** Which sign-in is in use: "demo" (default) or "firebase". Anything else is an error, not demo. */
export function resolveAuthMode(mode: string | undefined, useMocks: string | undefined): 'demo' | 'firebase' {
  const value = mode ?? 'demo';
  if (value !== 'demo' && value !== 'firebase') {
    throw new Error(`Unsupported VITE_AUTH_MODE "${value}". Use "demo" or "firebase".`);
  }
  if (value === 'firebase' && useMocks === 'true') {
    throw new Error('VITE_AUTH_MODE=firebase needs VITE_USE_MOCKS=false: the mock API cannot verify Firebase tokens.');
  }
  return value;
}

export const AUTH_MODE = resolveAuthMode(import.meta.env.VITE_AUTH_MODE, import.meta.env.VITE_USE_MOCKS);

/** Wording for the sign-in form; Firebase deliberately does not say whether the email exists. */
function firebaseMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'UNVERIFIED_EMAIL') return 'Verify your email address before signing in.';
    if (err.code === 'NOT_A_PROFESSOR') return 'This account is not linked to a professor.';
    return err.message;
  }
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/network-request-failed': return 'Could not reach the sign-in service. Check your connection and try again.';
      case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes and try again.';
      case 'auth/user-disabled': return 'This account has been disabled.';
      default: return 'Incorrect email or password.';
    }
  }
  if (err instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return err instanceof Error ? err.message : 'Sign-in failed.';
}

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
  /** False while a saved Firebase login is still being restored and checked with the backend. */
  ready: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, mode = AUTH_MODE }: { children: ReactNode; mode?: 'demo' | 'firebase' }) {
  const queryClient = useQueryClient();
  const isFirebase = mode === 'firebase';
  const [auth] = useState<Auth | null>(() => (isFirebase ? getFirebaseAuth() : null));
  const [session, setSession] = useState<Session | null>(() => {
    if (isFirebase) {
      // A saved demo token is not a Firebase login.
      writeSession(null);
      return null;
    }
    const saved = readSession();
    setTokenProvider(async () => saved?.token ?? null);
    return saved;
  });
  const [ready, setReady] = useState(!isFirebase);
  // Bumped on every sign-in, sign-out and account change so a late /me answer is dropped.
  const generation = useRef(0);
  // The Firebase uid whose profile is already handled, so the listener ignores our own sign-in.
  const handledUid = useRef<string | null>(null);

  /** Asks the backend who the current Firebase user is. Resolves to false if superseded meanwhile. */
  const loadProfile = useCallback(
    async (gen: number) => {
      const me = await api<Me>('/me');
      if (gen !== generation.current) return false;
      queryClient.setQueryData(sharedKeys.me, me);
      setSession({ email: me.email });
      return true;
    },
    [queryClient],
  );

  const resetIdentity = useCallback(() => {
    generation.current += 1;
    handledUid.current = null;
    setSession(null);
    void queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    if (!auth) return;
    setTokenProvider(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
    let active = true;
    let unsubscribe = () => {};
    // Persistence must be set before the first auth state is read.
    void setTabPersistence(auth)
      .catch(() => {})
      .then(() => {
        if (!active) return;
        unsubscribe = onAuthStateChanged(auth, (user) => {
          if (!user) {
            resetIdentity();
            setReady(true);
            return;
          }
          if (user.uid === handledUid.current) return;
          handledUid.current = user.uid;
          const gen = ++generation.current;
          void queryClient.cancelQueries();
          queryClient.clear();
          loadProfile(gen)
            .catch((err) => {
              // Only a rejected account ends the Firebase login; a network or server error keeps it for the next reload.
              if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return firebaseSignOut(auth);
            })
            .finally(() => {
              if (gen === generation.current) setReady(true);
            });
        });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth, loadProfile, queryClient, resetIdentity]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!email.trim() || !password) throw new Error('Enter your email and password.');

      if (auth) {
        try {
          const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
          const gen = ++generation.current;
          handledUid.current = user.uid;
          queryClient.clear();
          await loadProfile(gen);
        } catch (err) {
          // Firebase accepted the password but the backend refused it (or the lookup failed): no half-login.
          if (auth.currentUser) await firebaseSignOut(auth).catch(() => {});
          resetIdentity();
          throw new Error(firebaseMessage(err));
        }
        return;
      }

      const next = await demoAdapter.signIn(email);
      setTokenProvider(async () => next.token ?? null);
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
    [auth, loadProfile, queryClient, resetIdentity],
  );

  const signOut = useCallback(async () => {
    if (auth) {
      resetIdentity();
      await firebaseSignOut(auth);
      return;
    }
    setTokenProvider(async () => null);
    writeSession(null);
    setSession(null);
    queryClient.clear();
  }, [auth, queryClient, resetIdentity]);

  const value = useMemo(() => ({ session, ready, signIn, signOut }), [session, ready, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
