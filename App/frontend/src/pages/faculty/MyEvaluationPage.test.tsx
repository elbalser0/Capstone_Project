import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { evaluationStatus, observation, observer, signup } from '../../test/fixtures';
import type { EvaluationStatus, ObservationSummary, Signup } from '../../api/types';
import { MyEvaluationPage } from './MyEvaluationPage';

function serve({ status = evaluationStatus, observations = [observation], currentSignup = signup }: {
  status?: EvaluationStatus; observations?: ObservationSummary[]; currentSignup?: Signup | null;
} = {}) {
  server.use(
    http.get('*/api/me/evaluation-status', () => HttpResponse.json(status)),
    http.get('*/api/me/observations', ({ request }) => {
      expect(new URL(request.url).searchParams.get('as')).toBe('observee');
      return HttpResponse.json(observations);
    }),
    http.get('*/api/me/signup', () => HttpResponse.json(currentSignup)),
  );
}

function openPage() {
  return renderRoutes([{ path: '/faculty/evaluation', element: <MyEvaluationPage /> }], '/faculty/evaluation');
}

describe('My evaluation page', () => {
  it.each([
    ['DUE', 'You are DUE this semester: Fall 2026'],
    ['OVERDUE', 'You are OVERDUE: your observation was due Fall 2026'],
    ['NOT_DUE', 'Your next observation is due Fall 2026'],
  ] as const)('shows the %s evaluation headline', async (dueStatus, heading) => {
    serve({ status: { ...evaluationStatus, status: dueStatus, canSignUp: false }, observations: [], currentSignup: null });
    openPage();
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
  });

  it('shows empty history only after observations load for a faculty member with no current sign-up', async () => {
    serve({ status: { ...evaluationStatus, status: 'NOT_DUE', canSignUp: false }, observations: [], currentSignup: null });
    openPage();
    expect(await screen.findByText('No observations yet.')).toBeVisible();
    expect(screen.queryByText('Not scheduled yet')).not.toBeInTheDocument();
  });

  it('waits for signup before declaring history empty for a not-due faculty member', async () => {
    serve({ status: { ...evaluationStatus, status: 'NOT_DUE', canSignUp: false }, observations: [] });
    server.use(http.get('*/api/me/signup', async () => new Promise<never>(() => {})));
    openPage();
    expect(await screen.findByRole('table', { name: 'My observations' })).toBeVisible();
    expect(screen.queryByText('No observations yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Loading sign-up…')).toBeVisible();
  });

  it('shows an explicit loading state while evaluation status is pending', async () => {
    server.use(http.get('*/api/me/evaluation-status', async () => new Promise<never>(() => {})));
    openPage();
    expect(screen.getByText('Loading evaluation status…')).toBeInTheDocument();
  });

  it('shows an evaluation-status API error instead of a blank page', async () => {
    server.use(http.get('*/api/me/evaluation-status', () => HttpResponse.json({ error: { code: 'DOWN', message: 'Status unavailable' } }, { status: 503 })));
    openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Status unavailable');
    expect(screen.queryByText('My observations')).not.toBeInTheDocument();
  });

  it('shows failed observation and signup requests rather than an empty history', async () => {
    serve();
    server.use(
      http.get('*/api/me/observations', () => HttpResponse.json({ error: { code: 'DOWN', message: 'History unavailable' } }, { status: 503 })),
      http.get('*/api/me/signup', () => HttpResponse.json({ error: { code: 'DOWN', message: 'Signup unavailable' } }, { status: 503 })),
    );
    openPage();
    expect(await screen.findByText('History unavailable')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Signup unavailable')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('No observations yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Not signed up yet')).not.toBeInTheDocument();
  });

  it('keeps known observation rows when signup lookup fails', async () => {
    serve({ observations: [observation] });
    server.use(http.get('*/api/me/signup', () => HttpResponse.json({ error: { code: 'DOWN', message: 'Signup unavailable' } }, { status: 503 })));
    openPage();
    expect(await screen.findByText('Dr. Elena Ruiz')).toBeInTheDocument();
    expect(await screen.findByText('Signup unavailable')).toHaveAttribute('role', 'alert');
  });

  it('shows the current-cycle placeholder before signup', async () => {
    serve({ observations: [], currentSignup: null });
    openPage();
    expect(await screen.findByText('Not signed up yet')).toBeInTheDocument();
    expect(screen.getByText('Not chosen yet')).toBeInTheDocument();
    expect(screen.getByText('Not scheduled yet')).toBeInTheDocument();
    expect(screen.queryByText('No observations yet.')).not.toBeInTheDocument();
  });

  it('does not call a pending signup absence a missing signup', async () => {
    serve({ observations: [] });
    server.use(http.get('*/api/me/signup', async () => new Promise<never>(() => {})));
    openPage();
    expect(await screen.findByText('You are DUE this semester: Fall 2026')).toBeInTheDocument();
    expect(screen.getByText('Loading sign-up…')).toBeInTheDocument();
    expect(screen.queryByText('Not signed up yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Not chosen yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Not scheduled yet')).not.toBeInTheDocument();
  });

  it('shows current-cycle signup even when not due, ignoring another cycle', async () => {
    serve({ status: { ...evaluationStatus, status: 'NOT_DUE', canSignUp: false }, observations: [], currentSignup: signup });
    openPage();
    const row = await screen.findByRole('row', { name: /Fall 2026/ });
    expect(within(row).getByText('CS 1337.002')).toBeInTheDocument();
    expect(within(row).getByText('Not chosen yet')).toBeInTheDocument();
    expect(screen.queryByText('Sign up to be observed')).not.toBeInTheDocument();
  });

  it('does not put a signup from another cycle in the current semester', async () => {
    serve({ observations: [], currentSignup: { ...signup, cycleId: 'previous', section: { ...signup.section, label: 'OLD COURSE' } } });
    openPage();
    const row = await screen.findByRole('row', { name: /Fall 2026/ });
    expect(await within(row).findByText('Not signed up yet')).toBeInTheDocument();
    expect(screen.queryByText('OLD COURSE')).not.toBeInTheDocument();
  });

  it('shows assigned observer and schedule from signup when observation history has not caught up', async () => {
    serve({ observations: [], currentSignup: { ...signup, observation: { observationId: '30', observer: observation.observer, status: 'scheduled', scheduledDate: '2026-09-21' } } });
    openPage();
    expect(await screen.findByText('Dr. Elena Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Sep 21, 2026')).toBeInTheDocument();
    expect(screen.getByText('CS 1337.002')).toBeInTheDocument();
    expect(screen.queryByText('Not chosen yet')).not.toBeInTheDocument();
  });

  it.each([
    ['completed', 'Completed — signature status unavailable'],
    ['not_completed', 'Did not happen'],
  ] as const)('shows signup-only %s without guessing signature state', async (state, label) => {
    serve({ observations: [], currentSignup: { ...signup, observation: { observationId: '30', observer: observation.observer, status: state } } });
    openPage();
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it.each([
    [{ ...observation, status: 'scheduled', observerSignedDate: '2026-09-22' }, 'Waiting for your signature'],
    [{ ...observation, status: 'completed', observeeSignedDate: '2026-09-22' }, 'Waiting for observer signature'],
    [{ ...observation, status: 'completed' }, 'Waiting for signatures'],
    [{ ...observation, status: 'completed', observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-22' }, 'Signed'],
    [{ ...observation, status: 'scheduled', observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-22' }, 'Awaiting completion'],
    [{ ...observation, status: 'not_completed' }, 'Did not happen'],
    [observation, 'Scheduled Sep 21, 2026'],
  ] satisfies [ObservationSummary, string][])('labels observation status %s as %s', async (item, label) => {
    serve({ observations: [item] });
    openPage();
    await screen.findByText(label);
    const row = screen.getByRole('row', { name: /Dr\. Elena Ruiz/ });
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/faculty/observations/30');
  });

  it('links the current semester row to its observation record', async () => {
    serve({ observations: [], currentSignup: { ...signup, observation: { observationId: '31', observer, status: 'scheduled', scheduledDate: '2026-09-21' } } });
    openPage();
    expect(await screen.findByRole('link', { name: 'View' })).toHaveAttribute('href', '/faculty/observations/31');
    expect(screen.getByRole('row', { name: /Fall 2026/ })).toHaveTextContent('Dr. Elena Ruiz');
  });

  it('shows observation history loading explicitly without claiming history is empty', async () => {
    serve({ currentSignup: null });
    server.use(http.get('*/api/me/observations', async () => new Promise<never>(() => {})));
    openPage();
    expect(await screen.findByText('Loading observations…')).toBeInTheDocument();
    expect(screen.queryByText('No observations yet.')).not.toBeInTheDocument();
  });

  it('exposes a scrollable observations table with named cells and keeps history rows', async () => {
    serve({ observations: [observation], currentSignup: null });
    openPage();
    const table = await screen.findByRole('table', { name: 'My observations' });
    expect(table).toHaveClass('overflow-x-auto');
    await within(table).findByText('Dr. Elena Ruiz');
    const row = within(table).getByRole('row', { name: /Dr\. Elena Ruiz/ });
    expect(within(row).getAllByRole('cell')).toHaveLength(5);
    expect(within(row).getByText('Dr. Elena Ruiz')).toBeInTheDocument();
  });
});
