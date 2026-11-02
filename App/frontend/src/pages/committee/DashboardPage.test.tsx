import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observer, otherCourse, signup, term } from '../../test/fixtures';
import type { CycleKpis, DueByRank, DueProfessor, PersonRef, Signup, UnmatchedFaculty } from '../../api/types';
import { DashboardPage } from './DashboardPage';

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

function serve() {
  server.use(
    http.get('*/api/cycles/latest/kpis', () => HttpResponse.json(kpis)),
    http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('*/api/dashboard/due-by-rank', () => HttpResponse.json(dueByRank)),
    http.get('*/api/dashboard/outstanding-observations', () => HttpResponse.json(outstandingCount)),
    http.get('*/api/dashboard/unmatched', () => HttpResponse.json(unmatched)),
    http.get('*/api/cycles/1/due-professors', () => HttpResponse.json(dueProfessors)),
    http.get('*/api/cycles/1/signups', () => HttpResponse.json(signups)),
  );
}

function openPage() {
  return renderRoutes([{ path: '/committee/dashboard', element: <DashboardPage /> }], '/committee/dashboard');
}

const section = (name: RegExp) => screen.getByRole('region', { name });
const dataRows = (region: HTMLElement) => within(region).getAllByRole('row').slice(1);
const LISTS = [/Due or overdue/, /Unmatched faculty/, /Outstanding observations/];

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
  it('lists the faculty who are due or overdue for the current cycle, overdue first', async () => {
    serve();
    openPage();
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
    openPage();
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
    openPage();
    expect(await screen.findByText('Online')).toBeVisible();
    const [row] = dataRows(section(/Unmatched faculty/));
    expect(within(row).getByText('Dr. Sarah Kim')).toBeVisible();
    expect(within(row).getByText('Online')).toBeVisible();
  });

  it('lists sign-ups without a completed observation as outstanding', async () => {
    serve();
    openPage();
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
    openPage();
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
    openPage();
    expect(await within(section(/Due or overdue/)).findByText('Nobody is due or overdue this cycle.')).toBeVisible();
    expect(await within(section(/Unmatched faculty/)).findByText('No unmatched faculty.')).toBeVisible();
    expect(await within(section(/Outstanding observations/)).findByText('Every sign-up has a completed observation.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    for (const name of LISTS) {
      expect(within(section(name)).getByRole('heading')).not.toHaveTextContent(/\(\d+\)/);
      expectMessageOnly(section(name));
    }
  });

  it('makes a table a keyboard stop only while it is too wide to show at once', async () => {
    serve();
    // jsdom has no layout: every box measures 0 wide, so the tables fit.
    const first = openPage();
    expect(await screen.findByText('Dr. Laura Gomez')).toBeVisible();
    for (const name of LISTS) {
      const scroller = within(section(name)).getByRole('group', { name });
      expect(scroller).not.toHaveAttribute('tabindex');
      expect(within(scroller).getByRole('table')).toBeVisible();
      expectTableStructure(section(name));
    }
    first.unmount();

    const wide = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const box = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      openPage();
      expect(await screen.findByText('Dr. Laura Gomez')).toBeVisible();
      for (const name of LISTS) expect(within(section(name)).getByRole('group', { name })).toHaveAttribute('tabindex', '0');
    } finally {
      wide.mockRestore();
      box.mockRestore();
    }
  });

  it('shows loading text, not an empty list, while a list is pending', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', never));
    openPage();
    const due = section(/Due or overdue/);
    expect(await within(due).findByText('Loading faculty…')).toBeVisible();
    expect(within(due).queryByText('Nobody is due or overdue this cycle.')).not.toBeInTheDocument();
    expectMessageOnly(due);
    expect(await screen.findByText('Dr. Laura Gomez')).toBeVisible();
  });

  it('shows a failed list as an error while the other lists still load', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/due-professors', () => failure('The requested endpoint does not exist.', 404, 'NOT_FOUND')));
    openPage();
    const due = section(/Due or overdue/);
    expect(await within(due).findByRole('alert')).toHaveTextContent('The requested endpoint does not exist.');
    expect(within(due).queryByText('Nobody is due or overdue this cycle.')).not.toBeInTheDocument();
    expect(within(due).getByRole('heading')).toHaveTextContent(/^Due or overdue for evaluation$/);
    expectMessageOnly(due);
    expect(await screen.findByText('Dr. Sarah Kim')).toBeVisible();
    expect(screen.getByText('Dr. Laura Gomez')).toBeVisible();
  });

  it('shows failed unmatched and outstanding lists as errors while the due list still loads', async () => {
    serve();
    server.use(
      http.get('*/api/dashboard/unmatched', () => failure('Unmatched faculty could not be read.')),
      http.get('*/api/cycles/1/signups', () => failure('Sign-ups could not be read.')),
    );
    openPage();
    expect(await within(section(/Unmatched faculty/)).findByRole('alert')).toHaveTextContent('Unmatched faculty could not be read.');
    expect(await within(section(/Outstanding observations/)).findByRole('alert')).toHaveTextContent('Sign-ups could not be read.');
    expect(within(section(/Unmatched faculty/)).queryByText('No unmatched faculty.')).not.toBeInTheDocument();
    expect(within(section(/Outstanding observations/)).queryByText('Every sign-up has a completed observation.')).not.toBeInTheDocument();
    expect(await screen.findByText('Dr. Raj Mehta')).toBeVisible();
  });

  it('shows an error in the cycle lists when the current cycle cannot be read', async () => {
    serve();
    server.use(http.get('*/api/cycles/current', () => failure('The current cycle could not be read.')));
    openPage();
    expect(await within(section(/Due or overdue/)).findByRole('alert')).toHaveTextContent('The current cycle could not be read.');
    expect(await within(section(/Outstanding observations/)).findByRole('alert')).toHaveTextContent('The current cycle could not be read.');
    expect(within(section(/Due or overdue/)).queryByText('No evaluation cycle has started yet.')).not.toBeInTheDocument();
    expect(await screen.findByText('Dr. Sarah Kim')).toBeVisible();
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

  it('never shows 0 for a count that is loading or failed', async () => {
    serve();
    server.use(
      http.get('*/api/dashboard/due-by-rank', never),
      http.get('*/api/dashboard/outstanding-observations', () => failure('The requested endpoint does not exist.', 404, 'NOT_FOUND')),
    );
    openPage();
    expect(await within(summary()).findByText("Couldn't load")).toBeVisible();
    expect(await within(summary()).findByText('Dr. Sarah Kim, CS 2336.001')).toBeVisible();
    expect(count('Due for evaluation')).toHaveTextContent(/^Due for evaluation–Loading$/);
    expect(within(count('Signed up but not observed')).getByRole('alert')).toHaveTextContent("Signed up but not observed: Couldn't load");
    expect(within(count('Signed up but not observed')).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(within(summary()).queryByText('0')).not.toBeInTheDocument();
  });
});
