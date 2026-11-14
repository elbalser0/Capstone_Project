import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { Outlet } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { DueProfessor, Me, UnmatchedFaculty } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { DUE_OR_OVERDUE_TEXT, OUTSTANDING_TEXT, UNMATCHED_TEXT } from '../../lib/statusTerms';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { cycle, faculty, otherCourse, signup } from '../../test/fixtures';
import { router } from '../../App';
import { DueListPage, NotificationsPage, OutstandingListPage, UnmatchedListPage } from './DashboardParts';

const SESSION_KEY = 'assessment-helper.session';
const facultyMe: Me = { ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' };
const committeeMe: Me = { ...facultyMe, role: 'AC' };

const dueProfessors: DueProfessor[] = [
  { professor: faculty, department: { deptId: '1', deptName: 'Computer Science' }, dueStatus: 'DUE', lastObservedTerm: null },
];
const unmatched: UnmatchedFaculty = {
  cycleId: '1', total: 1,
  items: [{ signupId: '21', observee: { ...faculty, netid: 'sk1', firstName: 'Sarah', lastName: 'Kim', displayName: 'Dr. Sarah Kim' }, section: otherCourse, alertType: 'no_observer' }],
};
const noCycle = () => HttpResponse.json({ error: { code: 'NO_CYCLE', message: 'No cycle has started yet.' } }, { status: 404 });

function serve(me: Me = committeeMe) {
  server.use(
    http.get('*/api/me', () => HttpResponse.json(me)),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    // The sidebar badge for new observation requests asks for these once it is added.
    http.get('*/api/me/requests/incoming', () => HttpResponse.json([])),
    http.get('*/api/me/notifications', () => HttpResponse.json([])),
    http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(dueProfessors)),
    http.get('*/api/dashboard/unmatched', () => HttpResponse.json(unmatched)),
    http.get('*/api/cycles/1/signups', () => HttpResponse.json([signup])),
  );
}

const PAGES = [
  { path: '/committee/dashboard', link: 'Dashboard', text: 'Dashboard page' },
  { path: '/committee/dashboard/due', link: 'Due or overdue', text: 'Due list page' },
  { path: '/committee/dashboard/unmatched', link: 'Unmatched', text: 'Unmatched list page' },
  { path: '/committee/dashboard/outstanding', link: 'Outstanding', text: 'Outstanding list page' },
  { path: '/committee/dashboard/notifications', link: 'Notifications', text: 'Notifications page' },
];

/** The signed-in layout with a stand-in for each dashboard page, so the sidebar is there too. */
function openApp(path: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
  return renderRoutes([{
    element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
    children: [
      ...PAGES.map((p) => ({ path: p.path, element: <p>{p.text}</p>, handle: { title: p.link } })),
      { path: '/committee/cycle', element: <p>Cycle page</p>, handle: { title: 'Start the evaluation cycle' } },
      { path: '/committee/faculty', element: <p>Faculty page</p>, handle: { title: 'Faculty' } },
      { path: '/committee/signups', element: <p>Sign-up requests page</p>, handle: { title: 'Sign-up requests' } },
      { path: '/committee/survey-responses', element: <p>Survey responses page</p>, handle: { title: 'Survey responses' } },
      { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      { path: '/faculty/sign-up', element: <p>Sign-up page</p>, handle: { title: 'Sign up', nav: '/faculty/evaluation' } },
      { path: '/faculty/observe', element: <p>Observe page</p>, handle: { title: 'Observation requests' } },
      { path: '/faculty/observe/confirmations', element: <p>Confirmations page</p>, handle: { title: 'My confirmations', nav: '/faculty/observe' } },
    ],
  }], path);
}

/** The app's own routes from App.tsx, signed in through demo mode. */
function openRealApp(path: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
  return renderRoutes([{ id: 'test-auth', element: <AuthProvider mode="demo"><Outlet /></AuthProvider>, children: router.routes }], path);
}

afterEach(() => sessionStorage.removeItem(SESSION_KEY));

const committeeNav = () => screen.getByRole('navigation', { name: 'Assessment Committee' });

describe('Dashboard pages in the sidebar', () => {
  it('lists the four dashboard pages right after Dashboard in Committee mode, indented under it', async () => {
    serve();
    openApp('/committee/dashboard');
    expect(await screen.findByText('Dashboard page')).toBeVisible();
    const links = within(committeeNav()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Dashboard', 'Due or overdue', 'Unmatched', 'Outstanding', 'Notifications', 'Cycle', 'Faculty', 'Sign-ups', 'Survey responses']);
    for (const p of PAGES) expect(within(committeeNav()).getByRole('link', { name: p.link })).toHaveAttribute('href', p.path);
    for (const p of PAGES.slice(1)) expect(within(committeeNav()).getByRole('link', { name: p.link })).toHaveClass('pl-[45px]');
    expect(within(committeeNav()).getByRole('link', { name: 'Dashboard' })).not.toHaveClass('pl-[45px]');
    // The four pages are a list nested in the Dashboard item, so screen readers hear them as its pages.
    const top = within(committeeNav()).getAllByRole('list')[0];
    const dashboardItem = within(committeeNav()).getByRole('link', { name: 'Dashboard' }).closest('li')!;
    expect(dashboardItem.parentElement).toBe(top);
    const nested = within(dashboardItem).getByRole('list');
    expect(within(nested).getAllByRole('link').map((l) => l.textContent)).toEqual(PAGES.slice(1).map((p) => p.link));
    expect([...top.children].map((li) => li.querySelector('a')?.textContent)).toEqual(['Dashboard', 'Cycle', 'Faculty', 'Sign-ups', 'Survey responses']);
  });

  it('does not show the dashboard pages in Faculty mode', async () => {
    serve(committeeMe);
    openApp('/faculty/evaluation');
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Faculty' });
    for (const p of PAGES) expect(within(nav).queryByRole('link', { name: p.link })).not.toBeInTheDocument();
  });

  it('opens each dashboard page from the sidebar and highlights only its row', async () => {
    serve();
    const user = userEvent.setup();
    const { router } = openApp('/committee/survey-responses');
    expect(await screen.findByText('Survey responses page')).toBeVisible();
    for (const p of PAGES) {
      await user.click(within(committeeNav()).getByRole('link', { name: p.link }));
      expect(router.state.location.pathname).toBe(p.path);
      expect(await screen.findByText(p.text)).toBeVisible();
      const current = within(committeeNav()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current.map((l) => l.textContent)).toEqual([p.link]);
    }
  });

  it('highlights only its own row on the other committee pages, not Dashboard', async () => {
    serve();
    const user = userEvent.setup();
    const { router } = openApp('/committee/dashboard/due');
    expect(await screen.findByText('Due list page')).toBeVisible();
    const ROWS = [
      { link: 'Cycle', path: '/committee/cycle', text: 'Cycle page' },
      { link: 'Faculty', path: '/committee/faculty', text: 'Faculty page' },
      { link: 'Sign-ups', path: '/committee/signups', text: 'Sign-up requests page' },
      { link: 'Survey responses', path: '/committee/survey-responses', text: 'Survey responses page' },
    ];
    for (const row of ROWS) {
      await user.click(within(committeeNav()).getByRole('link', { name: row.link }));
      expect(router.state.location.pathname).toBe(row.path);
      expect(await screen.findByText(row.text)).toBeVisible();
      const current = within(committeeNav()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current.map((l) => l.textContent)).toEqual([row.link]);
    }
  });

  it('highlights only Dashboard when its address ends with a slash', async () => {
    serve();
    openApp('/committee/dashboard/');
    expect(await screen.findByText('Dashboard page')).toBeVisible();
    const current = within(committeeNav()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['Dashboard']);
  });

  it('marks the row a page belongs to as current, for a page under it that has no row of its own', async () => {
    serve();
    openApp('/faculty/sign-up');
    expect(await screen.findByText('Sign-up page')).toBeVisible();
    const nav = screen.getByRole('navigation', { name: 'Faculty' });
    const current = within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual(['My evaluation']);
  });

  it('marks Observe as current on its page, also with a trailing slash, and on My confirmations', async () => {
    serve();
    for (const [path, text] of [['/faculty/observe', 'Observe page'], ['/faculty/observe/', 'Observe page'], ['/faculty/observe/confirmations', 'Confirmations page']]) {
      const view = openApp(path);
      expect(await screen.findByText(text)).toBeVisible();
      const nav = screen.getByRole('navigation', { name: 'Faculty' });
      const current = within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current.map((l) => l.textContent)).toEqual(['Observe']);
      view.unmount();
    }
  });

  it("opens each dashboard page from the app's own routes, with its title and only its part", async () => {
    serve();
    const titles: [string, string, RegExp[]][] = [
      ['/committee/dashboard', 'Cycle results (KPIs)', [/^KPI results$/, /^Executive summary$/]],
      ['/committee/dashboard/due', 'Due or overdue for evaluation', [/Due or overdue for evaluation/]],
      ['/committee/dashboard/unmatched', 'Unmatched faculty', [/Unmatched faculty/]],
      ['/committee/dashboard/outstanding', 'Outstanding observations', [/Outstanding observations/]],
      ['/committee/dashboard/notifications', 'Notifications', [/^Send notifications$/, /^Your notifications$/]],
    ];
    server.use(
      http.get('*/api/cycles/latest/kpis', () => HttpResponse.json({ cycle, computedDate: null, kpis: [] })),
      http.get('*/api/dashboard/due-by-rank', () => HttpResponse.json({ cycleId: '1', total: 1, byRank: { assistant: 1, associate: 0, full: 0 } })),
      http.get('*/api/dashboard/outstanding-observations', () => HttpResponse.json({ cycleId: '1', total: 1, byRank: { assistant: 1, associate: 0, full: 0 } })),
    );
    for (const [path, title, parts] of titles) {
      const view = openRealApp(path);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
      expect(view.router.state.location.pathname).toBe(path);
      for (const name of parts) expect(await screen.findByRole('region', { name })).toBeVisible();
      const current = within(committeeNav()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAttribute('href', path);
      view.unmount();
    }
  });

  it('sends a faculty-only account from every dashboard page to My evaluation', async () => {
    for (const p of PAGES) {
      serve(facultyMe);
      const view = openApp(p.path);
      expect(await screen.findByText('My evaluation page')).toBeVisible();
      expect(view.router.state.location.pathname).toBe('/faculty/evaluation');
      expect(screen.queryByText(p.text)).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

/** Every dashboard part that could appear on a page, by its accessible region name. */
const DUE = /Due or overdue for evaluation/;
const UNMATCHED = /Unmatched faculty/;
const OUTSTANDING = /Outstanding observations/;
const SENDS = /^Send notifications$/;
const INBOX = /^Your notifications$/;
const PARTS = [DUE, UNMATCHED, OUTSTANDING, /^Executive summary$/, /^KPI results$/, SENDS, INBOX];

const LIST_PAGES = [
  { path: '/committee/dashboard/due', element: <DueListPage />, name: DUE, description: DUE_OR_OVERDUE_TEXT, row: 'Dr. Maya Lin' },
  { path: '/committee/dashboard/unmatched', element: <UnmatchedListPage />, name: UNMATCHED, description: UNMATCHED_TEXT, row: 'Dr. Sarah Kim' },
  { path: '/committee/dashboard/outstanding', element: <OutstandingListPage />, name: OUTSTANDING, description: OUTSTANDING_TEXT, row: 'Dr. Maya Lin' },
];

function expectOnlyParts(shown: RegExp[]) {
  for (const name of PARTS) {
    if (shown.includes(name)) expect(screen.getByRole('region', { name })).toBeVisible();
    else expect(screen.queryByRole('region', { name })).not.toBeInTheDocument();
  }
}

describe('Dashboard part pages', () => {
  it('shows only its own list on each list page, with its description', async () => {
    serve();
    for (const page of LIST_PAGES) {
      const view = renderRoutes([{ path: page.path, element: page.element }], page.path);
      const region = await screen.findByRole('region', { name: page.name });
      expect(await within(region).findByText(page.row)).toBeVisible();
      expect(region).toHaveAccessibleDescription(page.description);
      expectOnlyParts([page.name]);
      view.unmount();
    }
  });

  it('shows the notification sends, then the inbox, and nothing else from the dashboard', async () => {
    serve();
    renderRoutes([{ path: '/committee/dashboard/notifications', element: <NotificationsPage /> }], '/committee/dashboard/notifications');
    const sends = await screen.findByRole('region', { name: SENDS });
    const inbox = await screen.findByRole('region', { name: INBOX });
    expect(sends.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectOnlyParts([SENDS, INBOX]);
  });

  it('keeps the sends off and shows the inbox on the notifications page before the first cycle', async () => {
    serve();
    server.use(http.get('*/api/cycles/current', () => HttpResponse.json(null)));
    renderRoutes([{ path: '/committee/dashboard/notifications', element: <NotificationsPage /> }], '/committee/dashboard/notifications');
    const sends = await screen.findByRole('region', { name: SENDS });
    expect(await within(sends).findByText('No evaluation cycle has started yet, so there is no one to notify.')).toBeVisible();
    for (const button of within(sends).getAllByRole('button')) expect(button).toBeDisabled();
    expect(await screen.findByRole('region', { name: INBOX })).toBeVisible();
    expectOnlyParts([SENDS, INBOX]);
  });

  it('says once on each list page that no cycle has started', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    for (const page of LIST_PAGES) {
      const view = renderRoutes([{ path: page.path, element: page.element }], page.path);
      const region = await screen.findByRole('region', { name: page.name });
      expect(await within(region).findByText('No evaluation cycle has started yet.')).toBeVisible();
      expect(screen.getAllByText('No evaluation cycle has started yet.')).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
