import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observer, otherCourse, signup } from '../../test/fixtures';
import type { AlertType, Cycle, MatchingRow, Me, PersonRef, Signup } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { setClock } from '../../lib/clock';
import { UNMATCHED_TEXT } from '../../lib/statusTerms';
import { SignupsPage } from './SignupsPage';

const person = (netid: string, firstName: string, lastName: string): PersonRef => ({
  netid, firstName, lastName, displayName: `Dr. ${firstName} ${lastName}`, rank: 'associate',
});
const sarah = person('sk1', 'Sarah', 'Kim');
const raj = person('rm1', 'Raj', 'Mehta');
const pool = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => person(id, 'Observer', String.fromCharCode(65 + i)));

const RAN_AT = '2026-09-16T14:00:00Z';
const row = (signupId: string, observee: PersonRef, candidates: number, alertType: AlertType | null = null, ranAt: string | null = RAN_AT): MatchingRow => ({
  signupId,
  ranAt: candidates > 0 ? ranAt : null,
  observee,
  section: signupId === '21' ? otherCourse : course,
  candidates: pool.slice(0, candidates),
  alert: alertType ? { alertId: `al${signupId}`, alertType, createdDate: RAN_AT } : null,
});
const notRun = (signupId: string, observee: PersonRef): MatchingRow => ({ ...row(signupId, observee, 0), alert: null });

const signupOf = (signupId: string, observee: PersonRef): Signup => ({ ...signup, signupId, observee: { ...observee, email: `${observee.netid}@example.edu` } });
const signups = [signupOf('20', faculty), signupOf('21', sarah), signupOf('22', raj)];

const committeeMember: Me = {
  netid: 'ic1', firstName: 'Isabel', lastName: 'Nakamura', displayName: 'Dr. Isabel Nakamura', email: 'ic1@example.edu',
  rank: 'full', department: { deptId: '1', deptName: 'Computer Science' }, role: 'AC',
};

const never = () => new Promise<never>(() => {});
const failure = (message: string, status = 500, code = 'FAILED') => HttpResponse.json({ error: { code, message } }, { status });
const BEFORE_DEADLINE = '2026-09-08T15:00:00Z';
const AFTER_DEADLINE = '2026-09-16T15:00:00Z';

interface Calls { matchingGets: number; runs: number; notify: string[]; added: unknown[] }

/** Answers every request the page makes and records the writes. */
function serve({ matching = [], currentCycle = cycle }: { matching?: MatchingRow[]; currentCycle?: Cycle | null } = {}) {
  const calls: Calls = { matchingGets: 0, runs: 0, notify: [], added: [] };
  server.use(
    http.get('*/api/me', () => HttpResponse.json(committeeMember)),
    http.get('*/api/me/notifications', () => HttpResponse.json([])),
    http.get('*/api/cycles/current', () => HttpResponse.json(currentCycle)),
    http.get('*/api/cycles/1/signups', () => HttpResponse.json(signups)),
    http.get('*/api/cycles/1/matching', () => { calls.matchingGets += 1; return HttpResponse.json(matching); }),
  );
  return calls;
}

function openPage() {
  return renderRoutes([{ path: '/committee/signups', element: <SignupsPage /> }], '/committee/signups');
}

const table = () => screen.getByRole('table', { name: 'Sign-up requests' });
const dataRows = () => within(table()).getAllByRole('row').slice(1);
const runButton = () => screen.getByRole('button', { name: /Run observer selection|Running/ });
const notifyButton = () => screen.getByRole('button', { name: /Notify observees|Sending|Try again: notify/ });

beforeEach(() => setClock(() => new Date(AFTER_DEADLINE).getTime()));
afterEach(() => setClock(() => Date.now()));

describe('Sign-up requests page', () => {
  it('before the sign-up deadline lists every sign-up as not run yet and keeps both actions off', async () => {
    setClock(() => new Date(BEFORE_DEADLINE).getTime());
    serve({ matching: [notRun('20', faculty), notRun('21', sarah), notRun('22', raj)] });
    openPage();
    expect(await screen.findByText('Available after Sep 15')).toBeVisible();
    expect(runButton()).toBeDisabled();
    expect(runButton()).toHaveAccessibleDescription('Available after Sep 15');
    expect(notifyButton()).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Course #', 'Section #', 'Days and time', 'Observee', 'Email', 'Observers found']);
    const [first, second] = dataRows();
    expect(within(first).getAllByRole('cell').map((c) => c.textContent)).toEqual(['CS 1337', '002', 'M 8:30 AM', 'Dr. Maya Lin', 'ml123@example.edu', 'Not run yet']);
    expect(within(second).getByText('CS 2336')).toBeVisible();
    expect(within(second).getByText('W 10:00 AM')).toBeVisible();
    expect(screen.getAllByText('Not run yet')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Add an observer/ })).not.toBeInTheDocument();
  });

  it('shows the course without its section number when the backend writes the full department name', async () => {
    setClock(() => new Date(BEFORE_DEADLINE).getTime());
    const fullName = { ...notRun('20', faculty), section: { ...course, label: 'Computer Science 1337.002' } };
    serve({ matching: [fullName] });
    openPage();
    expect(await screen.findByText('Computer Science 1337')).toBeVisible();
    expect(within(dataRows()[0]).getAllByRole('cell')[1]).toHaveTextContent('002');
  });

  it('runs observer selection once under repeated clicks after the deadline and shows the new summary', async () => {
    const calls = serve({ matching: [notRun('20', faculty), notRun('21', sarah)] });
    let answer: (rows: MatchingRow[]) => void = () => {};
    server.use(http.post('*/api/cycles/1/matching', async ({ request }) => {
      calls.runs += 1;
      expect(await request.text()).toBe('');
      const rows = await new Promise<MatchingRow[]>((resolve) => { answer = resolve; });
      return HttpResponse.json(rows);
    }));
    openPage();
    expect(await screen.findByText('2 sign-ups, not run yet')).toBeVisible();
    const u = userEvent.setup();
    expect(runButton()).toBeEnabled();
    await u.click(runButton());
    await u.click(runButton());
    await u.dblClick(runButton());
    await waitFor(() => expect(runButton()).toHaveTextContent('Running…'));
    expect(calls.runs).toBe(1);
    answer([row('20', faculty, 5), row('21', sarah, 0, 'no_observer')]);
    expect(await screen.findByText('Ran Sep 16, 9:00 AM')).toBeVisible();
    expect(screen.getByText('1 of 2 sign-ups have 5 observers')).toBeVisible();
    const [first, second] = dataRows();
    expect(within(first).getByText('5 of 5')).toBeVisible();
    expect(within(second).getByText('0')).toBeVisible();
    expect(within(second).getByText('No observer')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('1 sign-up needs attention: 1 with no observer.');
    expect(calls.runs).toBe(1);
  });

  it('counts a run that found no observer for anyone as run', async () => {
    const nobody = [row('20', faculty, 0, 'no_observer'), row('21', sarah, 0, 'no_observer')];
    expect(nobody.every((r) => r.ranAt === null)).toBe(true);
    serve({ matching: nobody });
    openPage();
    expect(await screen.findByText('Observer selection has run')).toBeVisible();
    expect(screen.getByText('0 of 2 sign-ups have 5 observers')).toBeVisible();
    expect(screen.queryByText('Not run yet')).not.toBeInTheDocument();
    expect(within(dataRows()[0]).getByText('0')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('2 sign-ups need attention: 2 with no observer.');
    expect(notifyButton()).toBeDisabled();
    expect(notifyButton()).toHaveAccessibleDescription('Available once observer selection has made lists.');
  });

  it('keeps the page working when the observee emails cannot be read', async () => {
    serve({ matching: [row('20', faculty, 5)] });
    server.use(http.get('*/api/cycles/1/signups', () => failure('Sign-ups could not be read.')));
    openPage();
    expect(await screen.findByText('5 of 5')).toBeVisible();
    expect(within(dataRows()[0]).getAllByRole('cell')[4]).toHaveTextContent('');
    expect(runButton()).toBeEnabled();
    expect(screen.queryByText('Sign-ups could not be read.')).not.toBeInTheDocument();
  });

  it('shows the server message when observer selection is refused', async () => {
    serve({ matching: [notRun('20', faculty)] });
    server.use(http.post('*/api/cycles/1/matching', () => failure('Run observer selection after the sign-up deadline.', 409, 'SIGNUP_OPEN')));
    openPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Run observer selection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Run observer selection after the sign-up deadline.');
  });

  it.each([
    ['one of each alert', [row('20', faculty, 0, 'no_observer'), row('21', sarah, 2, 'insufficient_observers'), row('22', raj, 0, 'no_acceptance')],
      '3 sign-ups need attention: 1 with no observer, 1 with only 2 observers, 1 where nobody accepted.'],
    ['several with too few observers', [row('20', faculty, 1, 'insufficient_observers'), row('21', sarah, 2, 'insufficient_observers'), row('22', raj, 5)],
      '2 sign-ups need attention: 2 with fewer than 3 observers.'],
    ['one with a single observer', [row('20', faculty, 1, 'insufficient_observers'), row('22', raj, 5)],
      '1 sign-up needs attention: 1 with only 1 observer.'],
    ['only nobody accepted', [row('20', faculty, 0, 'no_acceptance'), row('21', sarah, 0, 'no_acceptance'), row('22', raj, 4)],
      '2 sign-ups need attention: 2 where nobody accepted.'],
  ])('sums up the sign-ups that need attention: %s', async (_name, matching, text) => {
    serve({ matching });
    openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByText(UNMATCHED_TEXT)).toBeVisible();
  });

  it('shows only the sign-ups that need attention, then all of them again', async () => {
    serve({ matching: [row('20', faculty, 5), row('21', sarah, 2, 'insufficient_observers'), row('22', raj, 4)] });
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Show only these' }));
    expect(dataRows()).toHaveLength(1);
    expect(within(dataRows()[0]).getByText('Dr. Sarah Kim')).toBeVisible();
    expect(within(dataRows()[0]).getByText('Insufficient')).toBeVisible();
    await u.click(screen.getByRole('button', { name: 'Show all' }));
    expect(dataRows()).toHaveLength(3);
    expect(screen.getByText(UNMATCHED_TEXT)).toBeVisible();
  });

  it('pages the table seven rows at a time', async () => {
    const many = Array.from({ length: 9 }, (_, i) => row(String(100 + i), person(`p${i}`, 'Prof', `Number${i}`), 5));
    serve({ matching: many });
    openPage();
    expect(await screen.findByText('1 to 7 of 9')).toBeVisible();
    expect(dataRows()).toHaveLength(7);
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(screen.getByText('8 to 9 of 9')).toBeVisible();
    expect(dataRows()).toHaveLength(2);
    expect(within(dataRows()[1]).getByText('Dr. Prof Number8')).toBeVisible();
  });

  it('says so when the cycle has no sign-ups', async () => {
    serve({ matching: [] });
    openPage();
    expect(await screen.findByText('No sign-ups yet.')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Sign-up pages' })).not.toBeInTheDocument();
  });

  it('says so before the first cycle starts', async () => {
    serve({ currentCycle: null });
    openPage();
    expect(await screen.findByText('No evaluation cycle has started yet.')).toBeVisible();
  });

  it('shows loading until the sign-ups arrive', async () => {
    serve();
    server.use(http.get('*/api/cycles/1/matching', never));
    openPage();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading sign-ups…');
  });

  it('shows a failed read with Try again, which repeats it', async () => {
    const calls = serve({ matching: [row('20', faculty, 5)] });
    let fail = true;
    server.use(http.get('*/api/cycles/1/matching', () => {
      calls.matchingGets += 1;
      return fail ? failure('Sign-ups could not be read.') : HttpResponse.json([row('20', faculty, 5)]);
    }));
    openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-ups could not be read.');
    expect(calls.matchingGets).toBe(1);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('5 of 5')).toBeVisible();
    expect(calls.matchingGets).toBe(2);
  });
});

describe('Notify observees that their lists are ready', () => {
  function serveNotify(answer: () => Response | Promise<Response>) {
    const calls = serve({ matching: [row('20', faculty, 5), row('21', sarah, 3)] });
    server.use(http.post('*/api/cycles/1/notifications/lists-ready', async ({ request }) => {
      calls.notify.push(await request.text());
      return answer();
    }));
    return calls;
  }

  it('asks first, sends nothing on Cancel, then sends one POST with no body and reports the count', async () => {
    const calls = serveNotify(() => HttpResponse.json({ sent: 4 }));
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Notify observees: lists are ready/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Notify observees: lists are ready?' });
    expect(dialog).toHaveTextContent(/In-app notification only, no email/);
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.notify).toHaveLength(0);
    await u.click(notifyButton());
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Notify observees' }));
    expect(await screen.findByText(/Sent 4 in-app notifications\./)).toBeVisible();
    expect(calls.notify).toEqual(['']);
  });

  it('sends once under repeated clicks while the send is running', async () => {
    let finish: () => void = () => {};
    const calls = serveNotify(() => new Promise<Response>((resolve) => { finish = () => resolve(HttpResponse.json({ sent: 2 })); }));
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Notify observees: lists are ready/ }));
    await u.dblClick(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Notify observees' }));
    await waitFor(() => expect(notifyButton()).toHaveTextContent('Sending…'));
    await u.click(notifyButton());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    finish();
    expect(await screen.findByText(/Sent 2 in-app notifications\./)).toBeVisible();
    expect(calls.notify).toHaveLength(1);
  });

  it('says plainly when nobody was notified', async () => {
    serveNotify(() => HttpResponse.json({ sent: 0 }));
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Notify observees: lists are ready/ }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Notify observees' }));
    expect(await screen.findByText(/No notifications sent: no sign-up in this cycle has an observer list yet\./)).toBeVisible();
  });

  it('explains a 403 and does not retry on its own', async () => {
    const calls = serveNotify(() => failure('Only Assessment Committee members can do this.', 403, 'FORBIDDEN'));
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Notify observees: lists are ready/ }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Notify observees' }));
    expect(await screen.findByText('Not sent: only Assessment Committee members can send notifications.')).toBeVisible();
    expect(notifyButton()).toHaveTextContent('Try again: notify observees');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.notify).toHaveLength(1);
  });

  it('reports a failure without an API answer as unknown, with no automatic retry', async () => {
    const calls = serveNotify(() => new HttpResponse('Bad gateway', { status: 502 }));
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Notify observees: lists are ready/ }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Notify observees' }));
    expect(await screen.findByText(/The result is unknown: .* It may have been sent\./)).toBeVisible();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.notify).toHaveLength(1);
  });
});

describe('Add an observer by hand', () => {
  const alerting = () => [row('20', faculty, 5), row('21', sarah, 1, 'insufficient_observers'), row('22', raj, 0, 'no_observer')];

  function serveAdd(answer: () => Response | Promise<Response>) {
    const calls = serve({ matching: alerting() });
    server.use(http.post('*/api/signups/:signupId/candidates', async ({ request, params }) => {
      calls.added.push({ url: new URL(request.url).pathname, signupId: params.signupId, body: await request.json() });
      return answer();
    }));
    return calls;
  }

  const added = { signupId: '21', observer, roundNo: 2 };

  async function openForm(name = 'Dr. Sarah Kim') {
    openPage();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: `Add an observer for ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an observer by hand' });
    return { u, dialog, input: within(dialog).getByLabelText('Observer NetID') };
  }

  it('offers the form only on rows with an alert', async () => {
    serve({ matching: alerting() });
    openPage();
    await screen.findByText('Dr. Sarah Kim');
    const [ok, few, none] = dataRows();
    expect(within(ok).queryByRole('button', { name: /Add an observer/ })).not.toBeInTheDocument();
    expect(within(few).getByRole('button', { name: 'Add an observer for Dr. Sarah Kim' })).toBeVisible();
    expect(within(none).getByRole('button', { name: 'Add an observer for Dr. Raj Mehta' })).toBeVisible();
  });

  it('sends nothing for an empty or blank NetID', async () => {
    const calls = serveAdd(() => HttpResponse.json(added, { status: 201 }));
    const { u, dialog, input } = await openForm();
    await u.click(within(dialog).getByRole('button', { name: 'Add observer' }));
    expect(await within(dialog).findByText("Enter the observer's NetID.")).toBeVisible();
    await u.type(input, '   ');
    expect(within(dialog).queryByText("Enter the observer's NetID.")).not.toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Add observer' }));
    expect(within(dialog).getByText("Enter the observer's NetID.")).toBeVisible();
    expect(calls.added).toHaveLength(0);
  });

  it('sends exactly the trimmed NetID once, then refreshes the table', async () => {
    let finish: () => void = () => {};
    const calls = serveAdd(() => new Promise<Response>((resolve) => { finish = () => resolve(HttpResponse.json(added, { status: 201 })); }));
    const { u, dialog, input } = await openForm();
    await u.type(input, '  er123 ');
    await u.click(within(dialog).getByRole('button', { name: 'Add observer' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Adding…' })).toBeVisible());
    await u.click(within(dialog).getByRole('button', { name: 'Adding…' }));
    await u.type(input, '{Enter}');
    const before = calls.matchingGets;
    finish();
    expect(await screen.findByText('Added er123 to the observer list for Dr. Sarah Kim.')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.added).toEqual([{ url: '/api/signups/21/candidates', signupId: '21', body: { observerNetid: 'er123' } }]);
    await waitFor(() => expect(calls.matchingGets).toBe(before + 1));
  });

  it.each([
    [400, 'INVALID_CANDIDATE', 'A faculty member cannot observe their own sign-up.'],
    [409, 'ENOUGH_CANDIDATES', 'This sign-up already has enough usable candidates.'],
  ])('shows a %i %s message as sent and keeps the NetID', async (status, code, message) => {
    const calls = serveAdd(() => failure(message, status, code));
    const { u, dialog, input } = await openForm();
    await u.type(input, 'sk1');
    await u.click(within(dialog).getByRole('button', { name: 'Add observer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(input).toHaveValue('sk1');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.added).toHaveLength(1);
  });
});

describe('Sign-up requests in the app shell', () => {
  function openInShell(me: Me) {
    sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: me.email, token: `demo:${me.email}` }));
    serve({ matching: [row('20', faculty, 5)] });
    server.use(http.get('*/api/me', () => HttpResponse.json(me)));
    return renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
      { path: '/committee/signups', element: <SignupsPage />, handle: { title: 'Sign-up requests' } },
      { path: '/faculty/evaluation', element: <p>My evaluation page</p>, handle: { title: 'My evaluation' } },
    ] }], '/committee/signups');
  }
  afterEach(() => sessionStorage.removeItem('assessment-helper.session'));

  it('names the sign-up deadline in the title', async () => {
    openInShell(committeeMember);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign-up requests (deadline passed Sep 15)' })).toBeVisible();
  });

  it('names an open deadline in the title before it passes', async () => {
    setClock(() => new Date(BEFORE_DEADLINE).getTime());
    openInShell(committeeMember);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign-up requests (deadline Sep 15)' })).toBeVisible();
  });

  it('sends a faculty-only user to their evaluation page', async () => {
    const { router } = openInShell({ ...committeeMember, role: 'faculty' });
    expect(await screen.findByText('My evaluation page')).toBeVisible();
    expect(router.state.location.pathname).toBe('/faculty/evaluation');
  });
});
