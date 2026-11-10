import type { ComponentType, SVGProps } from 'react';
import { Link, NavLink, useMatch, useNavigate } from 'react-router';
import { useCurrentCycle, useMe } from '../api/hooks/shared';
import { useIncomingRequests } from '../api/hooks/faculty';
import { useAuth } from '../auth/AuthProvider';
import { CalendarIcon, ClipboardIcon, EyeIcon, GridIcon, HelpIcon, ListIcon, LogoutIcon, SendIcon, UsersIcon } from './icons';
import { RoleToggle, type Mode } from './RoleToggle';
import { Logo } from './ui';
import { formatShort } from '../lib/format';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
interface NavItem {
  to: string;
  label: string;
  icon?: Icon;
  /** Highlight only on this exact path (a trailing slash allowed), not on the pages under it. */
  end?: boolean;
  /** Pages under this one, listed indented in a nested list below it (the dashboard's own pages). */
  children?: NavItem[];
}

const FACULTY_NAV: NavItem[] = [
  { to: '/faculty/evaluation', label: 'My evaluation', icon: ClipboardIcon },
  { to: '/faculty/requests', label: 'My requests', icon: SendIcon },
  { to: '/faculty/observe', label: 'Observe', icon: EyeIcon, end: true },
  { to: '/faculty/survey', label: 'Survey', icon: ClipboardIcon },
];

const COMMITTEE_NAV: NavItem[] = [
  {
    to: '/committee/dashboard',
    label: 'Dashboard',
    icon: GridIcon,
    end: true,
    children: [
      { to: '/committee/dashboard/due', label: 'Due or overdue' },
      { to: '/committee/dashboard/unmatched', label: 'Unmatched' },
      { to: '/committee/dashboard/outstanding', label: 'Outstanding' },
      { to: '/committee/dashboard/notifications', label: 'Notifications' },
    ],
  },
  { to: '/committee/cycle', label: 'Cycle', icon: CalendarIcon },
  { to: '/committee/faculty', label: 'Faculty', icon: UsersIcon },
  { to: '/committee/signups', label: 'Sign-ups', icon: ListIcon },
  { to: '/committee/survey-responses', label: 'Survey responses', icon: ClipboardIcon },
];

export const LANDING: Record<Mode, string> = { faculty: '/faculty/evaluation', committee: '/committee/dashboard' };

function NavRow({ item, activeNav, sub = false, badge = 0, opens, disabled = false }: { item: NavItem; activeNav?: string; sub?: boolean; badge?: number; opens?: string; disabled?: boolean }) {
  const Icon = item.icon;
  // Matched here rather than by NavLink: NavLink's `end` compares the path exactly, so
  // `/committee/dashboard/` would highlight no row, and it drops aria-current for a row that
  // `activeNav` highlights.
  const match = useMatch({ path: item.to, end: Boolean(item.end) });
  const active = !disabled && (Boolean(match) || item.to === activeNav);
  const classes = `relative flex items-center gap-[11px] rounded-md focus-visible:outline-2 focus-visible:outline-brand ${
    sub ? 'min-h-8 pl-[45px] text-[13px]' : 'min-h-9 pl-[18px]'
  } ${active ? 'border border-gray-200 bg-white font-bold text-gray-900' : 'text-gray-700 hover:bg-gray-200/60'}`;
  const contents = (
    <>
      {active && <span className={`absolute top-2 -left-px w-[3px] rounded-sm bg-brand ${sub ? 'h-4' : 'h-5'}`} aria-hidden />}
      {Icon && <span className={`flex w-4 shrink-0 justify-center ${active ? 'text-gray-900' : 'text-gray-600'}`}><Icon /></span>}
      <span className="flex-1">{item.label}</span>
      {badge > 0 && <span aria-label={`${badge} new requests`} className="mr-3 flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold text-white">{badge}</span>}
      {opens && <span className="mr-3 text-[11px] font-normal text-gray-500">Opens {opens}</span>}
    </>
  );
  return (
    <li>
      {disabled ? (
        <div className={`${classes} cursor-default`} aria-disabled="true">{contents}</div>
      ) : (
        <Link to={item.to} aria-current={active ? 'page' : undefined} className={classes}>
          {contents}
        </Link>
      )}
      {item.children && (
        <ul className="mt-1 flex flex-col gap-1">
          {item.children.map((child) => <NavRow key={child.to} item={child} activeNav={activeNav} sub />)}
        </ul>
      )}
    </li>
  );
}

function FacultyNavigation({ activeNav }: { activeNav?: string }) {
  const incoming = useIncomingRequests();
  const cycle = useCurrentCycle();
  const pendingCount = incoming.data?.filter((request) => request.status === 'pending').length ?? 0;
  const surveyLocked = !cycle.data || (cycle.data.phase !== 'feedback' && cycle.data.phase !== 'closed');
  const surveyOpens = surveyLocked && cycle.data ? formatShort(cycle.data.surveyOpensDate) : undefined;

  return (
    <nav aria-label="Faculty" className="px-3">
      <ul className="flex flex-col gap-2">
        {FACULTY_NAV.map((item) => {
          const observe = item.to === '/faculty/observe';
          const survey = item.to === '/faculty/survey';
          return <NavRow key={item.to} item={item} activeNav={activeNav} badge={observe ? pendingCount : 0} opens={survey ? surveyOpens : undefined} disabled={survey && surveyLocked} />;
        })}
      </ul>
    </nav>
  );
}

function CommitteeNavigation({ activeNav }: { activeNav?: string }) {
  return (
    <nav aria-label="Assessment Committee" className="px-3">
      <ul className="flex flex-col gap-2">
        {COMMITTEE_NAV.map((item) => <NavRow key={item.to} item={item} activeNav={activeNav} />)}
      </ul>
    </nav>
  );
}

export function Sidebar({ mode, activeNav }: { mode: Mode; activeNav?: string }) {
  const { data: me } = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const isCommitteeMember = me?.role === 'AC';
  return (
    <aside className="app-shell-sidebar sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-gray-200 bg-gray-100">
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

      {mode === 'faculty' ? <FacultyNavigation activeNav={activeNav} /> : <CommitteeNavigation activeNav={activeNav} />}

      <div className="mx-4 mt-auto border-t border-gray-200 pt-[15px] pb-[17px]">
        <NavLink
          to="/guide"
          className={({ isActive }) => `mb-[19px] flex items-center gap-[11px] pl-[13px] hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-brand ${isActive ? 'font-bold text-gray-900' : 'text-gray-700'}`}
        >
          <span className="flex w-4 justify-center text-gray-600"><HelpIcon /></span>
          Process guide
        </NavLink>
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
