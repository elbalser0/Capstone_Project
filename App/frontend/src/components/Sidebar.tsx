import type { ComponentType, SVGProps } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useMe } from '../api/hooks/shared';
import { useAuth } from '../auth/AuthProvider';
import { ClipboardIcon, GridIcon, LogoutIcon, SendIcon } from './icons';
import { RoleToggle, type Mode } from './RoleToggle';
import { Logo } from './ui';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface NavItem {
  to: string;
  label: string;
  icon: Icon;
}

const FACULTY_NAV: NavItem[] = [
  { to: '/faculty/evaluation', label: 'My evaluation', icon: ClipboardIcon },
  { to: '/faculty/requests', label: 'My requests', icon: SendIcon },
  { to: '/faculty/assignments', label: 'My assignments', icon: ClipboardIcon },
];

const COMMITTEE_NAV: NavItem[] = [
  { to: '/committee/dashboard', label: 'Dashboard', icon: GridIcon },
];

export const LANDING: Record<Mode, string> = { faculty: '/faculty/evaluation', committee: '/committee/dashboard' };

function NavRow({ item, forced }: { item: NavItem; forced?: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        aria-current={forced ? 'page' : undefined}
        className={({ isActive }) =>
          `relative flex h-9 items-center gap-[11px] rounded-md pl-[18px] focus-visible:outline-2 focus-visible:outline-brand ${
            isActive || forced ? 'border border-gray-200 bg-white font-bold text-gray-900' : 'text-gray-700 hover:bg-gray-200/60'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {(isActive || forced) && <span className="absolute top-2 -left-px h-5 w-[3px] rounded-sm bg-brand" aria-hidden />}
            <span className={`flex w-4 justify-center ${isActive || forced ? 'text-gray-900' : 'text-gray-600'}`}><Icon /></span>
            {item.label}
          </>
        )}
      </NavLink>
    </li>
  );
}

export function Sidebar({ mode, activeNav }: { mode: Mode; activeNav?: string }) {
  const { data: me } = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const isCommitteeMember = me?.role === 'AC';
  const items = mode === 'committee' ? COMMITTEE_NAV : FACULTY_NAV;

  return (
    <aside className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-gray-200 bg-gray-100">
      <div className="relative h-24 shrink-0">
        <div className="absolute top-[18px] left-6"><Logo /></div>
        {isCommitteeMember ? (
          <div className="absolute top-[54px] left-4">
            <RoleToggle mode={mode} onChange={(next) => navigate(LANDING[next])} />
          </div>
        ) : (
          <p className="absolute top-[72px] left-6 text-xs font-bold text-gray-600">Faculty</p>
        )}
      </div>

      <nav aria-label={mode === 'committee' ? 'Assessment Committee' : 'Faculty'} className="px-3">
        <ul className="flex flex-col gap-2">
          {items.map((item) => <NavRow key={item.to} item={item} forced={item.to === activeNav} />)}
        </ul>
      </nav>

      <div className="mx-4 mt-auto border-t border-gray-200 pt-[15px] pb-[17px]">
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
          className="flex items-center gap-[11px] pl-[13px] text-gray-700 hover:text-gray-900"
        >
          <span className="flex w-4 justify-center text-gray-600"><LogoutIcon /></span>
          Sign out
        </button>
      </div>
    </aside>
  );
}
