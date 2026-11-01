import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatches } from 'react-router';
import { useCurrentCycle, useMe } from '../api/hooks/shared';
import { useAuth } from '../auth/AuthProvider';
import { RANK_LABEL, initials } from '../lib/format';
import { CalendarIcon } from './icons';
import type { Mode } from './RoleToggle';
import { LANDING, Sidebar } from './Sidebar';

export interface RouteHandle {
  title: string;
  /** Sidebar item to highlight when the page is not itself in the sidebar. */
  nav?: string;
}

const TitleContext = createContext<(title: string | null) => void>(() => {});

/** Replaces the route's top-bar title while the page shows a state with its own Figma title. */
export function usePageTitle(title: string | null | undefined) {
  const set = useContext(TitleContext);
  useLayoutEffect(() => {
    set(title ?? null);
    return () => set(null);
  }, [set, title]);
}

const NavContext = createContext<(nav: string | null) => void>(() => {});

/** Overrides the route's sidebar highlight once the page knows who is viewing; "" highlights nothing, null keeps the route's. */
export function useActiveNav(nav: string | null) {
  const set = useContext(NavContext);
  useLayoutEffect(() => {
    set(nav);
    return () => set(null);
  }, [set, nav]);
}

function TopBar({ title, mode }: { title: string; mode: Mode }) {
  const { data: me } = useMe();
  const { data: cycle } = useCurrentCycle();
  return (
    <header className="flex h-14 shrink-0 items-center gap-[18px] border-b border-gray-200 bg-white px-8">
      <h1 className="text-[22px] font-bold text-gray-900">{title}</h1>
      {cycle && (
        <span className="inline-flex h-6 items-center gap-2 rounded-md border border-gray-300 px-[11px] text-xs font-bold text-gray-700">
          <CalendarIcon width={11} height={11} />
          {cycle.term.label}
        </span>
      )}
      {me && (
        <div className="ml-auto flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700" aria-hidden>
            {initials(me)}
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-gray-900">{me.displayName}</span>
            <span className="block text-xs text-gray-500">
              {mode === 'committee' ? 'Assessment Committee' : `${RANK_LABEL[me.rank]}, ${me.department.deptName}`}
            </span>
          </span>
        </div>
      )}
    </header>
  );
}

/** Signed-in layout. Pages under /committee need role "AC"; everyone else is sent to their Faculty pages. */
export function AppShell() {
  const { session, ready } = useAuth();
  const { pathname } = useLocation();
  const matches = useMatches();
  const me = useMe({ enabled: Boolean(session) });
  const [override, setOverride] = useState<string | null>(null);
  const [navOverride, setNavOverride] = useState<string | null>(null);

  if (!ready) return <p role="status" className="p-8 text-sm text-gray-500">Checking your sign-in…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: pathname }} />;
  const mode: Mode = pathname.startsWith('/committee') ? 'committee' : 'faculty';
  if (mode === 'committee' && me.data && me.data.role !== 'AC') return <Navigate to={LANDING.faculty} replace />;
  if (mode === 'committee' && !me.data) return null;

  const handles = [...matches].reverse().map((m) => m.handle as RouteHandle | undefined);
  const title = override ?? handles.map((h) => h?.title).find(Boolean) ?? '';
  const nav = navOverride ?? handles.map((h) => h?.nav).find(Boolean);
  return (
    <div className="flex min-h-screen">
      <Sidebar mode={mode} activeNav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} mode={mode} />
        <main className="w-full max-w-[1060px] px-8 pb-12">
          <TitleContext.Provider value={setOverride}>
            <NavContext.Provider value={setNavOverride}>
              <Outlet />
            </NavContext.Provider>
          </TitleContext.Provider>
        </main>
      </div>
    </div>
  );
}
