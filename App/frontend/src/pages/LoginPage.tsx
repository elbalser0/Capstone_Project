import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AUTH_MODE, useAuth } from '../auth/AuthProvider';
import { EyeIcon, InfoIcon } from '../components/icons';
import { Button, Logo, labelClass } from '../components/ui';

// L0. Same login for everyone; there is no role choice here.

const DEMO_ACCOUNTS = [
  { label: 'Faculty (observee/observer)', emails: ['maya.lin@demo.edu', 'elena.ruiz@demo.edu'] },
  { label: 'Assessment Committee + Faculty', emails: ['linda.chen@demo.edu'] },
];

export function LoginPage() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signing in sets the session, and this redirect then returns to the page that asked for it.
  const from = (location.state as { from?: string } | null)?.from;
  if (session) return <Navigate to={from && from !== '/login' ? from : '/faculty/evaluation'} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  const input = 'h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand focus:outline-2 focus:outline-brand/30';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex h-14 items-center border-b border-gray-200 bg-white px-8">
        <Logo />
      </header>

      <main className="mx-auto w-[420px] pt-12">
        <section className="rounded-lg border border-gray-200 bg-white px-10 pt-[34px] pb-10">
          <h1 className="text-[22px] font-bold text-gray-900">Assessment Helper</h1>
          <p className="mt-1 text-sm text-gray-500">Faculty teaching observations, UT Dallas</p>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
            <div>
              <label htmlFor="email" className={labelClass}>Email</label>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="password" className={labelClass}>Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${input} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-3 flex items-center text-gray-500 hover:text-gray-900"
                >
                  <EyeIcon />
                </button>
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>

          {AUTH_MODE === 'demo' && (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
                <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  <InfoIcon className="text-gray-700" /> Demo accounts for the proof of concept
                </p>
                <ul className="mt-3 flex flex-col gap-3 pl-[17px]">
                  {DEMO_ACCOUNTS.map((a) => (
                    <li key={a.label} className="relative pl-[15px]">
                      <span className="absolute top-1.5 left-0 size-1.5 rounded-full bg-gray-700" aria-hidden />
                      <span className="block text-sm font-bold text-gray-900">{a.label}</span>
                      <span className="text-xs text-gray-500">
                        {a.emails.map((addr, i) => (
                          <span key={addr}>
                            {i > 0 && ', '}
                            <button type="button" onClick={() => setEmail(addr)} className="hover:text-gray-900 hover:underline">{addr}</button>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
        <p className="mt-6 text-center text-xs text-gray-500">CS 4485 capstone, Team 06, proof of concept</p>
      </main>
    </div>
  );
}
