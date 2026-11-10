import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observer, otherCourse, signup, term } from '../../test/fixtures';
import type { CycleKpis, DueByRank, DueProfessor, KpiResult, Me, PersonRef, Signup, UnmatchedFaculty } from '../../api/types';
import { downloadCsv } from '../../lib/csv';
import { DUE_OR_OVERDUE_TEXT, OUTSTANDING_TEXT, UNMATCHED_TEXT } from '../../lib/statusTerms';
import { DashboardPage } from './DashboardPage';
import { DueListPage, NotificationsPage, OutstandingListPage, UnmatchedListPage } from './DashboardParts';

vi.mock('../../lib/csv', () => ({ downloadCsv: vi.fn() }));

const cs = { deptId: '1', deptName: 'Computer Science' };
const person = (netid: string, firstName: string, lastName: string, rank: PersonRef['rank']): PersonRef => ({
  netid, firstName, lastName, displayName: `Dr. ${firstName} ${lastName}`, rank,
});
const raj = person('rm1', 'Raj', 'Mehta', 'associate');
const sarah = person('sk1', 'Sarah', 'Kim', 'associate');
const laura = person('lg1', 'Laura', 'Gomez', 'associate');
const kevin = person('kl1', 'Kevin', 'Liu', 'assistant');
const dana = person('dp1', 'Dana', 'Price', 'full');

const dueProfessors: DueProfessor[] = [
  { professor: faculty, department: cs, dueStatus: 'DUE', lastObservedTerm: null },
  { professor: raj, department: { deptId: '2', deptName: 'Electrical Engineering' }, dueStatus: 'OVERDUE', lastObservedTerm: { ...term, termId: '0', year: 2024, label: 'Fall 2024' } },
];
const unmatched: UnmatchedFaculty = {
  cycleId: '1', total: 1, items: [{ signupId: '21', observee: sarah, section: otherCourse, alertType: 'no_observer' }],
};
const withObservation = (id: string, observee: PersonRef, status: 'scheduled' | 'completed' | 'not_completed', scheduledDate: string): Signup => ({
  ...signup, signupId: id, observee: { ...observee, email: `${observee.netid}@example.edu` },
  observation: { observationId: `o${id}`, observer, status, scheduledDate },
});
const signups: Signup[] = [
  signup,
  withObservation('22', laura, 'scheduled', '2026-10-29'),
  withObservation('23', kevin, 'not_completed', '2026-10-30'),
  withObservation('24', dana, 'completed', '2026-10-20'),
];
const dueByRank: DueByRank = { cycleId: '1', total: 2, byRank: { assistant: 1, associate: 1, full: 0 } };
// The outstanding-observations count as proposed in the backend PR: totals only, no rows.
const outstandingCount = { cycleId: '1', total: 3, byRank: { assistant: 2, associate: 1, full: 0 } };
const kpis: CycleKpis = { cycle, computedDate: null, kpis: [] };

const never = () => new Promise<never>(() => {});
const failure = (message: string, status = 500, code = 'FAILED') => HttpResponse.json({ error: { code, message } }, { status });
const noCycle = () => failure('No cycle has started yet.', 404, 'NO_CYCLE');

const committeeMember: Me = {
  netid: 'ic1', firstName: 'Isabel', lastName: 'Nakamura', displayName: 'Dr. Isabel Nakamura', email: 'ic1@example.edu',
  rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role: 'AC',
};

function serve() {
  server.use(
    // The notification sends and inbox on their own page (tested in NotificationControls.test.tsx).
    http.get('*/api/me', () => HttpResponse.json(committeeMember)),
    http.get('*/api/me/notifications', () => HttpResponse.json([])),
    http.get('*/api/cycles/latest/kpis', () => HttpResponse.json(kpis)),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('*/api/dashboard/due-by-rank', () => HttpResponse.json(dueByRank)),
    http.get('*/api/dashboard/outstanding-observations', () => HttpResponse.json(outstandingCount)),
    http.get('*/api/dashboard/unmatched', () => HttpResponse.json(unmatched)),
    http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(dueProfessors)),
    http.get('*/api/cycles/1/signups', () => HttpResponse.json(signups)),
  );
}

// The overview keeps the KPIs and the executive summary; each list and the sends have their own page.
const OVERVIEW = '/committee/dashboard';
const DUE_PAGE = '/committee/dashboard/due';
const UNMATCHED_PAGE = '/committee/dashboard/unmatched';
const OUTSTANDING_PAGE = '/committee/dashboard/outstanding';
const NOTIFICATIONS_PAGE = '/committee/dashboard/notifications';

function openPage(path = OVERVIEW) {
  return renderRoutes([
    { path: OVERVIEW, element: <DashboardPage /> },
    { path: DUE_PAGE, element: <DueListPage /> },
    { path: UNMATCHED_PAGE, element: <UnmatchedListPage /> },
    { path: OUTSTANDING_PAGE, element: <OutstandingListPage /> },
    { path: NOTIFICATIONS_PAGE, element: <NotificationsPage /> },
  ], path);
}

const section = (name: RegExp) => screen.getByRole('region', { name });
const dataRows = (region: HTMLElement) => within(region).getAllByRole('row').slice(1);
/** Each list, its page, and a row the default data shows on it. */
const LISTS: { name: RegExp; path: string; row: string }[] = [
  { name: /Due or overdue/, path: DUE_PAGE, row: 'Dr. Raj Mehta' },
  { name: /Unmatched faculty/, path: UNMATCHED_PAGE, row: 'Dr. Sarah Kim' },
  { name: /Outstanding observations/, path: OUTSTANDING_PAGE, row: 'Dr. Laura Gomez' },
];
const [DUE_LIST, UNMATCHED_LIST, OUTSTANDING_LIST] = LISTS;

/** Opens a list's page and waits for one of its rows, to check that it still loads. */
async function expectListLoads(list: (typeof LISTS)[number]) {
  const view = openPage(list.path);
  expect(await within(section(list.name)).findByText(list.row)).toBeVisible();
  view.unmount();
}

/** Every child of the table body is a row and every child of a row is a cell, as screen readers expect. */
function expectTableStructure(region: HTMLElement) {
  const body = within(region).getByRole('rowgroup');
  expect(body.children.length).toBeGreaterThan(0);
  for (const row of body.children) {
    expect(row).toHaveAttribute('role', 'row');
    for (const cell of row.children) expect(cell).toHaveAttribute('role', 'cell');
  }
}

/** A loading, empty or failed list shows its message in a plain box: no table and nothing that scrolls sideways. */
function expectMessageOnly(region: HTMLElement) {
  expect(within(region).queryByRole('table')).not.toBeInTheDocument();
  expect(within(region).queryByRole('group')).not.toBeInTheDocument();
}

describe('Committee dashboard detail sections', () => {
  it('shows the notification sends and the inbox on their own page, not on the overview, leaving the lists on theirs', async () => {
    serve();
    const notifications = openPage(NOTIFICATIONS_PAGE);
    const sends = await screen.findByRole('region', { name: 'Send notifications' });
    const inbox = await screen.findByRole('region', { name: 'Your notifications' });
    expect(sends.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const list of LISTS) expect(screen.queryByRole('region', { name: list.name })).not.toBeInTheDocument();
    notifications.unmount();

    const overview = openPage();
    expect(await screen.findByRole('region', { name: 'Executive summary' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Send notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your notifications' })).not.toBeInTheDocument();
    for (const list of LISTS) expect(screen.queryByRole('region', { name: list.name })).not.toBeInTheDocument();
    overview.unmount();

    openPage(DUE_PAGE);
    expect(await screen.findByText('Dr. Raj Mehta')).toBeVisible();
  });

  it('lists the faculty who are due or overdue for the current cycle, overdue first', async () => {
    serve();
    openPage(DUE_PAGE);
    expect(await screen.findByText('Dr. Raj Mehta')).toBeVisible();
    const due = section(/Due or overdue for evaluation/);
    expect(within(due).getByRole('heading')).toHaveTextContent('Due or overdue for evaluation (2)');
    const [first, second] = dataRows(due);
    expect(within(first).getByText('Dr. Raj Mehta')).toBeVisible();
    expect(within(first).getByText('Associate')).toBeVisible();
    expect(within(first).getByText('Electrical Engineering')).toBeVisible();
    expect(within(first).getByText('Fall 2024')).toBeVisible();
    expect(within(first).getByText('OVERDUE')).toBeVisible();
    expect(within(second).getByText('Dr. Maya Lin')).toBeVisible();
    expect(within(second).getByText('Not observed yet')).toBeVisible();
    expect(within(second).getByText('DUE')).toBeVisible();
  });

  it('lists unmatched faculty with their course, class time and reason', async () => {
    serve();
    server.use(http.get('*/api/dashboard/unmatched', () => HttpResponse.json({
      ...unmatched, total: 3,
      items: [
        ...unmatched.items,
        { signupId: '25', observee: kevin, section: course, alertType: 'no_acceptance' },
        { signupId: '26', observee: dana, section: course, alertType: 'insufficient_observers' },
      ],
    })));
    openPage(UNMATCHED_PAGE);
    expect(await screen.findByText('Dr. Kevin Liu')).toBeVisible();
    const region = section(/Unmatched faculty/);
    expect(within(region).getByRole('heading')).toHaveTextContent('Unmatched faculty (3)');
    const [first, second, third] = dataRows(region);
    expect(within(third).getByText('Dr. Dana Price')).toBeVisible();
    expect(within(third).getByText('Too few observers')).toBeVisible();
    expect(within(first).getByText('Dr. Sarah Kim')).toBeVisible();
    expect(within(first).getByText('CS 2336.001')).toBeVisible();
    expect(within(first).getByText('W 10:00 AM')).toBeVisible();
    expect(within(first).getByText('No observer found')).toBeVisible();
    expect(within(second).getByText('CS 1337.002')).toBeVisible();
    expect(within(second).getByText('M 8:30 AM')).toBeVisible();
    expect(within(second).getByText('No one accepted')).toBeVisible();
  });

  it('shows Online as the class time for an online section with no meetings', async () => {
    serve();
    server.use(http.get('*/api/dashboard/unmatched', () => HttpResponse.json({
      ...unmatched, items: [{ ...unmatched.items[0], section: { ...otherCourse, classMode: 'online', meetings: [] } }],
    })));
    openPage(UNMATCHED_PAGE);
    expect(await screen.findByText('Online')).toBeVisible();
    const [row] = dataRows(section(/Unmatched faculty/));
    expect(within(row).getByText('Dr. Sarah Kim')).toBeVisible();
    expect(within(row).getByText('Online')).toBeVisible();
  });

  it('lists sign-ups without a completed observation as outstanding', async () => {
    serve();
    openPage(OUTSTANDING_PAGE);
    expect(await screen.findByText('Dr. Laura Gomez')).toBeVisible();
    const region = section(/Outstanding observations/);
    expect(within(region).getByRole('heading')).toHaveTextContent('Outstanding observations (3)');
    const [none, scheduled, missed] = dataRows(region);
    expect(within(none).getByText('Dr. Maya Lin')).toBeVisible();
    expect(within(none).getByText('None yet')).toBeVisible();
    expect(within(none).getByText('No observer yet')).toBeVisible();
    expect(within(scheduled).getByText('Dr. Elena Ruiz')).toBeVisible();
    expect(within(scheduled).getByText('CS 1337.002')).toBeVisible();
    expect(within(scheduled).getByText('Oct 29, 2026')).toBeVisible();
    expect(within(scheduled).getByText('Scheduled')).toBeVisible();
    expect(within(missed).getByText('Reported as not done')).toBeVisible();
    expect(within(region).queryByText('Dr. Dana Price')).not.toBeInTheDocument();
  });

  it('pages a long list seven rows at a time, as on A3', async () => {
    serve();
    const many = Array.from({ length: 10 }, (_, i): DueProfessor => ({
      professor: person(`p${i}`, 'Test', `Person ${i + 1}`, 'full'), department: cs, dueStatus: 'DUE', lastObservedTerm: null,
    }));
    server.use(http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(many)));
    const user = userEvent.setup();
    openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByText('Dr. Test Person 7')).toBeVisible();
    expect(within(due).queryByText('Dr. Test Person 8')).not.toBeInTheDocument();
    expect(within(due).getByText('1 to 7 of 10')).toBeVisible();
    await user.click(within(due).getByRole('button', { name: 'Next page' }));
    expect(within(due).getByText('Dr. Test Person 10')).toBeVisible();
    expect(within(due).getByText('8 to 10 of 10')).toBeVisible();
  });

  it('says a list is empty only after it loads with no rows', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/1/due-professors', () => HttpResponse.json([])),
      http.get('*/api/dashboard/unmatched', () => HttpResponse.json({ cycleId: '1', total: 0, items: [] })),
      http.get('*/api/cycles/1/signups', () => HttpResponse.json([signups[3]])),
    );
    const empty: [(typeof LISTS)[number], string][] = [
      [DUE_LIST, 'Nobody is due or overdue this cycle.'],
      [UNMATCHED_LIST, 'No unmatched faculty.'],
      [OUTSTANDING_LIST, 'Every sign-up has a completed observation.'],
    ];
    for (const [list, text] of empty) {
      const view = openPage(list.path);
      expect(await within(section(list.name)).findByText(text)).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(section(list.name)).getByRole('heading')).not.toHaveTextContent(/\(\d+\)/);
      expectMessageOnly(section(list.name));
      view.unmount();
    }
  });

  it('makes a table a keyboard stop only while it is too wide to show at once', async () => {
    serve();
    // jsdom has no layout: every box measures 0 wide, so the tables fit.
    for (const { name, path, row } of LISTS) {
      const view = openPage(path);
      expect(await screen.findByText(row)).toBeVisible();
      const scroller = within(section(name)).getByRole('group', { name });
      expect(scroller).not.toHaveAttribute('tabindex');
      expect(within(scroller).getByRole('table')).toBeVisible();
      expectTableStructure(section(name));
      view.unmount();
    }

    const wide = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const box = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      for (const { name, path, row } of LISTS) {
        const view = openPage(path);
        expect(await screen.findByText(row)).toBeVisible();
        expect(within(section(name)).getByRole('group', { name })).toHaveAttribute('tabindex', '0');
        view.unmount();
      }
    } finally {
      wide.mockRestore();
      box.mockRestore();
    }
  });

  it('shows loading text, not an empty list, while a list is pending', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', never));
    const view = openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByText('Loading faculty…')).toBeVisible();
    expect(within(due).queryByText('Nobody is due or overdue this cycle.')).not.toBeInTheDocument();
    expectMessageOnly(due);
    view.unmount();
    await expectListLoads(OUTSTANDING_LIST);
  });

  it('shows a failed list as an error while the other lists still load', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', () => failure('The requested endpoint does not exist.', 404, 'NOT_FOUND')));
    const view = openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByRole('alert')).toHaveTextContent('The requested endpoint does not exist.');
    expect(within(due).queryByText('Nobody is due or overdue this cycle.')).not.toBeInTheDocument();
    expect(within(due).getByRole('heading')).toHaveTextContent(/^Due or overdue for evaluation$/);
    expectMessageOnly(due);
    view.unmount();
    await expectListLoads(UNMATCHED_LIST);
    await expectListLoads(OUTSTANDING_LIST);
  });

  it('shows failed unmatched and outstanding lists as errors while the due list still loads', async () => {
    serve();
    server.use(
      http.get('*/api/dashboard/unmatched', () => failure('Unmatched faculty could not be read.')),
      http.get('*/api/cycles/1/signups', () => failure('Sign-ups could not be read.')),
    );
    const unmatchedView = openPage(UNMATCHED_PAGE);
    expect(await within(section(/Unmatched faculty/)).findByRole('alert')).toHaveTextContent('Unmatched faculty could not be read.');
    expect(within(section(/Unmatched faculty/)).queryByText('No unmatched faculty.')).not.toBeInTheDocument();
    unmatchedView.unmount();
    const outstandingView = openPage(OUTSTANDING_PAGE);
    expect(await within(section(/Outstanding observations/)).findByRole('alert')).toHaveTextContent('Sign-ups could not be read.');
    expect(within(section(/Outstanding observations/)).queryByText('Every sign-up has a completed observation.')).not.toBeInTheDocument();
    outstandingView.unmount();
    await expectListLoads(DUE_LIST);
  });

  it('shows an error in the cycle lists when the current cycle cannot be read', async () => {
    serve();
    server.use(http.get('*/api/cycles/current', () => failure('The current cycle could not be read.')));
    const dueView = openPage(DUE_PAGE);
    expect(await within(section(/Due or overdue/)).findByRole('alert')).toHaveTextContent('The current cycle could not be read.');
    expect(within(section(/Due or overdue/)).queryByText('No evaluation cycle has started yet.')).not.toBeInTheDocument();
    dueView.unmount();
    const outstandingView = openPage(OUTSTANDING_PAGE);
    expect(await within(section(/Outstanding observations/)).findByRole('alert')).toHaveTextContent('The current cycle could not be read.');
    outstandingView.unmount();
    await expectListLoads(UNMATCHED_LIST);
  });

  it('says once that no cycle has started, instead of errors, zeros or empty lists', async () => {
    server.use(
      http.get('*/api/cycles/latest/kpis', () => failure('Cycle not found.', 404, 'NOT_FOUND')),
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/dashboard/due-by-rank', noCycle),
      http.get('*/api/dashboard/outstanding-observations', noCycle),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    openPage();
    expect(await screen.findByText('No evaluation cycle has started yet.')).toBeVisible();
    expect(screen.getAllByText(/No evaluation cycle has started yet/)).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cycle not found/)).not.toBeInTheDocument();
  });
});

describe('Committee dashboard executive summary', () => {
  const summary = () => screen.getByRole('region', { name: 'Executive summary' });
  /** One count in the summary, found by its label. */
  const count = (label: string) => within(summary()).getByText(label).parentElement!;

  it('shows the counts from the dashboard endpoints', async () => {
    serve();
    openPage();
    expect(await within(summary()).findByText('Assistant 1, Associate 1, Full 0')).toBeVisible();
    expect(await within(summary()).findByText('Assistant 2, Associate 1, Full 0')).toBeVisible();
    expect(await within(summary()).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
  });

  it('links the Unmatched faculty summary to the sign-up requests page', async () => {
    serve();
    const { router } = renderRoutes([
      { path: '/committee/dashboard', element: <DashboardPage /> },
      { path: '/committee/signups', element: <p>Sign-up requests page</p> },
    ], '/committee/dashboard');
    const detail = await within(summary()).findByText('Dr. Sarah Kim, CS 2336.001');
    expect(await within(summary()).findByText('Assistant 1, Associate 1, Full 0')).toBeVisible();
    expect(await within(summary()).findByText('Assistant 2, Associate 1, Full 0')).toBeVisible();
    const link = within(summary()).getByRole('link', { name: 'Open in Sign-ups' });
    // Once every count has loaded, the summary holds the three View links and this one, and nothing else.
    expect(within(summary()).getAllByRole('link').map((a) => a.textContent)).toEqual(['View due or overdue faculty', 'View outstanding observations', 'View unmatched faculty', 'Open in Sign-ups']);
    expect(link).toHaveAttribute('href', '/committee/signups');
    const cell = within(summary()).getByText('Unmatched faculty').parentElement!;
    expect(cell).toContainElement(link);
    expect(within(cell).getAllByRole('link').map((a) => a.textContent)).toEqual(['View unmatched faculty', 'Open in Sign-ups']);
    expect(detail.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(link);
    expect(await screen.findByText('Sign-up requests page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/committee/signups');
  });

  it('never shows 0 for a count that is loading or failed', async () => {
    serve();
    server.use(
      http.get('*/api/dashboard/due-by-rank', never),
      http.get('*/api/dashboard/outstanding-observations', () => failure('The requested endpoint does not exist.', 404, 'NOT_FOUND')),
    );
    openPage();
    expect(await within(summary()).findByText("Couldn't load")).toBeVisible();
    expect(await within(summary()).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
    expect(count('Due for evaluation')).toHaveTextContent(/^Due for evaluation–LoadingView due or overdue faculty$/);
    expect(within(count('Signed up but not observed')).getByRole('alert')).toHaveTextContent("Signed up but not observed: Couldn't load");
    expect(within(count('Signed up but not observed')).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(within(summary()).queryByText('0')).not.toBeInTheDocument();
  });

  it("links each count to its list's own page", async () => {
    serve();
    const user = userEvent.setup();
    const LINKS: [string, string, (typeof LISTS)[number]][] = [
      ['Due for evaluation', 'View due or overdue faculty', DUE_LIST],
      ['Signed up but not observed', 'View outstanding observations', OUTSTANDING_LIST],
      ['Unmatched faculty', 'View unmatched faculty', UNMATCHED_LIST],
    ];
    for (const [label, link, list] of LINKS) {
      const view = openPage();
      expect(await within(summary()).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
      const anchor = within(count(label)).getByRole('link', { name: link });
      expect(anchor).toHaveAttribute('href', list.path);
      await user.click(anchor);
      expect(view.router.state.location.pathname).toBe(list.path);
      expect(await within(section(list.name)).findByText(list.row)).toBeVisible();
      expect(screen.queryByRole('region', { name: 'Executive summary' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('keeps the links while the counts load, fail or wait for the first cycle', async () => {
    const names = () => within(summary()).getAllByRole('link').map((a) => a.textContent);
    const all = ['View due or overdue faculty', 'View outstanding observations', 'View unmatched faculty', 'Open in Sign-ups'];
    serve();
    server.use(
      http.get('*/api/dashboard/due-by-rank', never),
      http.get('*/api/dashboard/outstanding-observations', () => failure('Server error.')),
    );
    const loading = openPage();
    expect(await within(summary()).findByText("Couldn't load")).toBeVisible();
    expect(names()).toEqual(all);
    loading.unmount();

    serve();
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/dashboard/due-by-rank', noCycle),
      http.get('*/api/dashboard/outstanding-observations', noCycle),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    openPage();
    // The KPIs of an older cycle still arrive, so the summary stays and each count says no cycle.
    expect(await within(count('Due for evaluation')).findByText('No evaluation cycle has started yet.')).toBeVisible();
    expect(names()).toEqual(all);
  });
});

/** Answers the first request with `first` and every later one with `then`. */
function sequence(first: () => Response, then: () => Response | Promise<never>) {
  let calls = 0;
  return () => (calls++ === 0 ? first() : then());
}

const KPI_NAMES = [
  'Evaluation Eligibility Accuracy', 'Overdue Evaluation Count', 'Assessment Participation Rate', 'Observer Utilization Rate',
  'List Sufficiency Rate', 'Missing Observation Count', 'Survey Completion Rate',
];
const kpiCard = (name: string) => screen.getByRole('heading', { name }).parentElement!;
const kpiResults: KpiResult[] = [
  { kpiCode: '2.1', numerator: 14, denominator: 15, kpiValue: 14 / 15, computedDate: '2026-10-02' },
  { kpiCode: '1.2', numerator: 3, denominator: 3, kpiValue: 3, computedDate: '2026-10-02' },
];
const closedKpis: CycleKpis = { cycle, computedDate: '2026-10-02', kpis: kpiResults };
const summaryCount = (label: string) => within(screen.getByRole('region', { name: 'Executive summary' })).getByText(label).parentElement!;
const pagerButtons = (nav: HTMLElement) => within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

/** Counts the requests to each API path, so a test can check which ones Try again repeated. */
function countReads() {
  const reads: Record<string, number> = {};
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname;
    reads[path] = (reads[path] ?? 0) + 1;
  });
  return reads;
}

describe('Committee dashboard recovery', () => {
  it('loads a failed list again with Try again, repeating only the request that failed', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', sequence(() => failure('Server error.'), () => HttpResponse.json(dueProfessors))));
    const reads = countReads();
    try {
      const user = userEvent.setup();
      openPage(DUE_PAGE);
      const due = section(/Due or overdue/);
      expect(await within(due).findByRole('alert')).toHaveTextContent("Couldn't load this list: Server error.");
      const before = { ...reads };
      await user.click(within(due).getByRole('button', { name: 'Try again' }));
      expect(await within(due).findByText('Dr. Raj Mehta')).toBeVisible();
      expect(within(due).queryByRole('alert')).not.toBeInTheDocument();
      expect(Object.keys(reads).filter((path) => reads[path] !== before[path])).toEqual(['/api/cycles/1/due-professors']);
    } finally {
      server.events.removeAllListeners();
    }
  });

  it('moves focus to the list heading on Try again, and keeps it there when the list fails again', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', sequence(() => failure('Server error.'), () => failure('Still down.'))));
    const user = userEvent.setup();
    openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    await user.click(await within(due).findByRole('button', { name: 'Try again' }));
    expect(within(due).getByRole('heading')).toHaveFocus();
    expect(await within(due).findByRole('alert')).toHaveTextContent("Couldn't load this list: Still down.");
    expect(within(due).getByRole('heading')).toHaveFocus();
  });

  it('shows the list loading again while a retry of a failed list is pending', async () => {
    serve();
    server.use(http.get('*/api/dashboard/unmatched', sequence(() => failure('Server error.'), never)));
    const user = userEvent.setup();
    openPage(UNMATCHED_PAGE);
    const region = section(/Unmatched faculty/);
    await user.click(await within(region).findByRole('button', { name: 'Try again' }));
    expect(await within(region).findByText('Loading unmatched faculty…')).toBeVisible();
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says it is trying again while a failed refresh is retried, without dropping focus', async () => {
    serve();
    const user = userEvent.setup();
    const { queryClient } = openPage(UNMATCHED_PAGE);
    const region = section(/Unmatched faculty/);
    expect(await within(region).findByText('Dr. Sarah Kim')).toBeVisible();
    server.use(http.get('*/api/dashboard/unmatched', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    server.use(http.get('*/api/dashboard/unmatched', never));
    await user.click(await within(region).findByRole('button', { name: 'Try again' }));
    expect(await within(region).findByRole('button', { name: 'Trying again…' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(region).getByRole('heading')).toHaveFocus();
    expect(within(region).getByText('Dr. Sarah Kim')).toBeVisible();
  });

  it('keeps the last rows when a refresh fails, then recovers with Try again', async () => {
    serve();
    const user = userEvent.setup();
    const { queryClient } = openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByText('Dr. Raj Mehta')).toBeVisible();
    server.use(http.get('*/api/cycles/1/due-professors', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    expect(await within(due).findByRole('alert')).toHaveTextContent("Couldn't refresh this list: Server error.");
    expect(within(due).getByText('Dr. Raj Mehta')).toBeVisible();
    expect(within(due).getByRole('heading')).toHaveTextContent('Due or overdue for evaluation (2)');
    server.use(http.get('*/api/cycles/1/due-professors', () => HttpResponse.json([dueProfessors[0]])));
    await user.click(within(due).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(due).queryByRole('alert')).not.toBeInTheDocument());
    expect(within(due).getByRole('heading')).toHaveTextContent('Due or overdue for evaluation (1)');
    expect(within(due).queryByText('Dr. Raj Mehta')).not.toBeInTheDocument();
  });

  it('keeps the outstanding rows when their refresh fails', async () => {
    serve();
    const { queryClient } = openPage(OUTSTANDING_PAGE);
    const region = section(/Outstanding observations/);
    expect(await within(region).findByText('Dr. Laura Gomez')).toBeVisible();
    server.use(http.get('*/api/cycles/1/signups', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    expect(await within(region).findByRole('alert')).toHaveTextContent("Couldn't refresh this list: Server error.");
    expect(within(region).getByText('Dr. Laura Gomez')).toBeVisible();
  });

  it('does not mark a list stale when only the cycle check failed to refresh', async () => {
    // Both cycle lists read the current cycle; each is on its own page.
    for (const list of [DUE_LIST, OUTSTANDING_LIST]) {
      serve();
      const view = openPage(list.path);
      expect(await screen.findByText(list.row)).toBeVisible();
      server.use(http.get('*/api/cycles/current', () => failure('Cycle read failed.')));
      await act(() => view.queryClient.refetchQueries());
      expect(view.queryClient.getQueryState(['cycles', 'current'])?.status).toBe('error');
      // The query client hands results to the page on a timer, so let it run before checking that nothing appeared.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(within(section(list.name)).queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(list.row)).toBeVisible();
      view.unmount();
    }
  });

  it('says no cycle without a Try again where the routes report none, while the cycle check itself failed', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', () => failure('Cycle read failed.')),
      http.get('*/api/cycles/latest/kpis', () => failure('Cycle not found.', 404, 'NOT_FOUND')),
      http.get('*/api/dashboard/due-by-rank', noCycle),
      http.get('*/api/dashboard/outstanding-observations', noCycle),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    const overview = openPage();
    expect(await within(summaryCount('Due for evaluation')).findByText('No evaluation cycle has started yet.')).toBeVisible();
    const summary = screen.getByRole('region', { name: 'Executive summary' });
    expect(within(summary).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    overview.unmount();

    const unmatchedView = openPage(UNMATCHED_PAGE);
    const unmatchedList = section(/Unmatched faculty/);
    expect(await within(unmatchedList).findByText('No evaluation cycle has started yet.')).toBeVisible();
    expect(within(unmatchedList).queryByRole('alert')).not.toBeInTheDocument();
    unmatchedView.unmount();

    // The two cycle lists need the cycle itself, so they show its failure.
    for (const list of [DUE_LIST, OUTSTANDING_LIST]) {
      const view = openPage(list.path);
      expect(await within(section(list.name)).findByRole('alert')).toHaveTextContent("Couldn't load this list: Cycle read failed.");
      view.unmount();
    }
  });

  it('keeps the Figma column order while a table fits, and moves the status next to the name while it scrolls', async () => {
    serve();
    const head = (name: RegExp) => within(section(name)).getAllByRole('columnheader').map((h) => h.textContent);
    const COLUMNS: [(typeof LISTS)[number], string[], string[]][] = [
      [DUE_LIST, ['Name', 'Rank', 'Department', 'Last observed', 'Status'], ['Name', 'Status', 'Rank', 'Department', 'Last observed']],
      [UNMATCHED_LIST, ['Observee', 'Rank', 'Course', 'Days and time', 'Reason'], ['Observee', 'Reason', 'Rank', 'Course', 'Days and time']],
      [OUTSTANDING_LIST, ['Observee', 'Rank', 'Observer', 'Course', 'Date', 'Status'], ['Observee', 'Status', 'Rank', 'Observer', 'Course', 'Date']],
    ];
    // jsdom has no layout, so every table fits.
    for (const [list, fits] of COLUMNS) {
      const view = openPage(list.path);
      expect(await screen.findByText(list.row)).toBeVisible();
      expect(head(list.name)).toEqual(fits);
      if (list === DUE_LIST) expect(within(dataRows(section(list.name))[0]).getAllByRole('cell')[4]).toHaveTextContent('OVERDUE');
      view.unmount();
    }

    const wide = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const box = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      for (const [list, , scrolls] of COLUMNS) {
        const view = openPage(list.path);
        expect(await screen.findByText(list.row)).toBeVisible();
        await waitFor(() => expect(head(list.name)).toEqual(scrolls));
        if (list === DUE_LIST) expect(within(dataRows(section(list.name))[0]).getAllByRole('cell')[1]).toHaveTextContent('OVERDUE');
        view.unmount();
      }
    } finally {
      wide.mockRestore();
      box.mockRestore();
    }
  });

  it('shows a long error in full, in a plain box rather than a table that scrolls', async () => {
    serve();
    const long = 'The server could not finish this request because the database did not answer in time.';
    server.use(http.get('*/api/cycles/1/due-professors', () => failure(long)));
    openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByRole('alert')).toHaveTextContent(`Couldn't load this list: ${long}`);
    expectMessageOnly(due);
  });

  it('shows Loading, not the cycle error, for a list whose own request is still running', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', sequence(() => HttpResponse.json(cycle), () => failure('Cycle read failed.'))),
      http.get('*/api/cycles/1/due-professors', never),
    );
    const { queryClient } = openPage(DUE_PAGE);
    const due = section(/Due or overdue/);
    expect(await within(due).findByText('Loading faculty…')).toBeVisible();
    await act(() => queryClient.refetchQueries({ queryKey: ['cycles', 'current'] }));
    expect(queryClient.getQueryState(['cycles', 'current'])?.status).toBe('error');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(within(due).getByText('Loading faculty…')).toBeVisible();
    expect(within(due).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says no one has signed up yet when the cycle has no sign-ups', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/signups', () => HttpResponse.json([])));
    openPage(OUTSTANDING_PAGE);
    const region = section(/Outstanding observations/);
    expect(await within(region).findByText('No one has signed up yet this cycle.')).toBeVisible();
    expect(within(region).queryByText('Every sign-up has a completed observation.')).not.toBeInTheDocument();
  });

  it('offers one Try again for a failed unmatched request on its list page', async () => {
    serve();
    server.use(http.get('*/api/dashboard/unmatched', () => failure('Server error.')));
    openPage(UNMATCHED_PAGE);
    const region = section(/Unmatched faculty/);
    expect(await within(region).findByRole('alert')).toHaveTextContent("Couldn't load this list: Server error.");
    expect(within(region).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });

  it('loads a failed count again with Try again', async () => {
    serve();
    server.use(http.get('*/api/dashboard/outstanding-observations', sequence(() => failure('Server error.'), () => HttpResponse.json(outstandingCount))));
    const user = userEvent.setup();
    openPage();
    expect(await within(summaryCount('Signed up but not observed')).findByText("Couldn't load")).toHaveClass('text-red-800');
    await user.click(within(summaryCount('Signed up but not observed')).getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('heading', { name: 'Executive summary' })).toHaveFocus();
    expect(await within(summaryCount('Signed up but not observed')).findByText('Assistant 2, Associate 1, Full 0')).toBeVisible();
    expect(within(summaryCount('Signed up but not observed')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps a count when its refresh fails and says so', async () => {
    serve();
    const user = userEvent.setup();
    const { queryClient } = openPage();
    expect(await within(summaryCount('Due for evaluation')).findByText('Assistant 1, Associate 1, Full 0')).toBeVisible();
    server.use(http.get('*/api/dashboard/due-by-rank', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    expect(await within(summaryCount('Due for evaluation')).findByText("Couldn't refresh.")).toBeVisible();
    expect(summaryCount('Due for evaluation')).toHaveTextContent(/^Due for evaluation2Assistant 1, Associate 1, Full 0/);
    server.use(http.get('*/api/dashboard/due-by-rank', () => HttpResponse.json({ ...dueByRank, total: 5, byRank: { assistant: 5, associate: 0, full: 0 } })));
    await user.click(within(summaryCount('Due for evaluation')).getByRole('button', { name: 'Try again' }));
    expect(await within(summaryCount('Due for evaluation')).findByText('Assistant 5, Associate 0, Full 0')).toBeVisible();
    expect(within(summaryCount('Due for evaluation')).queryByText("Couldn't refresh.")).not.toBeInTheDocument();
  });

  it('shows Loading on the KPI cards, never N/A, while the KPIs load', async () => {
    serve();
    server.use(http.get('*/api/cycles/latest/kpis', never));
    openPage();
    expect(await within(summaryCount('Unmatched faculty')).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
    for (const name of KPI_NAMES) {
      expect(within(kpiCard(name)).getByText('–')).toBeVisible();
      expect(within(kpiCard(name)).getByText('Loading')).toBeVisible();
    }
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('shows a KPI failure with Try again, then the values, and exports them as CSV', async () => {
    serve();
    vi.mocked(downloadCsv).mockClear();
    server.use(http.get('*/api/cycles/latest/kpis', sequence(() => failure('Server error.'), () => HttpResponse.json(closedKpis))));
    const user = userEvent.setup();
    openPage();
    expect(await screen.findByText("Couldn't load the KPIs: Server error.")).toBeVisible();
    for (const name of KPI_NAMES) expect(within(kpiCard(name)).getByText("Couldn't load")).toBeVisible();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('region', { name: 'KPI results' })).toHaveFocus();
    expect(await within(kpiCard('Assessment Participation Rate')).findByText('93%')).toBeVisible();
    expect(within(kpiCard('Overdue Evaluation Count')).getByText('3')).toBeVisible();
    expect(screen.queryByText(/Couldn't load the KPIs/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('kpis', 'Fall 2026', [
      ['kpi_code', 'name', 'numerator', 'denominator', 'value', 'computed_date'],
      ['2.1', 'Assessment Participation Rate', '14', '15', String(14 / 15), '2026-10-02'],
      ['1.2', 'Overdue Evaluation Count', '3', '3', '3', '2026-10-02'],
    ]);
  });

  it('shows N/A only for KPIs that loaded without a value', async () => {
    serve();
    openPage();
    expect(await screen.findAllByText('N/A')).toHaveLength(7);
    expect(screen.getAllByText('Generated after the feedback deadline.')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('keeps the KPIs when a refresh fails', async () => {
    serve();
    server.use(http.get('*/api/cycles/latest/kpis', () => HttpResponse.json(closedKpis)));
    const { queryClient } = openPage();
    expect(await within(kpiCard('Assessment Participation Rate')).findByText('93%')).toBeVisible();
    server.use(http.get('*/api/cycles/latest/kpis', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    expect(await screen.findByText("Couldn't refresh the KPIs: Server error.")).toBeVisible();
    expect(within(kpiCard('Assessment Participation Rate')).getByText('93%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  it('keeps the KPI cards loading, without an error, until the current cycle is known', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', never),
      http.get('*/api/cycles/latest/kpis', () => failure('Cycle not found.', 404, 'NOT_FOUND')),
    );
    openPage();
    for (const name of KPI_NAMES) expect(await within(kpiCard(name)).findByText('Loading')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Cycle not found/)).not.toBeInTheDocument();
    expect(within(kpiCard('Survey Completion Rate')).getByText('Loading')).toBeVisible();
  });

  it('retries the cycle with the KPIs when both failed, then says no cycle has started', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', sequence(() => failure('Cycle read failed.'), () => HttpResponse.json(null))),
      http.get('*/api/cycles/latest/kpis', () => failure('Cycle not found.', 404, 'NOT_FOUND')),
      http.get('*/api/dashboard/due-by-rank', noCycle),
      http.get('*/api/dashboard/outstanding-observations', noCycle),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    const reads = countReads();
    try {
      const user = userEvent.setup();
      openPage();
      expect(await screen.findByText("Couldn't load the KPIs: Cycle not found.")).toBeVisible();
      const kpiTryAgain = screen.getByText(/Couldn't load the KPIs/).parentElement!.querySelector('button')!;
      const before = { ...reads };
      await user.click(kpiTryAgain);
      const message = await screen.findByText('No evaluation cycle has started yet.');
      // The KPI block that Try again focused is gone, so focus moves to the message, not the page body.
      await waitFor(() => expect(message.closest('[tabindex="-1"]')).toHaveFocus());
      expect(reads['/api/cycles/current']).toBe(before['/api/cycles/current'] + 1);
      expect(reads['/api/cycles/latest/kpis']).toBe(before['/api/cycles/latest/kpis'] + 1);
    } finally {
      server.events.removeAllListeners();
    }
  });
});

describe('Committee dashboard counts and cycle edge cases', () => {
  it('notes and announces a failed refresh of the unmatched count, with its own Try again now that the list is on its own page', async () => {
    serve();
    const { queryClient } = openPage();
    expect(await within(summaryCount('Unmatched faculty')).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
    server.use(http.get('*/api/dashboard/unmatched', () => failure('Server error.')));
    await act(() => queryClient.refetchQueries());
    expect(await within(summaryCount('Unmatched faculty')).findByRole('alert')).toHaveTextContent("Unmatched faculty: Couldn't refresh.");
    expect(within(summaryCount('Unmatched faculty')).getByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
    expect(within(summaryCount('Unmatched faculty')).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByRole('region', { name: /Unmatched faculty/ })).not.toBeInTheDocument();
  });

  it('loads a failed unmatched count again with its own Try again on the overview, repeating only that request', async () => {
    serve();
    server.use(http.get('*/api/dashboard/unmatched', sequence(() => failure('Server error.'), () => HttpResponse.json(unmatched))));
    const reads = countReads();
    try {
      const user = userEvent.setup();
      openPage();
      const cell = () => summaryCount('Unmatched faculty');
      expect(await within(cell()).findByRole('alert')).toHaveTextContent("Unmatched faculty: Couldn't load");
      expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
      // Let the other counts and the KPIs settle, so only Try again's own request is counted below.
      expect(await within(summaryCount('Due for evaluation')).findByText('Assistant 1, Associate 1, Full 0')).toBeVisible();
      expect(await within(summaryCount('Signed up but not observed')).findByText('Assistant 2, Associate 1, Full 0')).toBeVisible();
      expect(await screen.findAllByText('N/A')).toHaveLength(7);
      const before = { ...reads };
      await user.click(within(cell()).getByRole('button', { name: 'Try again' }));
      expect(screen.getByRole('heading', { name: 'Executive summary' })).toHaveFocus();
      expect(await within(cell()).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
      expect(within(cell()).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(cell()).queryByRole('button')).not.toBeInTheDocument();
      expect(Object.keys(reads).filter((path) => reads[path] !== before[path])).toEqual(['/api/dashboard/unmatched']);
    } finally {
      server.events.removeAllListeners();
    }
  });

  it('announces a failed count, and announces it again when Try again fails again', async () => {
    serve();
    server.use(http.get('*/api/dashboard/outstanding-observations', () => failure('Server error.')));
    const user = userEvent.setup();
    openPage();
    const cell = () => summaryCount('Signed up but not observed');
    const first = await within(cell()).findByRole('alert');
    expect(first).toHaveTextContent("Signed up but not observed: Couldn't load");
    await user.click(within(cell()).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(cell()).getByRole('alert')).not.toBe(first));
    expect(within(cell()).getByRole('alert')).toHaveTextContent("Signed up but not observed: Couldn't load");
  });

  it('keeps the single no-cycle message when a later check of the cycle fails', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/cycles/latest/kpis', () => failure('Cycle not found.', 404, 'NOT_FOUND')),
    );
    const { queryClient } = openPage();
    expect(await screen.findByText('No evaluation cycle has started yet.')).toBeVisible();
    server.use(http.get('*/api/cycles/current', () => failure('Cycle read failed.')));
    await act(() => queryClient.refetchQueries());
    expect(queryClient.getQueryState(['cycles', 'current'])?.status).toBe('error');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByText('No evaluation cycle has started yet.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows KPIs that arrived even while an older answer says no cycle, and says no cycle in the lists', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/cycles/latest/kpis', () => HttpResponse.json(closedKpis)),
    );
    const overview = openPage();
    expect(await within(kpiCard('Assessment Participation Rate')).findByText('93%')).toBeVisible();
    overview.unmount();
    for (const list of [DUE_LIST, OUTSTANDING_LIST]) {
      const view = openPage(list.path);
      expect(await within(section(list.name)).findByText('No evaluation cycle has started yet.')).toBeVisible();
      view.unmount();
    }
  });
});

describe('Committee dashboard pager', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i): DueProfessor => ({
    professor: person(`p${i}`, 'Test', `Person ${i + 1}`, 'full'), department: cs, dueStatus: 'DUE', lastObservedTerm: null,
  }));

  it('condenses many pages to the first, the last and the nearby ones, with a landmark named after each list', async () => {
    serve();
    const pending = Array.from({ length: 9 }, (_, i): Signup => ({ ...signup, signupId: `s${i}`, observee: { ...person(`o${i}`, 'Open', `Signup ${i + 1}`, 'full'), email: `o${i}@example.edu` } }));
    server.use(
      http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(people(60))),
      http.get('*/api/cycles/1/signups', () => HttpResponse.json(pending)),
    );
    const user = userEvent.setup();
    const outstanding = openPage(OUTSTANDING_PAGE);
    expect(await screen.findByRole('navigation', { name: 'Outstanding observations pages' })).toBeVisible();
    outstanding.unmount();
    openPage(DUE_PAGE);
    const nav = await screen.findByRole('navigation', { name: 'Due or overdue for evaluation pages' });
    expect(within(nav).getByText('1 to 7 of 60')).toBeVisible();
    expect(pagerButtons(nav)).toEqual(['Previous page', 'Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5', 'Page 9', 'Next page']);
    await user.click(within(nav).getByRole('button', { name: 'Page 9' }));
    expect(pagerButtons(nav)).toEqual(['Previous page', 'Page 1', 'Page 5', 'Page 6', 'Page 7', 'Page 8', 'Page 9', 'Next page']);
    await user.click(within(nav).getByRole('button', { name: 'Page 5' }));
    expect(within(nav).getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page');
    expect(pagerButtons(nav)).toEqual(['Previous page', 'Page 1', 'Page 4', 'Page 5', 'Page 6', 'Page 9', 'Next page']);
    expect(within(nav).getAllByText('…')).toHaveLength(2);
  });

  it('keeps seven page slots on every page, and never hides a single page behind an ellipsis', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(people(12 * 7))));
    const user = userEvent.setup();
    openPage(DUE_PAGE);
    const nav = await screen.findByRole('navigation', { name: 'Due or overdue for evaluation pages' });
    const slots = () => [...nav.querySelectorAll('span.flex-wrap > *')].slice(1, -1).map((el) => (el.textContent === '…' ? null : Number(el.textContent)));
    for (let page = 1; page <= 12; page++) {
      const shown = slots();
      expect(shown).toHaveLength(7);
      shown.forEach((n, i) => {
        if (n === null) expect((shown[i + 1] as number) - (shown[i - 1] as number)).toBeGreaterThanOrEqual(3);
      });
      expect(shown).toContain(page);
      if (page < 12) await user.click(within(nav).getByRole('button', { name: 'Next page' }));
    }
  });

  it('lists every page when there are seven or fewer', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(people(7 * 7))));
    openPage(DUE_PAGE);
    const nav = await screen.findByRole('navigation', { name: 'Due or overdue for evaluation pages' });
    expect(pagerButtons(nav)).toEqual(['Previous page', ...Array.from({ length: 7 }, (_, i) => `Page ${i + 1}`), 'Next page']);
    expect(within(nav).queryByText('…')).not.toBeInTheDocument();
  });

  it('keeps Next focused and inert on the last page', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(people(10))));
    const user = userEvent.setup();
    openPage(DUE_PAGE);
    const nav = await screen.findByRole('navigation', { name: 'Due or overdue for evaluation pages' });
    const next = within(nav).getByRole('button', { name: 'Next page' });
    await user.click(next);
    expect(within(nav).getByText('8 to 10 of 10')).toBeVisible();
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveFocus();
    await user.click(next);
    expect(within(nav).getByText('8 to 10 of 10')).toBeVisible();
    expect(next).toHaveFocus();
    expect(within(nav).getByRole('button', { name: 'Previous page' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('Committee dashboard list descriptions', () => {
  const DESCRIBED: [(typeof LISTS)[number], string][] = [
    [DUE_LIST, DUE_OR_OVERDUE_TEXT],
    [UNMATCHED_LIST, UNMATCHED_TEXT],
    [OUTSTANDING_LIST, OUTSTANDING_TEXT],
  ];

  /** Opens each list's page, waits for the text that list shows in this state, and checks its description. */
  async function expectEachDescribed(shown: [string | RegExp, string | RegExp, string | RegExp]) {
    for (const [i, [list, text]] of DESCRIBED.entries()) {
      const view = openPage(list.path);
      expect(await within(section(list.name)).findByText(shown[i])).toBeVisible();
      expectDescribed(list.name, text);
      view.unmount();
    }
  }

  /** The description sits right under the list's heading and the list is described by it. */
  function expectDescribed(name: RegExp, text: string) {
    const region = section(name);
    expect(region).toHaveAccessibleDescription(text);
    const line = within(region).getByText(text);
    expect(line.tagName).toBe('P');
    expect(within(region).getByRole('heading').nextElementSibling).toBe(line);
  }

  it('describes each list under its heading once the lists load', async () => {
    serve();
    await expectEachDescribed(['Dr. Raj Mehta', 'Dr. Sarah Kim', 'Dr. Laura Gomez']);
  });

  it('describes each list while it loads', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/1/due-professors', never),
      http.get('*/api/dashboard/unmatched', never),
      http.get('*/api/cycles/1/signups', never),
    );
    await expectEachDescribed(['Loading faculty…', 'Loading unmatched faculty…', 'Loading observations…']);
  });

  it('describes each list when it is empty', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/1/due-professors', () => HttpResponse.json([])),
      http.get('*/api/dashboard/unmatched', () => HttpResponse.json({ ...unmatched, total: 0, items: [] })),
      http.get('*/api/cycles/1/signups', () => HttpResponse.json([])),
    );
    await expectEachDescribed(['Nobody is due or overdue this cycle.', 'No unmatched faculty.', 'No one has signed up yet this cycle.']);
  });

  it('describes each list when it fails to load', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/1/due-professors', () => failure('Due faculty could not be read.')),
      http.get('*/api/dashboard/unmatched', () => failure('Unmatched faculty could not be read.')),
      http.get('*/api/cycles/1/signups', () => failure('Sign-ups could not be read.')),
    );
    await expectEachDescribed([/Due faculty could not be read/, /Unmatched faculty could not be read/, /Sign-ups could not be read/]);
  });

  it('describes each list before the first cycle starts', async () => {
    serve();
    server.use(
      http.get('*/api/cycles/current', () => HttpResponse.json(null)),
      http.get('*/api/dashboard/unmatched', noCycle),
    );
    const none = 'No evaluation cycle has started yet.';
    await expectEachDescribed([none, none, none]);
  });
});
