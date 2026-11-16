import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAccount } from '../api/hooks/shared';
import { useAuth } from '../auth/AuthProvider';
import { initials } from '../lib/format';
import { Logo } from './ui';

export function AdminShell() {
  const { session, ready, signOut } = useAuth();
  const { pathname } = useLocation();
  const me = useAccount({ enabled: ready && Boolean(session) });

  if (!ready) {
    return <p role="status" className="p-8">Checking your sign-in...</p>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }

  if (me.isError) {
    return (
      <div className="p-8">
        <p role="alert">Could not load your account.</p>
        <button
          type="button"
          className="mt-4 underline"
          onClick={() => void me.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!me.data) {
    return <p role="status" className="p-8">Loading your account...</p>;
  }

  if (!me.data.isAdmin) {
    return <Navigate to="/faculty/evaluation" replace />;
  }

  const title = pathname.startsWith('/admin/import')
    ? 'Import term and section data'
    : 'Professor Management';

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md border px-4 py-2 text-sm ${
      isActive
        ? 'border-gray-200 bg-white font-bold text-gray-900'
        : 'border-transparent text-gray-600 hover:bg-white'
    }`;

  return (
    <div className="app-shell flex min-h-screen">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-gray-200 bg-gray-100 p-4">
        <Logo />

        <p className="mb-2 mt-8 px-4 text-xs font-bold text-gray-600">
          Admin
        </p>

        <nav aria-label="Admin navigation" className="space-y-1">
          <NavLink to="/admin/professors" className={navClass}>
            Professors
          </NavLink>
          <NavLink to="/admin/import" className={navClass}>
            Data Import
          </NavLink>
        </nav>

        <div className="mt-auto border-t border-gray-200 pt-4">
          {/* The faculty pages and the guide read professor-only data, so an admin who is not a professor gets no link to them. */}
          {me.data.role !== 'admin' && (
            <>
              <NavLink to="/faculty/evaluation" className={navClass}>
                Faculty pages
              </NavLink>
              <NavLink to="/guide" className={navClass}>
                Process guide
              </NavLink>
            </>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-md px-4 py-2 text-left text-sm text-gray-600 hover:bg-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="app-shell-content flex min-w-0 flex-1 flex-col">
        <header className="app-shell-header flex h-14 shrink-0 items-center gap-4 border-b border-gray-200 bg-white px-8">
          <h1 className="text-[22px] font-bold text-gray-900">
            {title}
          </h1>

          <div className="ml-auto flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700"
            >
              {initials(me.data)}
            </span>
            <div>
              <p className="text-sm font-bold text-gray-900">
                {me.data.displayName}
              </p>
              <p className="text-xs text-gray-500">Administrator</p>
            </div>
          </div>
        </header>

        <main className="app-shell-main w-full max-w-[1060px] px-8 pb-12 pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}