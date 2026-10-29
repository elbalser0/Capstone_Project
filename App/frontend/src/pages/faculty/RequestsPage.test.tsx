import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { POLL_MS, RequestsPage } from './RequestsPage';
import type { Candidate, ObservationRequest, PersonRef, RequestStatus, Signup } from '../../api/types';
import { setClock } from '../../lib/clock';
import { course, cycle, evaluationStatus, faculty, observation, observer, signup } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';

const person = (netid: string, firstName: string, lastName: string): PersonRef => ({
  netid, firstName, lastName, displayName: `Dr. ${firstName} ${lastName}`, rank: 'associate',
});
const second = person('jk123', 'Jon', 'Kim');
const third = person('ap123', 'Ana', 'Park');

const candidate = (who: PersonRef, request: Candidate['request'] = null): Candidate => ({
  observer: who, roundNo: 1, request, teaches: ['CS 1336'], freeAtProposedTimes: true,
});
const request = (who: PersonRef, status: RequestStatus, extra: Partial<ObservationRequest> = {}): ObservationRequest => ({
  signupId: signup.signupId, observer: who, observee: faculty, section: course, proposedDates: signup.proposedDates,
  status, sentDate: '2026-09-16T15:00:00Z', respondedDate: null, expiresAt: '2026-09-18T15:00:00Z', ...extra,
});
const matchedSignup: Signup = {
  ...signup, observation: { observationId: observation.observationId, observer, status: 'scheduled', scheduledDate: '2026-09-21' },
};

/** After the sign-up deadline, while matching runs. */
const afterDeadline = { ...evaluationStatus, canSignUp: false, signupId: signup.signupId, cycle: { ...cycle, phase: 'matching' as const } };

/** Handlers whose answers a test can swap mid-test (an observer answering elsewhere, a new list). */
let current: { signup: Signup | null; candidates: Candidate[]; outgoing: ObservationRequest[] };
const calls = { signup: 0, candidates: 0, outgoing: 0 };

beforeEach(() => {
  current = { signup, candidates: [], outgoing: [] };
  Object.assign(calls, { signup: 0, candidates: 0, outgoing: 0 });
  // 31 hours before the fixtures' requests expire.
  setClock(() => new Date('2026-09-17T08:00:00Z').getTime());
  server.use(
    http.get('*/api/me/evaluation-status', () => HttpResponse.json(afterDeadline)),
    http.get('*/api/me/signup', () => { calls.signup += 1; return HttpResponse.json(current.signup); }),
    http.get('*/api/signups/:signupId/candidates', () => { calls.candidates += 1; return HttpResponse.json(current.candidates); }),
    http.get('*/api/me/requests/outgoing', () => { calls.outgoing += 1; return HttpResponse.json(current.outgoing); }),
    http.get('*/api/me/observations', () => HttpResponse.json([observation])),
    http.get('*/api/me/notifications', () => HttpResponse.json([])),
  );
});

afterEach(() => {
  vi.useRealTimers();
  setClock(() => Date.now());
});

function renderRequests() {
  return renderRoutes([
    { path: '/faculty/requests', element: <RequestsPage /> },
    { path: '/faculty/evaluation', element: <p>Evaluation overview</p> },
    { path: '/faculty/sign-up', element: <p>Sign-up form</p> },
  ], '/faculty/requests');
}

/** Moves the fake clock past one poll and lets the refetches settle. */
async function nextPoll() {
  await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
}

const sendButton = () => screen.getByRole('button', { name: /Send request to|Sending|Requests sent/ });

// ---------- Availability ----------

test('without a sign-up, offers sign-up only while it is open', async () => {
  current.signup = null;
  server.use(http.get('*/api/me/evaluation-status', () => HttpResponse.json(evaluationStatus)));
  renderRequests();
  expect(await screen.findByText('You have no sign-up this semester.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Sign up to be observed' })).toHaveAttribute('href', '/faculty/sign-up');
});

test('before the sign-up deadline, says when observer lists are sent', async () => {
  server.use(http.get('*/api/me/evaluation-status', () => HttpResponse.json(evaluationStatus)));
  renderRequests();
  expect(await screen.findByText('Observer lists are sent after the sign-up deadline (Sep 15).')).toBeVisible();
});

test('after the deadline, an empty list stays neutral instead of guessing whether matching ran', async () => {
  renderRequests();
  expect(await screen.findByText('There is no observer list for your sign-up yet.')).toBeVisible();
  expect(screen.queryByText(/no eligible/i)).toBeNull();
  expect(screen.queryByText(/runs observer selection/i)).toBeNull();
  expect(screen.getByText('This page checks for updates every 30 seconds.')).toBeVisible();
});

test('shows a loading message until every read has answered', async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  server.use(http.get('*/api/me/requests/outgoing', async () => { await held; return HttpResponse.json([]); }));
  renderRequests();
  expect(await screen.findByRole('status')).toHaveTextContent('Loading your requests…');
  release();
  expect(await screen.findByText('There is no observer list for your sign-up yet.')).toBeVisible();
});

test('a failed read shows the error and recovers with Try again', async () => {
  let fail = true;
  server.use(http.get('*/api/me/requests/outgoing', () => (fail
    ? HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'Requests could not be loaded.' } }, { status: 503 })
    : HttpResponse.json([]))));
  const user = userEvent.setup();
  renderRequests();
  expect(await screen.findByRole('alert')).toHaveTextContent('Requests could not be loaded.');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('There is no observer list for your sign-up yet.')).toBeVisible();
});

// ---------- Choosing and sending ----------

test('selects every open candidate at first and counts individual and select-all changes', async () => {
  current.candidates = [candidate(observer), candidate(second), candidate(third)];
  const user = userEvent.setup();
  renderRequests();
  expect(await screen.findByText('3 of 3 selected')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Select all' })).toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: 'Dr. Jon Kim' }));
  expect(screen.getByText('2 of 3 selected')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveProperty('indeterminate', true);
  expect(sendButton()).toHaveTextContent('Send request to 2 selected');

  await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByText('3 of 3 selected')).toBeVisible();
  await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByText('0 of 3 selected')).toBeVisible();
  expect(sendButton()).toBeDisabled();
  expect(screen.getByText('Select at least one observer to send a request.')).toBeVisible();
});

test('never sends with nothing selected, because an empty list means every candidate to the API', async () => {
  current.candidates = [candidate(observer), candidate(second)];
  let posts = 0;
  server.use(http.post('*/api/signups/:signupId/requests', () => { posts += 1; return HttpResponse.json([], { status: 201 }); }));
  const user = userEvent.setup();
  renderRequests();
  await user.click(await screen.findByRole('checkbox', { name: 'Select all' }));
  await user.click(sendButton());
  expect(posts).toBe(0);
});

test('sends exactly the selected observers once, shows progress, then the refreshed requests', async () => {
  current.candidates = [candidate(observer), candidate(second), candidate(third)];
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const bodies: unknown[] = [];
  server.use(http.post('*/api/signups/:signupId/requests', async ({ request: req, params }) => {
    expect(params.signupId).toBe(signup.signupId);
    bodies.push(await req.json());
    await held;
    current.outgoing = [request(observer, 'pending'), request(third, 'pending')];
    current.candidates = [candidate(observer, { status: 'pending', sentDate: '2026-09-16T15:00:00Z' }), candidate(second), candidate(third, { status: 'pending', sentDate: '2026-09-16T15:00:00Z' })];
    return HttpResponse.json(current.outgoing, { status: 201 });
  }));
  const user = userEvent.setup();
  renderRequests();
  await user.click(await screen.findByRole('checkbox', { name: 'Dr. Jon Kim' }));
  await user.click(sendButton());

  const sending = await screen.findByRole('button', { name: /Sending 2 requests…/ });
  expect(sending).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await user.click(sending);
  expect(bodies).toEqual([{ observerNetids: ['er123', 'ap123'] }]);

  release();
  expect(await screen.findByText(/Request sent .* to 2 colleagues for CS 1337.002/)).toBeVisible();
  const table = within(screen.getByRole('table', { name: 'My requests' }));
  expect(table.getAllByText('Waiting')).toHaveLength(2);
  expect(bodies).toHaveLength(1);
});

test('a fast double-click sends one request', async () => {
  current.candidates = [candidate(observer), candidate(second)];
  let posts = 0;
  server.use(http.post('*/api/signups/:signupId/requests', () => {
    posts += 1;
    current.outgoing = [request(observer, 'pending'), request(second, 'pending')];
    return HttpResponse.json(current.outgoing, { status: 201 });
  }));
  renderRequests();
  await screen.findByText('2 of 2 selected');
  // Both clicks land before the mutation's pending state reaches React, as a real double-click does.
  const button = sendButton();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(await screen.findByText(/Request sent/)).toBeVisible();
  expect(posts).toBe(1);
});

test('keeps the selection after a failed send and lets the professor retry', async () => {
  current.candidates = [candidate(observer), candidate(second)];
  let attempts = 0;
  const bodies: unknown[] = [];
  server.use(http.post('*/api/signups/:signupId/requests', async ({ request: req }) => {
    attempts += 1;
    bodies.push(await req.json());
    if (attempts === 1) return HttpResponse.json({ error: { code: 'TEMPORARY_FAILURE', message: 'Requests were not sent. Try again.' } }, { status: 503 });
    current.outgoing = [request(second, 'pending')];
    return HttpResponse.json(current.outgoing, { status: 201 });
  }));
  const user = userEvent.setup();
  renderRequests();
  await user.click(await screen.findByRole('checkbox', { name: 'Dr. Elena Ruiz' }));
  await user.click(sendButton());

  expect(await screen.findByRole('alert')).toHaveTextContent('Requests were not sent. Try again.');
  expect(screen.getByRole('checkbox', { name: 'Dr. Elena Ruiz' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Dr. Jon Kim' })).toBeChecked();
  expect(sendButton()).toBeEnabled();

  await user.click(sendButton());
  expect(await screen.findByText(/to 1 colleague for/)).toBeVisible();
  expect(bodies).toEqual([{ observerNetids: ['jk123'] }, { observerNetids: ['jk123'] }]);
});

test('drops an observer who left the refreshed list from the selection and the payload', async () => {
  current.candidates = [candidate(observer), candidate(second), candidate(third)];
  const bodies: unknown[] = [];
  server.use(http.post('*/api/signups/:signupId/requests', async ({ request: req }) => {
    bodies.push(await req.json());
    return HttpResponse.json([], { status: 201 });
  }));
  const user = userEvent.setup();
  const { queryClient } = renderRequests();
  expect(await screen.findByText('3 of 3 selected')).toBeVisible();

  current.candidates = [candidate(observer), candidate(third)];
  await act(() => queryClient.invalidateQueries());
  expect(await screen.findByText('2 of 2 selected')).toBeVisible();
  expect(screen.queryByText('Dr. Jon Kim')).toBeNull();

  await user.click(sendButton());
  expect(bodies).toEqual([{ observerNetids: ['er123', 'ap123'] }]);
});

test('only fresh candidates can be selected after previous requests end', async () => {
  current.candidates = [candidate(observer, { status: 'expired', sentDate: '2026-09-10T15:00:00Z' }), candidate(second), candidate(third, { status: 'declined', sentDate: '2026-09-10T15:00:00Z' })];
  renderRequests();
  expect(await screen.findByText('1 of 1 selected')).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: 'Dr. Elena Ruiz' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Dr. Ana Park' })).toBeNull();
});

// ---------- Request states ----------

test('shows waiting, declined and expired requests with their times', async () => {
  current.candidates = [candidate(observer), candidate(second), candidate(third)];
  current.outgoing = [
    request(observer, 'pending'),
    request(second, 'declined', { respondedDate: '2026-09-16T18:00:00Z' }),
    request(third, 'expired'),
  ];
  renderRequests();
  const table = within(await screen.findByRole('table', { name: 'My requests' }));
  expect(screen.getByText('1 waiting, 1 expired, 1 declined')).toBeVisible();
  expect(table.getByText('Waiting')).toBeVisible();
  expect(table.getByText('Expires in 31 hours')).toBeVisible();
  expect(table.getByText('Declined')).toBeVisible();
  expect(table.getByText('Expired')).toBeVisible();
});

test('says nobody accepted within 48 hours only when every request expired', async () => {
  current.candidates = [candidate(observer, { status: 'expired', sentDate: '2026-09-14T15:00:00Z' })];
  current.outgoing = [request(observer, 'expired')];
  renderRequests();
  expect(await screen.findByText('Nobody accepted your requests within 48 hours.')).toBeVisible();
  expect(screen.queryByText(/went back to matching/)).toBeNull();
  expect(screen.queryByText(/In-app notification/)).toBeNull();
});

test('describes declined requests without blaming the 48-hour limit', async () => {
  current.candidates = [candidate(observer, { status: 'declined', sentDate: '2026-09-16T15:00:00Z' }), candidate(second, { status: 'expired', sentDate: '2026-09-16T15:00:00Z' })];
  current.outgoing = [request(observer, 'declined', { respondedDate: '2026-09-16T18:00:00Z' }), request(second, 'expired')];
  renderRequests();
  expect(await screen.findByText('None of your requests were accepted.')).toBeVisible();
});

test('shows the matched observer with the other requests cancelled', async () => {
  current.signup = matchedSignup;
  current.outgoing = [
    request(second, 'cancelled'),
    request(observer, 'accepted', { respondedDate: '2026-09-16T20:00:00Z' }),
  ];
  renderRequests();
  expect(await screen.findByText('Dr. Elena Ruiz accepted first and is your observer.')).toBeVisible();
  const table = within(screen.getByRole('table', { name: 'My requests' }));
  expect(table.getByText('Accepted first')).toBeVisible();
  expect(table.getByText('Cancelled by the system')).toBeVisible();
  expect(screen.getByRole('link', { name: 'View my evaluation' })).toHaveAttribute('href', '/faculty/evaluation');
});

test('an accepted request without the observation yet stays on "sent", not "nobody accepted"', async () => {
  current.outgoing = [request(observer, 'accepted', { respondedDate: '2026-09-16T20:00:00Z' }), request(second, 'cancelled')];
  current.candidates = [candidate(observer, { status: 'accepted', sentDate: '2026-09-16T15:00:00Z' }), candidate(second, { status: 'cancelled', sentDate: '2026-09-16T15:00:00Z' })];
  renderRequests();
  expect(await screen.findByText(/Request sent/)).toBeVisible();
  expect(screen.queryByText(/None of your requests/)).toBeNull();
});

// ---------- Refresh ----------

test('picks up an answer given elsewhere on the next poll', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  current.candidates = [candidate(observer, { status: 'pending', sentDate: '2026-09-16T15:00:00Z' })];
  current.outgoing = [request(observer, 'pending')];
  renderRequests();
  expect(await screen.findByText('Expires in 31 hours')).toBeVisible();

  current.signup = matchedSignup;
  current.outgoing = [request(observer, 'accepted', { respondedDate: '2026-09-17T08:10:00Z' })];
  await nextPoll();
  expect(await screen.findByText('Dr. Elena Ruiz accepted first and is your observer.')).toBeVisible();
});

test('shows a new observer list on the next poll while waiting', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderRequests();
  expect(await screen.findByText('There is no observer list for your sign-up yet.')).toBeVisible();
  current.candidates = [candidate(observer)];
  await nextPoll();
  expect(await screen.findByText('1 of 1 selected')).toBeVisible();
});

test('stops polling once matched and while the professor is choosing', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  current.signup = matchedSignup;
  current.outgoing = [request(observer, 'accepted', { respondedDate: '2026-09-16T20:00:00Z' })];
  const { unmount } = renderRequests();
  expect(await screen.findByText(/accepted first and is your observer/)).toBeVisible();
  const before = { ...calls };
  await nextPoll();
  await nextPoll();
  expect(calls).toEqual(before);
  unmount();

  current = { signup, candidates: [candidate(observer)], outgoing: [] };
  renderRequests();
  expect(await screen.findByText('1 of 1 selected')).toBeVisible();
  const choosing = { ...calls };
  await nextPoll();
  expect(calls).toEqual(choosing);
});

test('keeps the last data on screen when a poll fails, with a way to retry', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  current.candidates = [candidate(observer, { status: 'pending', sentDate: '2026-09-16T15:00:00Z' })];
  current.outgoing = [request(observer, 'pending')];
  renderRequests();
  expect(await screen.findByText('Expires in 31 hours')).toBeVisible();

  server.use(http.get('*/api/me/requests/outgoing', () => HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'Requests could not be loaded.' } }, { status: 503 })));
  await nextPoll();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh this page: Requests could not be loaded.');
  expect(screen.getByText('Expires in 31 hours')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});
