import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cycle, DueProfessor, FacultyStatus, Me } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { downloadCsv } from '../../lib/csv';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { cycle, faculty, facultyStatus, nextTerm, term } from '../../test/fixtures';
import { FacultyPage } from './FacultyPage';

vi.mock('../../lib/csv', () => ({ downloadCsv: vi.fn() }));

const SESSION_KEY = 'assessment-helper.session';
const FACULTY = '*/api/cycles/1/faculty';
const DUE_PROFESSORS = '*/api/cycles/1/due-professors';
const REMINDERS = '*/api/cycles/1/notifications/due-reminders';
const MISSING = () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } }, { status: 404 });
const failure = (message: string, status = 500, code = 'FAILED') => HttpResponse.json({ error: { code, message } }, { status });
const never = () => new Promise<never>(() => {});

const roster: FacultyStatus[] = [
  facultyStatus('a1', 'Ana', 'DUE', { lastObservedTerm: { ...term, termId: '0', label: 'Fall 2025', year: 2025 } }),
  facultyStatus('b1', 'Ben', 'DUE'),
  facultyStatus('c1', 'Cy', 'OVERDUE', { dueTerm: { ...nextTerm, label: 'Spring 2026' } }),
  facultyStatus('d1', 'Dee', 'NOT_DUE', { dueTerm: nextTerm }),
];
const dueOnly: DueProfessor[] = [
  { professor: { ...faculty, netid: 'ml123' }, department: { deptId: '1', deptName: 'Computer Science' }, dueStatus: 'DUE', lastObservedTerm: null },
  { professor: { ...faculty, netid: 'er9', displayName: 'Dr. Elena Ruiz', rank: 'associate' }, department: { deptId: '2', deptName: 'Mathematics' }, dueStatus: 'OVERDUE', lastObservedTerm: null },
];

interface Serve {
  current?: Cycle | null;
  list?: () => Response | Promise<Response>;
  fallbackList?: () => Response | Promise<Response>;
  sent?: number;
}

/** Answers the page's reads and records the reminder posts and the fallback reads. */
function serve({ current = cycle, list = () => HttpResponse.json(roster), fallbackList = () => HttpResponse.json(dueOnly), sent = 2 }: Serve = {}) {
  const log: { posts: unknown[]; fallbackReads: number } = { posts: [], fallbackReads: 0 };
  server.use(
    http.get('*/api/cycles/current', () => HttpResponse.json(current)),
    http.get(FACULTY, list),
    http.get(DUE_PROFESSORS, () => { log.fallbackReads += 1; return fallbackList(); }),
    http.post(REMINDERS, async ({ request }) => { log.posts.push(await request.json()); return HttpResponse.json({ sent }); }),
  );
  return log;
}

const open = () => renderRoutes([{ path: '/committee/faculty', element: <FacultyPage /> }], '/committee/faculty');
const user = () => userEvent.setup();
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).queryAllByRole('cell')[1]?.textContent).filter(Boolean);
const chip = (name: RegExp) => screen.getByRole('button', { name });

async function sendToSelected(u: ReturnType<typeof user>, confirm: RegExp) {
  await u.click(screen.getByRole('button', { name: /Send reminder to selected/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Send reminder to selected?' });
  await u.click(within(dialog).getByRole('button', { name: confirm }));
  return dialog;
}

beforeEach(() => vi.mocked(downloadCsv).mockClear());

describe('Faculty page: full list', () => {
  it('shows due and overdue first, with counts on every chip including Not due, and filters by chip', async () => {
    const log = serve();
    open();
    expect(await screen.findByText('Dr. Ana Test')).toBeVisible();
    expect(screen.getByText('Professors who need a peer observation this cycle. Overdue means it was already due in an earlier semester.')).toBeVisible();
    expect(names()).toEqual(['Dr. Ana Test', 'Dr. Ben Test', 'Dr. Cy Test']);
    expect(chip(/^All \(4\)/)).toHaveAttribute('aria-pressed', 'false');
    expect(chip(/^DUE \(2\)/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^OVERDUE \(1\)/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^NOT DUE \(1\)/)).toHaveAttribute('aria-pressed', 'false');
    const u = user();
    await u.click(chip(/^NOT DUE/));
    expect(names()).toEqual(['Dr. Ana Test', 'Dr. Ben Test', 'Dr. Cy Test', 'Dr. Dee Test']);
    await u.click(chip(/^All/));
    await u.click(chip(/^OVERDUE/));
    expect(names()).toEqual(['Dr. Cy Test']);
    // Every column, with the due semester.
    const row = screen.getAllByRole('row')[1];
    expect(row).toHaveTextContent(/Dr\. Cy Test.*Assistant.*Computer Science.*Never.*Spring 2026.*OVERDUE/);
    expect(screen.getByRole('columnheader', { name: 'Due semester' })).toBeVisible();
    expect(log.fallbackReads).toBe(0);
  });

  it('searches by name and pages through long lists', async () => {
    serve({ list: () => HttpResponse.json(Array.from({ length: 9 }, (_, i) => facultyStatus(`p${i}`, `Prof${i}`, 'DUE'))) });
    open();
    await screen.findByText('Dr. Prof0 Test');
    expect(names()).toHaveLength(7);
    expect(screen.getByText('1 to 7 of 9')).toBeVisible();
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(names()).toEqual(['Dr. Prof7 Test', 'Dr. Prof8 Test']);
    await u.type(screen.getByLabelText('Search by name'), 'prof3');
    expect(names()).toEqual(['Dr. Prof3 Test']);
    await u.clear(screen.getByLabelText('Search by name'));
    await u.type(screen.getByLabelText('Search by name'), 'nobody');
    expect(screen.getByText('Nobody matches.')).toBeVisible();
  });

  it('exports the shown rows with email and due semester', async () => {
    serve();
    open();
    await screen.findByText('Dr. Ana Test');
    await user().click(screen.getByRole('button', { name: /Export/ }));
    expect(downloadCsv).toHaveBeenCalledWith('faculty', 'Fall 2026', [
      ['name', 'email', 'rank', 'department', 'last_observed', 'due_semester', 'status'],
      ['Dr. Ana Test', 'a1@demo.edu', 'Assistant', 'Computer Science', 'Fall 2025', 'Fall 2026', 'DUE'],
      ['Dr. Ben Test', 'b1@demo.edu', 'Assistant', 'Computer Science', 'Never', 'Fall 2026', 'DUE'],
      ['Dr. Cy Test', 'c1@demo.edu', 'Assistant', 'Computer Science', 'Never', 'Spring 2026', 'OVERDUE'],
    ]);
  });

  it('says so when no cycle has started, and requests no list', async () => {
    const log = serve({ current: null });
    const list = vi.fn();
    server.use(http.get(FACULTY, () => { list(); return HttpResponse.json([]); }));
    open();
    expect(await screen.findByText('No evaluation cycle has started yet.')).toBeVisible();
    expect(list).not.toHaveBeenCalled();
    expect(log.fallbackReads).toBe(0);
  });

  it('says when the cycle has no faculty', async () => {
    serve({ list: () => HttpResponse.json([]) });
    open();
    expect(await screen.findByText('No faculty to show for this cycle.')).toBeVisible();
  });
});

describe('Faculty page: fallback while the full list is missing', () => {
  it('asks for the due-professors list only after the missing-route 404, shows the banner, and drops Not due and due semester', async () => {
    const log = serve({ list: MISSING });
    open();
    expect(await screen.findByText('The full faculty list is not available yet, so only due and overdue professors are shown.')).toBeVisible();
    expect(await screen.findByText('Dr. Maya Lin')).toBeVisible();
    expect(log.fallbackReads).toBe(1);
    expect(screen.queryByRole('button', { name: /NOT DUE/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Due semester' })).not.toBeInTheDocument();
    expect(chip(/^DUE \(1\)/)).toBeVisible();
    expect(chip(/^OVERDUE \(1\)/)).toBeVisible();
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: /Export/ }));
    expect(downloadCsv).toHaveBeenCalledWith('faculty', 'Fall 2026', [
      ['name', 'rank', 'department', 'last_observed', 'status'],
      ['Dr. Maya Lin', 'Assistant', 'Computer Science', 'Never', 'DUE'],
      ['Dr. Elena Ruiz', 'Associate', 'Mathematics', 'Never', 'OVERDUE'],
    ]);
  });

  it('shows the page error and no fallback when the full list fails another way, then recovers with Try again', async () => {
    let attempts = 0;
    const log = serve({ list: () => (++attempts === 1 ? failure('Faculty list failed.') : HttpResponse.json(roster)) });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Faculty list failed.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(log.fallbackReads).toBe(0);
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Dr. Ana Test')).toBeVisible();
  });

  it('shows the error when the fallback list fails too', async () => {
    serve({ list: MISSING, fallbackList: () => failure('Due list failed.') });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Due list failed.');
  });

  it('treats other 404s as errors, not as the missing endpoint', async () => {
    const log = serve({ list: () => failure('Cycle not found.', 404, 'NOT_FOUND') });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cycle not found.');
    expect(log.fallbackReads).toBe(0);
  });
});

describe('Faculty page: reminders to the selected professors', () => {
  it('lets only due and overdue rows be selected', async () => {
    serve();
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(chip(/^NOT DUE/));
    expect(screen.getByRole('checkbox', { name: 'Select Dr. Dee Test' })).toBeDisabled();
    await u.click(screen.getByRole('checkbox', { name: 'Select everyone due' }));
    expect(screen.getByRole('button', { name: 'Send reminder to selected (3)' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Select Dr. Dee Test' })).not.toBeChecked();
  });

  it('asks first, warns about email, and sends exactly the selected netids', async () => {
    const log = serve({ sent: 2 });
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    expect(screen.getByRole('button', { name: 'Send reminder to selected (0)' })).toBeDisabled();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Cy Test' }));
    await u.click(screen.getByRole('button', { name: 'Send reminder to selected (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send reminder to selected?' });
    expect(dialog).toHaveTextContent(/in-app reminder to the 2 selected professors/);
    expect(dialog).toHaveTextContent(/already signed up for this cycle is skipped/);
    expect(dialog).toHaveTextContent(/queues a reminder email/);
    expect(dialog).toHaveTextContent(/Sending again later reminds the same professors again\./);
    expect(log.posts).toHaveLength(0);
    await u.click(within(dialog).getByRole('button', { name: 'Send 2 reminders' }));
    expect(await screen.findByText(/Sent 2 in-app reminders\. Reminder emails go out only when the server has email turned on; delivery is not confirmed here\./)).toBeVisible();
    expect(log.posts).toEqual([{ netids: ['a1', 'c1'] }]);
    // The selection is cleared after a send.
    expect(screen.getByRole('button', { name: 'Send reminder to selected (0)' })).toBeDisabled();
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const log = serve();
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await u.click(screen.getByRole('button', { name: 'Send reminder to selected (1)' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(log.posts).toHaveLength(0);
    expect(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' })).toBeChecked();
  });

  it('explains when fewer were sent than selected, and when none were', async () => {
    serve({ sent: 1 });
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select everyone due' }));
    await sendToSelected(u, /Send 3 reminders/);
    expect(await screen.findByText(/Sent 1 of 3 reminders\. The others were skipped, for example because they have already signed up for this cycle\./)).toBeVisible();

    server.use(http.post(REMINDERS, () => HttpResponse.json({ sent: 0 })));
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ben Test' }));
    const dialog = await sendToSelected(u, /Send 1 reminder$/);
    expect(dialog).not.toBeInTheDocument();
    expect(await screen.findByText(/No reminders sent: none of the selected professors is still without a sign-up this cycle\./)).toBeVisible();
  });

  it('sends once however often the confirm button is clicked, and shows Sending while pending', async () => {
    let posts = 0;
    serve();
    server.use(http.post(REMINDERS, () => { posts += 1; return never(); }));
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await u.click(screen.getByRole('button', { name: 'Send reminder to selected (1)' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send 1 reminder' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    const button = await screen.findByRole('button', { name: 'Sending…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await u.dblClick(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it('shows a failure without retrying it and keeps the selection', async () => {
    let posts = 0;
    serve();
    server.use(http.post(REMINDERS, () => { posts += 1; return failure('Database unavailable.'); }));
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await sendToSelected(u, /Send 1 reminder/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent: Database unavailable. Nothing was retried automatically.');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Try again: send reminder to selected (1)' })).toBeEnabled();
  });

  it('explains a 403 as a committee-only action', async () => {
    serve();
    server.use(http.post(REMINDERS, () => failure('Assessment Committee only.', 403, 'FORBIDDEN')));
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await sendToSelected(u, /Send 1 reminder/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent: only Assessment Committee members can send notifications.');
  });

  it('calls the result unknown when the request fails without an API answer, and warns about duplicates', async () => {
    serve();
    server.use(http.post(REMINDERS, () => HttpResponse.error()));
    open();
    await screen.findByText('Dr. Ana Test');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select Dr. Ana Test' }));
    await sendToSelected(u, /Send 1 reminder/);
    expect(await screen.findByRole('alert')).toHaveTextContent(/The result is unknown: .* It may have been sent\./);
    await u.click(screen.getByRole('button', { name: 'Send reminder to selected (1)' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(/Possibly sent from this page at .*\. Sending again to the same people creates duplicate reminders\./);
  });

  it('sends reminders from the fallback list too', async () => {
    const log = serve({ list: MISSING, sent: 2 });
    open();
    await screen.findByText('Dr. Maya Lin');
    const u = user();
    await u.click(screen.getByRole('checkbox', { name: 'Select everyone due' }));
    await sendToSelected(u, /Send 2 reminders/);
    await waitFor(() => expect(log.posts).toEqual([{ netids: ['ml123', 'er9'] }]));
  });
});

describe('Faculty page: access', () => {
  afterEach(() => sessionStorage.removeItem(SESSION_KEY));

  it('sends a faculty-only user to My evaluation without asking for any list', async () => {
    const log = serve();
    const list = vi.fn();
    server.use(
      http.get(FACULTY, () => { list(); return HttpResponse.json(roster); }),
      http.get('*/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty' } satisfies Me)),
    );
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
    const { router } = renderRoutes([{
      element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
      children: [
        { path: '/committee/faculty', element: <FacultyPage />, handle: { title: 'Faculty' } },
        { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      ],
    }], '/committee/faculty');
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
    expect(list).not.toHaveBeenCalled();
    expect(log.fallbackReads).toBe(0);
  });
});
