import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useMatches } from 'react-router';
import { useAccount, useCurrentCycle, useMe } from '../api/hooks/shared';
import { useAuth } from '../auth/AuthProvider';
import { RANK_LABEL, initials } from '../lib/format';
import { CalendarIcon, MenuIcon, XIcon } from './icons';
import { Button, ErrorNote } from './ui';
import type { Mode } from './RoleToggle';
import { LANDING, SIDEBAR_ID, Sidebar } from './Sidebar';

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
    <header className="app-shell-header flex min-h-14 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1.5 border-b border-gray-200 bg-white px-8 py-2">
      <h1 className="min-w-0 wrap-anywhere text-[22px] leading-tight font-bold text-gray-900">{title}</h1>
      {cycle && (
        <span className="inline-flex h-6 items-center gap-2 rounded-md border border-gray-300 px-[11px] text-xs font-bold text-gray-700">
          <CalendarIcon width={11} height={11} />
          {cycle.term.label}
        </span>
      )}
      {me && (
        <div className="ml-auto flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700" aria-hidden>
            {initials(me)}
          </span>
          <span className="min-w-0 leading-tight wrap-anywhere">
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

/**
 * Signed-in layout for professors. Pages under /committee need role "AC"; other professors are sent
 * to their Faculty pages. An admin who is not a professor has no pages here and is sent to /admin.
 */
export function AppShell() {
  const { session, ready, signOut } = useAuth();
  const { pathname } = useLocation();
  const matches = useMatches();
  const me = useAccount({ enabled: Boolean(session) });
  const [override, setOverride] = useState<string | null>(null);
  const [navOverride, setNavOverride] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // The phone menu closes when a link in it opens another page, when a link to the page already open is tapped, and on Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  // Growing the window past the phone width puts the sidebar back beside the page, so the menu closes.
  useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 48rem)');
    const onChange = () => { if (wide.matches) setMenuOpen(false); };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [menuOpen]);
  // Opening moves focus into the menu; closing hands it back to the menu button, also after a link in the menu was used.
  useEffect(() => {
    if (menuOpen) closeButton.current?.focus();
    else if (wasOpen.current && (document.activeElement === document.body || document.getElementById(SIDEBAR_ID)?.contains(document.activeElement))) menuButton.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  if (!ready) return <p role="status" className="p-8 text-sm text-gray-500">Checking your sign-in…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (me.data?.role === 'admin') return <Navigate to="/admin" replace />;
  const mode: Mode = pathname.startsWith('/committee') ? 'committee' : 'faculty';
  if (mode === 'committee' && me.data && me.data.role !== 'AC') return <Navigate to={LANDING.faculty} replace />;
  if (mode === 'committee' && !me.data) {
    if (!me.error) return <p role="status" className="p-8 text-sm text-gray-500">Loading…</p>;
    // Committee pages need to know the role first, so a failed /api/me would otherwise leave the page blank.
    return (
      <main className="flex max-w-xl flex-col items-start gap-3 p-8">
        <h1 className="text-[22px] font-bold text-gray-900">This page could not load</h1>
        <ErrorNote error={new Error(`We could not check your account. ${me.error instanceof Error ? me.error.message : ''}`.trim())} className="self-stretch" />
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" size="sm" aria-disabled={me.isFetching || undefined} onClick={() => { if (!me.isFetching) void me.refetch(); }}>
            {me.isFetching ? 'Trying again…' : 'Try again'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </main>
    );
  }

  const handles = [...matches].reverse().map((m) => m.handle as RouteHandle | undefined);
  const title = override ?? handles.map((h) => h?.title).find(Boolean) ?? '';
  const nav = navOverride ?? handles.map((h) => h?.nav).find(Boolean);
  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar mode={mode} activeNav={nav} open={menuOpen} onLinkClick={() => setMenuOpen(false)} />
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-gray-900/40 md:hidden print:hidden" onClick={() => setMenuOpen(false)}>
          <button
            type="button"
            ref={closeButton}
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="absolute top-3 left-[232px] flex size-9 items-center justify-center rounded-full bg-white text-gray-700 shadow hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <XIcon width={10} height={10} />
          </button>
        </div>
      )}
      {/* While the phone menu is open, the page behind it is out of reach for the keyboard and screen readers. */}
      <div className="app-shell-content flex min-w-0 flex-1 flex-col" inert={menuOpen || undefined}>
        <div className="flex min-w-0">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls={SIDEBAR_ID}
            className="flex w-12 shrink-0 items-center justify-center border-b border-gray-200 bg-white text-gray-700 hover:text-gray-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand md:hidden print:hidden"
          >
            <MenuIcon />
          </button>
          <div className="min-w-0 flex-1">
            <TopBar title={title} mode={mode} />
          </div>
        </div>
        <main className="app-shell-main w-full max-w-[1060px] px-4 pb-12 md:px-8">
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
