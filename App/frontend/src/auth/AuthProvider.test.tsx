import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { Me } from '../api/types';
import { AppShell } from '../components/AppShell';
import { LoginPage } from '../pages/LoginPage';
import { server } from '../test/setup';
import { AuthProvider, resolveAuthMode } from './AuthProvider';
import { getFirebaseAuth } from './firebase';

// The Firebase SDK is the boundary: a small in-memory stand-in for its sign-in state.
const sdk = vi.hoisted(() => {
  type User = { uid: string; getIdToken: () => Promise<string> };
  const state = {
    currentUser: null as User | null,
    listeners: new Set<(user: User | null) => void>(),
    tokens: 0,
    signInWithEmailAndPassword: undefined as unknown as (...args: unknown[]) => Promise<{ user: User }>,
  };
  const makeUser = (uid: string): User => ({ uid, getIdToken: async () => `id-token-${++state.tokens}` });
  const emit = () => state.listeners.forEach((fn) => fn(state.currentUser));
  return { state, makeUser, emit };
});

vi.mock('firebase/app', async () => ({
  ...(await vi.importActual<typeof import('firebase/app')>('firebase/app')),
  getApps: () => [],
  initializeApp: vi.fn(() => ({})),
}));
vi.mock('firebase/auth', () => ({
  browserSessionPersistence: {},
  getAuth: () => sdk.state,
  setPersistence: vi.fn(async () => {}),
  onAuthStateChanged: vi.fn((_auth: unknown, fn: (user: unknown) => void) => {
    sdk.state.listeners.add(fn);
    queueMicrotask(() => sdk.state.listeners.has(fn) && fn(sdk.state.currentUser));
    return () => sdk.state.listeners.delete(fn);
  }),
  signInWithEmailAndPassword: vi.fn((...args: unknown[]) => sdk.state.signInWithEmailAndPassword(...args)),
  signOut: vi.fn(async () => {
    sdk.state.currentUser = null;
    sdk.emit();
  }),
}));

const { signOut: sdkSignOut, onAuthStateChanged, signInWithEmailAndPassword } = await import('firebase/auth');
const { initializeApp } = await import('firebase/app');

const me = (displayName: string, role: Me['role'] = 'faculty'): Me => ({
  netid: 'ml123', firstName: 'Maya', lastName: 'Lin', displayName, email: 'maya.lin@utdallas.edu', rank: 'assistant',
  department: { deptId: '1', deptName: 'Computer Science' }, role,
});

let seenAuth: Array<string | null>;
let meReply: () => Response | Promise<Response>;

/** Signs in as `uid` the way the SDK does: sets the user, then tells listeners. */
const acceptPassword = (uid: string) => {
  sdk.state.signInWithEmailAndPassword = async () => {
    sdk.state.currentUser = sdk.makeUser(uid);
    sdk.emit();
    return { user: sdk.state.currentUser };
  };
};

function renderApp(mode: 'demo' | 'firebase' = 'firebase', path = '/faculty/evaluation') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { element: <AppShell />, children: [{ path: '/faculty/evaluation', element: <p>Evaluation page</p> }] },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider mode={mode}><RouterProvider router={router} /></AuthProvider>
    </QueryClientProvider>,
  );
}

async function login(email = 'maya.lin@utdallas.edu', password = 'secret') {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  seenAuth = [];
  sdk.state.currentUser = null;
  sdk.state.listeners.clear();
  sdk.state.tokens = 0;
  meReply = () => HttpResponse.json(me('Dr. Maya Lin'));
  acceptPassword('maya');
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app');
  server.use(
    http.get('/api/me', ({ request }) => {
      seenAuth.push(request.headers.get('Authorization'));
      return meReply();
    }),
    http.get('/api/cycles/current', () => HttpResponse.json(null)),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  sessionStorage.clear();
});

test('Firebase sign-in sends the ID token to /api/me and uses the returned profile', async () => {
  meReply = () => HttpResponse.json(me('Dr. Linda Chen', 'AC'));
  renderApp();
  await login();

  expect(await screen.findByText('Evaluation page')).toBeInTheDocument();
  expect(screen.getByText('Dr. Linda Chen')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Committee' })).toBeInTheDocument();
  expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'maya.lin@utdallas.edu', 'secret');
  expect(seenAuth[0]).toMatch(/^Bearer id-token-\d+$/);
});

test('each API call asks Firebase for the current token', async () => {
  renderApp();
  await login();
  await screen.findByText('Evaluation page');

  server.use(http.get('/api/ping', ({ request }) => HttpResponse.json(request.headers.get('Authorization'))));
  const first = await api<string>('/ping');
  const second = await api<string>('/ping');
  expect(first).not.toEqual(second);
});

test('wrong credentials leave the form usable and never call the backend', async () => {
  sdk.state.signInWithEmailAndPassword = async () => {
    throw new FirebaseError('auth/invalid-credential', 'bad');
  };
  renderApp();
  await login();

  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  expect(seenAuth).toEqual([]);
});

test('a network failure during sign-in is reported as such', async () => {
  sdk.state.signInWithEmailAndPassword = async () => {
    throw new FirebaseError('auth/network-request-failed', 'offline');
  };
  renderApp();
  await login();
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i);
});

test.each([
  [401, 'UNVERIFIED_EMAIL', 'Verify your email address before signing in.'],
  [403, 'NOT_A_PROFESSOR', 'This account is not linked to a professor.'],
])('a backend %i %s rejection signs back out and shows the reason', async (status, code, message) => {
  meReply = () => HttpResponse.json({ error: { code, message: 'x' } }, { status });
  renderApp();
  await login();

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(sdkSignOut).toHaveBeenCalled();
  expect(sdk.state.currentUser).toBeNull();
  expect(screen.queryByText('Evaluation page')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

test('a saved Firebase login holds protected pages until /api/me answers', async () => {
  sdk.state.currentUser = sdk.makeUser('maya');
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  meReply = async () => {
    await gate;
    return HttpResponse.json(me('Dr. Maya Lin'));
  };
  renderApp();

  expect(await screen.findByRole('status')).toHaveTextContent('Checking your sign-in');
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  expect(screen.queryByText('Evaluation page')).not.toBeInTheDocument();
  answer();
  expect(await screen.findByText('Evaluation page')).toBeInTheDocument();
});

test('with no saved login the protected page redirects to the login form', async () => {
  renderApp();
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
});

test('a saved login the backend rejects ends at the login form, signed out', async () => {
  sdk.state.currentUser = sdk.makeUser('maya');
  meReply = () => HttpResponse.json({ error: { code: 'NOT_A_PROFESSOR', message: 'x' } }, { status: 403 });
  renderApp();

  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(sdk.state.currentUser).toBeNull();
});

test('a saved login stays signed in at Firebase when /api/me fails for a non-auth reason', async () => {
  sdk.state.currentUser = sdk.makeUser('maya');
  meReply = () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 });
  renderApp();

  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(sdk.state.currentUser).not.toBeNull();
  expect(sdkSignOut).not.toHaveBeenCalled();
});

test('sign out ends the Firebase session, and a reload does not restore it', async () => {
  renderApp();
  await login();
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(sdkSignOut).toHaveBeenCalled();

  document.body.innerHTML = '';
  renderApp();
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByText('Evaluation page')).not.toBeInTheDocument();
});

test('the next account sees its own profile, not the previous one', async () => {
  renderApp();
  await login();
  expect(await screen.findByText('Dr. Maya Lin')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  meReply = () => HttpResponse.json(me('Dr. Elena Ruiz'));
  acceptPassword('elena');
  await login('elena.ruiz@utdallas.edu');
  expect(await screen.findByText('Dr. Elena Ruiz')).toBeInTheDocument();
  expect(screen.queryByText('Dr. Maya Lin')).not.toBeInTheDocument();
});

test('a profile answer that arrives after sign-out does not restore the session', async () => {
  sdk.state.currentUser = sdk.makeUser('maya');
  let answer!: () => void;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  meReply = async () => {
    await gate;
    return HttpResponse.json(me('Dr. Maya Lin'));
  };
  renderApp();
  await screen.findByRole('status');

  sdk.state.currentUser = null;
  sdk.emit();
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  answer();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByText('Evaluation page')).not.toBeInTheDocument();
});

test('a saved demo token is not a Firebase login', async () => {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:maya.lin@demo.edu' }));
  renderApp();
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(seenAuth).toEqual([]);
});

test('unsupported modes and mocks with Firebase are errors, not demo', () => {
  expect(() => resolveAuthMode('firbase', 'false')).toThrow(/Unsupported VITE_AUTH_MODE "firbase"/);
  expect(() => resolveAuthMode('firebase', 'true')).toThrow(/VITE_USE_MOCKS=false/);
  expect(resolveAuthMode(undefined, 'true')).toBe('demo');
  expect(resolveAuthMode('firebase', 'false')).toBe('firebase');
});

test('missing Firebase settings name the missing variables', () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  expect(() => getFirebaseAuth()).toThrow(/VITE_FIREBASE_API_KEY/);
});

test('demo mode needs no Firebase setup and keeps its demo token', async () => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', '');
  renderApp('demo');
  await login('maya.lin@demo.edu', 'anything');

  expect(await screen.findByText('Evaluation page')).toBeInTheDocument();
  expect(seenAuth[0]).toBe('Bearer demo:maya.lin@demo.edu');
  expect(initializeApp).not.toHaveBeenCalled();
  expect(onAuthStateChanged).not.toHaveBeenCalled();
});

test('ApiError is still what the client throws for backend rejections', async () => {
  server.use(http.get('/api/boom', () => HttpResponse.json({ error: { code: 'X', message: 'm' } }, { status: 403 })));
  await expect(api('/boom')).rejects.toBeInstanceOf(ApiError);
  await waitFor(() => expect(true).toBe(true));
});
