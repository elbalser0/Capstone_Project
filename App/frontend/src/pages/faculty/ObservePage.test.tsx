import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { createMemoryRouter, matchRoutes, Navigate, RouterProvider, type RouteObject } from 'react-router';
import { expect, it } from 'vitest';
import { router } from '../../App';
import type { Cycle, ObservationRequest, ObservationSummary } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { cycle, course, faculty, observation, observer } from '../../test/fixtures';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { ConfirmationsPage, ObserveRequestsPage } from './ObservePage';

const request: ObservationRequest = {
  signupId: '20', observer, observee: faculty, section: course,
  proposedDates: [{ date: '2026-09-21', startTime: '08:30' }, { date: '2026-09-23', startTime: '10:00' }],
  status: 'pending', sentDate: '2026-09-08T12:00:00Z', respondedDate: null, expiresAt: '2026-09-10T12:00:00Z',
};

function setup({ incoming = [request], assignments = [], activeCycle = cycle }: { incoming?: ObservationRequest[]; assignments?: ObservationSummary[]; activeCycle?: Cycle | null } = {}) {
  server.use(
    http.get('/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', role: 'faculty', department: { deptId: '1', deptName: 'Computer Science' } })),
    http.get('/api/cycles/current', () => HttpResponse.json(activeCycle)),
    http.get('/api/me/requests/incoming', () => HttpResponse.json(incoming)),
    http.get('/api/me/assignments', () => HttpResponse.json(assignments)),
  );
}

function shell(path: string, element: ReactNode) {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:maya.lin@demo.edu' }));
  return renderRoutes([{
    element: <AuthProvider mode="demo"><AppShell /></AuthProvider>,
    children: [{ path, element, handle: { title: 'Test page' } }],
  }], path);
}

function renderWithQueryRetry(routes: RouteObject[], path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: 0 }, mutations: { retry: false } },
  });
  const memoryRouter = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<QueryClientProvider client={queryClient}><RouterProvider router={memoryRouter} /></QueryClientProvider>);
}

it('shows pending requests and every proposed time, and omits non-pending requests', async () => {
  setup({ incoming: [request, { ...request, signupId: '21', status: 'declined' }] });
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  expect(await screen.findByText('New requests (1)')).toBeVisible();
  expect(screen.getByText('Dr. Maya Lin')).toBeVisible();
  expect(screen.getByText('CS 1337.002 Computer Science I')).toBeVisible();
  expect(screen.getByText('Mon Sep 21, 8:30 AM')).toBeVisible();
  expect(screen.getByText('Wed Sep 23, 10:00 AM')).toBeVisible();
  expect(screen.queryByText('No new requests.')).not.toBeInTheDocument();
});

it('shows the empty request state and semester count', async () => {
  setup({ incoming: [] });
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  expect(await screen.findByText('No new requests.')).toBeVisible();
  expect(screen.getByText('You have accepted 0 of 3 observations this semester')).toBeVisible();
});

it('accepts only after selecting a proposed time and sends the exact request once', async () => {
  setup();
  let calls = 0;
  let body: unknown;
  let releaseResponse = () => {};
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  server.use(http.patch('/api/signups/20/requests/er123/confirm', async ({ request: httpRequest }) => {
    calls += 1;
    body = await httpRequest.json();
    await responseReady;
    return HttpResponse.json({ ...request, status: 'accepted' });
  }));
  const user = userEvent.setup();
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  const accept = await screen.findByRole('button', { name: 'Accept' });
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: 'Mon Sep 21, 8:30 AM' }));
  expect(accept).toBeEnabled();
  await user.dblClick(accept);
  const pending = await screen.findByRole('button', { name: 'Accepting…' });
  expect(pending).toBeDisabled();
  expect(calls).toBe(1);
  releaseResponse();
  await waitFor(() => expect(calls).toBe(1));
  expect(body).toEqual({ date: '2026-09-21' });
});

it('keeps the chosen date and shows an accept error from the server', async () => {
  setup();
  server.use(http.patch('/api/signups/20/requests/er123/confirm', () => HttpResponse.json({ error: { code: 'INVALID_DATE', message: 'Pick one of the proposed dates.' } }, { status: 400 })));
  const user = userEvent.setup();
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  const date = await screen.findByRole('radio', { name: 'Mon Sep 21, 8:30 AM' });
  await user.click(date);
  await user.click(screen.getByRole('button', { name: 'Accept' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pick one of the proposed dates.');
  expect(date).toBeChecked();
});

it('keeps the chosen date and shows a conflict error from the server', async () => {
  setup();
  server.use(http.patch('/api/signups/20/requests/er123/confirm', () => HttpResponse.json({ error: { code: 'ALREADY_PAIRED', message: 'Another observer accepted first.' } }, { status: 409 })));
  const user = userEvent.setup();
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  const date = await screen.findByRole('radio', { name: 'Mon Sep 21, 8:30 AM' });
  await user.click(date);
  await user.click(screen.getByRole('button', { name: 'Accept' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Another observer accepted first.');
  expect(date).toBeChecked();
});

it('declines with a bodyless PATCH and stays pending until the request completes', async () => {
  setup();
  let body = 'not-read';
  let calls = 0;
  let releaseResponse = () => {};
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  server.use(http.patch('/api/signups/20/requests/er123/decline', async ({ request: httpRequest }) => {
    calls += 1;
    body = await httpRequest.text();
    await responseReady;
    return HttpResponse.json({ ...request, status: 'declined' });
  }));
  const user = userEvent.setup();
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  await user.dblClick(await screen.findByRole('button', { name: 'Decline' }));
  const pending = await screen.findByRole('button', { name: 'Declining…' });
  expect(pending).toBeDisabled();
  expect(calls).toBe(1);
  releaseResponse();
  await screen.findByRole('button', { name: 'Declined' });
  expect(body).toBe('');
});

it('disables acceptance when three observations are already accepted this semester', async () => {
  const assignments = Array.from({ length: 3 }, (_, index) => ({ ...observation, observationId: String(index + 1), term: cycle.term }));
  setup({ incoming: [request, { ...request, signupId: '21' }], assignments });
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  await screen.findByText('You have accepted 3 of 3 observations this semester');
  expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(2);
  screen.getAllByRole('button', { name: 'Accept' }).forEach((button) => expect(button).toBeDisabled());
});

it('shows Try again when the incoming-request read fails', async () => {
  server.use(
    http.get('/api/me', () => HttpResponse.json({ ...faculty, department: { deptId: '1', deptName: 'Computer Science' } })),
    http.get('/api/cycles/current', () => HttpResponse.json(cycle)),
    http.get('/api/me/requests/incoming', () => HttpResponse.json({ error: { code: 'FAILED', message: 'Requests unavailable' } }, { status: 500 })),
    http.get('/api/me/assignments', () => HttpResponse.json([])),
  );
  renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  expect(await screen.findByRole('alert')).toHaveTextContent('Requests unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('shows accepted confirmations with form or record links and lists cancelled requests', async () => {
  const accepted = [
    { ...observation, observationId: '30', term: cycle.term },
    { ...observation, observationId: '31', term: cycle.term, status: 'completed' as const, observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23' },
    { ...observation, observationId: '32', term: cycle.term, status: 'not_completed' as const },
  ];
  setup({ assignments: accepted, incoming: [{ ...request, status: 'cancelled' }] });
  renderRoutes([{ path: '/faculty/observe/confirmations', element: <ConfirmationsPage /> }], '/faculty/observe/confirmations');
  expect(await screen.findByRole('link', { name: 'Open form' })).toHaveAttribute('href', '/faculty/observe/30/form');
  expect(screen.getAllByRole('link', { name: 'View' })).toHaveLength(2);
  expect(screen.getByText('Cancelled: another colleague accepted first')).toBeVisible();
});

it('shows the confirmations empty state', async () => {
  setup({ incoming: [], assignments: [] });
  renderRoutes([{ path: '/faculty/observe/confirmations', element: <ConfirmationsPage /> }], '/faculty/observe/confirmations');
  expect(await screen.findByText('No confirmations yet this semester.')).toBeVisible();
});

it('shows a confirmations read error and recovers after Try again', async () => {
  setup({ incoming: [], assignments: [] });
  let calls = 0;
  server.use(http.get('/api/me/requests/incoming', () => {
    calls += 1;
    return calls < 3
      ? HttpResponse.json({ error: { code: 'FAILED', message: 'Confirmations unavailable' } }, { status: 500 })
      : HttpResponse.json([]);
  }));
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'maya.lin@demo.edu', token: 'demo:maya.lin@demo.edu' }));
  const user = userEvent.setup();
  const path = '/faculty/observe/confirmations';
  renderWithQueryRetry([{ path, element: <AuthProvider mode="demo"><ConfirmationsPage /></AuthProvider> }], path);
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirmations unavailable');
  expect(calls).toBe(2);
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No confirmations yet this semester.')).toBeVisible();
  expect(calls).toBe(3);
});

it('keeps past accepted records visible when there is no current cycle', async () => {
  const past = {
    ...observation,
    observationId: '40',
    term: { ...cycle.term, termId: 'past-term', label: 'Spring 2026' },
    status: 'completed' as const,
    observerSignedDate: '2026-03-20',
    observeeSignedDate: '2026-03-21',
  };
  setup({ activeCycle: null, assignments: [past], incoming: [] });
  renderRoutes([{ path: '/faculty/observe/confirmations', element: <ConfirmationsPage /> }], '/faculty/observe/confirmations');
  expect(await screen.findByRole('link', { name: 'View' })).toHaveAttribute('href', '/faculty/observe/40');
  expect(screen.getByText('0 of 3')).toBeVisible();
  expect(screen.queryByText('No confirmations yet this semester.')).not.toBeInTheDocument();
});

it('shows the Survey opening date as non-link text until the feedback phase', async () => {
  setup({ incoming: [] });
  shell('/faculty/evaluation', <p>Evaluation</p>);
  const opens = await screen.findByText('Opens Sep 22');
  const survey = opens.closest('[aria-disabled="true"]');
  expect(survey).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Survey/ })).not.toBeInTheDocument();
});

it('links to Survey when the feedback phase begins', async () => {
  setup({ incoming: [], activeCycle: { ...cycle, phase: 'feedback' } });
  shell('/faculty/evaluation', <p>Evaluation</p>);
  expect(await screen.findByRole('link', { name: 'Survey' })).toHaveAttribute('href', '/faculty/survey');
});

it('keeps Survey disabled when there is no current cycle', async () => {
  setup({ incoming: [], activeCycle: null });
  shell('/faculty/evaluation', <p>Evaluation</p>);
  const survey = await screen.findByText('Survey');
  expect(survey.closest('[aria-disabled="true"]')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Survey/ })).not.toBeInTheDocument();
});

it('shows the pending request badge in the Observe navigation item', async () => {
  setup();
  shell('/faculty/evaluation', <p>Evaluation</p>);
  const badge = await screen.findByLabelText('1 new requests');
  expect(badge.closest('a')).toHaveAttribute('href', '/faculty/observe');
});

it('does not fetch faculty incoming requests in committee mode', async () => {
  setup({ incoming: [] });
  server.use(http.get('/api/me', () => HttpResponse.json({ ...faculty, email: 'maya.lin@demo.edu', role: 'AC', department: { deptId: '1', deptName: 'Computer Science' } })));
  const rendered = shell('/committee/dashboard', <p>Committee page</p>);
  expect(await screen.findByText('Committee page')).toBeVisible();
  expect(rendered.queryClient.getQueryState(['me', 'requests', 'incoming'])).toBeUndefined();
});

it('redirects legacy assignment links to My confirmations', () => {
  const matched = matchRoutes(router.routes, '/faculty/assignments');
  expect(matched?.at(-1)?.route.element).toEqual(<Navigate to="/faculty/observe/confirmations" replace />);
});

it('tells a pending observer only that a request taken by someone else is cancelled', async () => {
  setup();
  shell('/faculty/observe', <ObserveRequestsPage />);
  expect(await screen.findByText('If someone accepts before you, this request is cancelled. It does not count toward your 3.')).toBeVisible();
});

it('does not mention email or notifications on Observe', async () => {
  setup();
  shell('/faculty/observe', <ObserveRequestsPage />);
  const main = await screen.findByRole('main');
  await within(main).findByText('The first colleague to accept is paired automatically.');
  expect(main).not.toHaveTextContent(/e-?mail/i);
  expect(main).not.toHaveTextContent(/notif/i);
});

it('does not mention email or notifications on My confirmations', async () => {
  setup({ incoming: [] });
  shell('/faculty/observe/confirmations', <ConfirmationsPage />);
  const main = await screen.findByRole('main');
  await within(main).findByText('No confirmations yet this semester.');
  expect(main).not.toHaveTextContent(/e-?mail/i);
  expect(main).not.toHaveTextContent(/notif/i);
});
