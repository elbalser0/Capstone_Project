import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cycle, FacultyStatus, Me, Term } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { setClock } from '../../lib/clock';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { cycle, faculty, facultyStatus, nextTerm, term } from '../../test/fixtures';
import { CyclePage } from './CyclePage';

const DRAFT_KEY = 'assessment-helper.cycle-draft';
const SESSION_KEY = 'assessment-helper.session';
const MISSING = () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } }, { status: 404 });
const failure = (message: string, status = 500, code = 'FAILED') => HttpResponse.json({ error: { code, message } }, { status });
const never = () => new Promise<never>(() => {});

const pastTerm: Term = { termId: '0', season: 'spring', year: 2026, label: 'Spring 2026', startDate: '2026-01-12', endDate: '2026-05-08' };
const laterTerm: Term = { termId: '3', season: 'fall', year: 2027, label: 'Fall 2027', startDate: '2027-08-23', endDate: '2027-12-11' };
const closedCycle: Cycle = { ...cycle, phase: 'closed' };
const openCycle: Cycle = { ...cycle, phase: 'signup' };

const rows: FacultyStatus[] = [
  facultyStatus('a1', 'Ana', 'DUE'),
  facultyStatus('b1', 'Ben', 'DUE'),
  facultyStatus('c1', 'Cy', 'OVERDUE'),
  facultyStatus('d1', 'Dee', 'NOT_DUE'),
];

interface Serve {
  current?: Cycle | null;
  terms?: () => Response | Promise<Response>;
  preview?: (termId: string) => Response | Promise<Response>;
}

/** Answers the page's reads and records every request it makes. */
function serve({ current = null, terms = () => HttpResponse.json([pastTerm, term, nextTerm, laterTerm]), preview = () => HttpResponse.json(rows) }: Serve = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const record = async (request: Request) => {
    const text = request.method === 'GET' ? '' : await request.text();
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : undefined });
  };
  server.use(
    http.get('*/api/cycles/current', () => HttpResponse.json(current)),
    http.get('*/api/terms', async ({ request }) => { await record(request); return terms(); }),
    http.get('*/api/terms/:termId/due-preview', async ({ request, params }) => { await record(request); return preview(String(params.termId)); }),
    http.post('*/api/cycles', async ({ request }) => { await record(request); return HttpResponse.json({ ...openCycle, cycleId: '2', term: nextTerm }, { status: 201 }); }),
  );
  return calls;
}

function open() {
  return renderRoutes([
    { path: '/committee/cycle', element: <CyclePage /> },
    { path: '/committee/faculty', element: <p>Faculty page</p> },
  ], '/committee/cycle');
}

const user = () => userEvent.setup();
const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fillDates(signup: string, observation: string, feedback: string) {
  setDate('Sign-up deadline', signup);
  setDate('Observation-period deadline', observation);
  setDate('Feedback deadline', feedback);
}

beforeEach(() => {
  setClock(() => new Date('2026-12-20T15:00:00Z').getTime());
  localStorage.clear();
});
afterEach(() => {
  setClock(() => Date.now());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Cycle page: starting a cycle', () => {
  it('after a closed cycle, offers only later terms that have not ended and starts the cycle with exactly the four fields', async () => {
    const calls = serve({ current: closedCycle });
    const { router } = open();
    const picker = await screen.findByLabelText('Term');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Spring 2027', 'Fall 2027']);
    expect(screen.getByText('Last cycle: Fall 2026, closed Oct 1')).toBeVisible();
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    await user().click(screen.getByRole('button', { name: 'Kick off cycle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/faculty'));
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{
      method: 'POST', path: '/api/cycles',
      body: { termId: '2', signupDeadline: '2027-01-15', observationDeadline: '2027-03-01', feedbackDeadline: '2027-04-01' },
    }]);
  });

  it('with no cycle yet, leaves out terms that have ended and keeps the term in progress', async () => {
    setClock(() => new Date('2026-09-08T15:00:00Z').getTime());
    serve({ current: null });
    open();
    const picker = await screen.findByLabelText('Term');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Fall 2026', 'Spring 2027', 'Fall 2027']);
    expect(screen.queryByText(/Last cycle/)).not.toBeInTheDocument();
  });

  it('blocks out-of-order dates and allows equal dates', async () => {
    const calls = serve({ current: closedCycle });
    open();
    await screen.findByLabelText('Term');
    fillDates('2027-02-01', '2027-01-20', '2027-03-01');
    expect(screen.getByRole('alert')).toHaveTextContent('Deadlines must be in order: sign-up, then observation, then feedback.');
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeDisabled();
    setDate('Sign-up deadline', '2026-12-19');
    setDate('Observation-period deadline', '2027-01-20');
    expect(screen.getByRole('alert')).toHaveTextContent('The sign-up deadline cannot be before the cycle start date, Dec 20, 2026.');
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeDisabled();
    fillDates('2026-12-20', '2026-12-20', '2026-12-20');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeEnabled();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it.each([
    [400, 'INVALID_CYCLE', 'signupDeadline must be a YYYY-MM-DD date.'],
    [400, 'INVALID_TERM_ID', 'termId must be a positive integer.'],
    [400, 'INVALID_DEADLINES', 'Deadlines must be in order: signup, then observation, then feedback.'],
    [404, 'TERM_NOT_FOUND', 'That term does not exist.'],
    [400, 'TERM_ENDED', 'That term has already ended.'],
    [409, 'CYCLE_EXISTS', 'An evaluation cycle already exists for that term.'],
  ])('shows the server error %s %s as sent and keeps the input', async (status, code, message) => {
    serve({ current: closedCycle });
    server.use(http.post('*/api/cycles', () => failure(message, status, code)));
    const { router } = open();
    await screen.findByLabelText('Term');
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    await user().click(screen.getByRole('button', { name: 'Kick off cycle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Sign-up deadline')).toHaveValue('2027-01-15');
    expect(router.state.location.pathname).toBe('/committee/cycle');
  });

  it('sends one create request however often Kick off cycle is clicked, and does not retry a failure', async () => {
    let posts = 0;
    serve({ current: closedCycle });
    server.use(http.post('*/api/cycles', () => { posts += 1; return posts === 1 ? failure('Database unavailable.') : never(); }));
    open();
    await screen.findByLabelText('Term');
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    const button = screen.getByRole('button', { name: 'Kick off cycle' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toBe(1);
  });
});

describe('Cycle page: term list', () => {
  it('replaces the picker with its sentence when the term list endpoint is missing, and cannot start', async () => {
    const calls = serve({ current: closedCycle, terms: MISSING });
    open();
    expect(await screen.findByText('The term list is not available yet, so a new cycle cannot be started here.')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    const button = screen.getByRole('button', { name: 'Kick off cycle' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.some((c) => c.path.endsWith('/due-preview'))).toBe(false);
    // The rest of the page still works.
    expect(screen.getByRole('heading', { name: 'Who is due' })).toBeVisible();
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument();
  });

  it('shows an error note with Try again when the term list fails another way', async () => {
    let attempts = 0;
    serve({ current: closedCycle, terms: () => (++attempts === 1 ? failure('Term data unavailable.') : HttpResponse.json([nextTerm])) });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Term data unavailable.');
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeDisabled();
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Term')).toHaveValue('2');
  });

  it('says so when no upcoming term is left', async () => {
    serve({ current: closedCycle, terms: () => HttpResponse.json([pastTerm, term]) });
    open();
    expect(await screen.findByText('There is no upcoming term to start a cycle for.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeDisabled();
  });
});

describe('Cycle page: due preview', () => {
  it("counts the chosen term's preview and requests the new term's preview when the term changes", async () => {
    const calls = serve({ current: closedCycle, preview: (id) => HttpResponse.json(id === '2' ? rows : rows.slice(0, 1)) });
    open();
    expect(await screen.findByText('3 professors are due or overdue.')).toBeVisible();
    expect(screen.getByText('2 DUE')).toBeVisible();
    expect(screen.getByText('1 OVERDUE')).toBeVisible();
    const card = screen.getByRole('heading', { name: 'Who is due' }).closest('section')!;
    expect(within(card).getByText('Faculty this term (4)')).toBeVisible();
    expect(within(card).getByText('NOT DUE').closest('div')).toHaveTextContent('1');
    await user().selectOptions(screen.getByLabelText('Term'), '3');
    expect(await screen.findByText('1 professor is due or overdue.')).toBeVisible();
    expect(calls.filter((c) => c.path.endsWith('/due-preview')).map((c) => c.path)).toEqual(['/api/terms/2/due-preview', '/api/terms/3/due-preview']);
  });

  it('shows its sentence when the preview endpoint is missing, and starting still works', async () => {
    const calls = serve({ current: closedCycle, preview: MISSING });
    const { router } = open();
    expect((await screen.findAllByText('The due preview is not available yet. You can still start the cycle.')).length).toBeGreaterThan(0);
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    await user().click(screen.getByRole('button', { name: 'Kick off cycle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/faculty'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('shows an error note when the preview fails another way', async () => {
    serve({ current: closedCycle, preview: () => failure('Preview failed.') });
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview failed.');
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeInTheDocument();
  });
});

describe('Cycle page: draft on this device', () => {
  it('saves the form as a draft that comes back on reload, and clears it after a successful start', async () => {
    serve({ current: closedCycle });
    const first = open();
    await screen.findByLabelText('Term');
    await user().selectOptions(screen.getByLabelText('Term'), '3');
    fillDates('2027-09-01', '2027-10-01', '2027-11-01');
    await user().click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(screen.getByText('Draft saved on this device.')).toBeVisible();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toEqual({ termId: '3', signupDeadline: '2027-09-01', observationDeadline: '2027-10-01', feedbackDeadline: '2027-11-01' });
    first.unmount();

    const { router } = open();
    expect(await screen.findByLabelText('Term')).toHaveValue('3');
    expect(screen.getByLabelText('Feedback deadline')).toHaveValue('2027-11-01');
    await user().click(screen.getByRole('button', { name: 'Kick off cycle' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/committee/faculty'));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    serve({ current: closedCycle });
    open();
    await screen.findByLabelText('Term');
    fillDates('2027-01-15', '2027-03-01', '2027-04-01');
    await user().click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(screen.getByText('The draft could not be saved on this device.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kick off cycle' })).toBeEnabled();
  });

  it('ignores the draft while a cycle is open', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ termId: '3', signupDeadline: '2027-09-01', observationDeadline: '2027-10-01', feedbackDeadline: '2027-11-01' }));
    serve({ current: openCycle });
    server.use(http.get('*/api/cycles/1/faculty', () => HttpResponse.json(rows)));
    open();
    expect(await screen.findByLabelText('Sign-up deadline')).toHaveValue('2026-09-15');
  });
});

describe('Cycle page: an open cycle', () => {
  it('prefills the deadlines, shows the term as text, makes no term-list or due-professors request, and saves only the changed deadline', async () => {
    const calls = serve({ current: openCycle });
    const patches: unknown[] = [];
    const fallback = vi.fn();
    server.use(
      http.get('*/api/cycles/1/faculty', () => HttpResponse.json(rows)),
      http.get('*/api/cycles/1/due-professors', () => { fallback(); return HttpResponse.json([]); }),
      http.patch('*/api/cycles/1', async ({ request }) => {
        const body = await request.json();
        patches.push(body);
        return HttpResponse.json({ ...openCycle, observationDeadline: '2026-09-25' });
      }),
    );
    open();
    expect(await screen.findByLabelText('Sign-up deadline')).toHaveValue('2026-09-15');
    expect(screen.getByLabelText('Observation-period deadline')).toHaveValue('2026-09-21');
    expect(screen.getByLabelText('Feedback deadline')).toHaveValue('2026-10-01');
    expect(screen.getByText('Fall 2026')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    setDate('Observation-period deadline', '2026-09-25');
    await user().click(save);
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(patches).toEqual([{ observationDeadline: '2026-09-25' }]);
    expect(calls.some((c) => c.path === '/api/terms')).toBe(false);
    expect(await screen.findByText('3 professors are due or overdue.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save as draft' })).not.toBeInTheDocument();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('sends one save request however often Save changes is clicked, and does not retry a failure', async () => {
    let patches = 0;
    serve({ current: openCycle });
    server.use(
      http.get('*/api/cycles/1/faculty', () => HttpResponse.json(rows)),
      http.patch('*/api/cycles/1', () => { patches += 1; return failure('Database unavailable.'); }),
    );
    open();
    await screen.findByLabelText('Sign-up deadline');
    setDate('Feedback deadline', '2026-10-05');
    const save = screen.getByRole('button', { name: 'Save changes' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable.');
    await new Promise((r) => setTimeout(r, 50));
    expect(patches).toBe(1);
    expect(screen.getByLabelText('Feedback deadline')).toHaveValue('2026-10-05');
  });

  it('checks the order against the cycle start date and shows a server error without losing the input', async () => {
    serve({ current: openCycle });
    server.use(
      http.get('*/api/cycles/1/faculty', () => HttpResponse.json(rows)),
      http.patch('*/api/cycles/1', () => failure('The signup deadline cannot be before the cycle start date.', 400, 'INVALID_DEADLINES')),
    );
    open();
    await screen.findByLabelText('Sign-up deadline');
    setDate('Sign-up deadline', '2026-08-31');
    expect(screen.getByRole('alert')).toHaveTextContent('The sign-up deadline cannot be before the cycle start date, Sep 1, 2026.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    setDate('Sign-up deadline', '2026-09-10');
    await user().click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The signup deadline cannot be before the cycle start date.');
    expect(screen.getByLabelText('Sign-up deadline')).toHaveValue('2026-09-10');
  });

  it('counts from the due-professors list, without Not due, when the full faculty list is missing', async () => {
    const calls = serve({ current: openCycle });
    let fallbackReads = 0;
    server.use(
      http.get('*/api/cycles/1/faculty', MISSING),
      http.get('*/api/cycles/1/due-professors', () => {
        fallbackReads += 1;
        return HttpResponse.json([
          { professor: faculty, department: { deptId: '1', deptName: 'Computer Science' }, dueStatus: 'DUE', lastObservedTerm: null },
          { professor: { ...faculty, netid: 'x2' }, department: { deptId: '1', deptName: 'Computer Science' }, dueStatus: 'OVERDUE', lastObservedTerm: null },
        ]);
      }),
    );
    open();
    expect(await screen.findByText('2 professors are due or overdue.')).toBeVisible();
    const card = screen.getByRole('heading', { name: 'Who is due' }).closest('section')!;
    expect(within(card).getByText('Due or overdue this term (2)')).toBeVisible();
    expect(within(card).queryByText('NOT DUE')).not.toBeInTheDocument();
    expect(within(card).getByText('The full faculty list is not available yet, so only due and overdue professors are shown.')).toBeVisible();
    expect(fallbackReads).toBe(1);
    expect(calls.some((c) => c.path === '/api/terms')).toBe(false);
  });

  it('shows other faculty-list errors without asking for the due-professors list', async () => {
    serve({ current: openCycle });
    const fallback = vi.fn();
    server.use(
      http.get('*/api/cycles/1/faculty', () => failure('Faculty list failed.')),
      http.get('*/api/cycles/1/due-professors', () => { fallback(); return HttpResponse.json([]); }),
    );
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Faculty list failed.');
    expect(screen.getByLabelText('Sign-up deadline')).toHaveValue('2026-09-15');
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('Cycle page: loading and access', () => {
  it('shows an error with Try again when the current cycle cannot be read', async () => {
    let attempts = 0;
    serve();
    server.use(http.get('*/api/cycles/current', () => (++attempts === 1 ? failure('Server error.') : HttpResponse.json(null))));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.');
    await user().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Kick off cycle' })).toBeInTheDocument();
  });

  function openInShell(me: Me) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:test' }));
    server.use(http.get('*/api/me', () => HttpResponse.json(me)));
    return renderRoutes([{
      element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
      children: [
        { path: '/committee/cycle', element: <CyclePage />, handle: { title: 'Start the evaluation cycle' } },
        { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
      ],
    }], '/committee/cycle');
  }
  const me = (role: Me['role']): Me => ({ ...faculty, email: 'maya.lin@demo.edu', department: { deptId: '1', deptName: 'Computer Science' }, role });

  it('sends a faculty-only user to My evaluation', async () => {
    serve();
    const { router } = openInShell(me('faculty'));
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
    sessionStorage.removeItem(SESSION_KEY);
  });

  it("titles the page with the chosen term", async () => {
    serve({ current: closedCycle });
    openInShell(me('AC'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Start the Spring 2027 evaluation cycle' })).toBeVisible();
    sessionStorage.removeItem(SESSION_KEY);
  });
});
