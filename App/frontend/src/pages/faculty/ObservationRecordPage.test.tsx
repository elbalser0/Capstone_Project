import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observation, observer } from '../../test/fixtures';
import type { ObservationDetail } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { ObservationRecordPage } from './ObservationRecordPage';

afterEach(() => vi.restoreAllMocks());

export const detail: ObservationDetail = {
  ...observation, templateVersion: { versionId: 'old', versionNo: 3 }, lastSavedDate: '2026-09-22T10:00:00Z',
  otherComments: 'Good pacing', reasonNotCompleted: null,
  answers: [{ questionId: 'q1', title: 'Clarity', wording: 'Was the explanation clear?', ratingMin: 0, ratingMax: 2, minLabel: 'Needs work', maxLabel: 'Excellent', isRequired: true, rating: 0, comment: 'Clear examples' }],
};
export function serveRecord(record: ObservationDetail = detail, netid = faculty.netid) {
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ ...faculty, netid, email: 'test@example.edu', role: 'faculty', department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/observations/30', () => HttpResponse.json(record)),
  );
}
export function openRecord(path = '/faculty/observe/30') {
  return renderRoutes([{ path: '/faculty/observe/:observationId', element: <ObservationRecordPage /> }], path);
}
it('shows loading until the observation arrives', async () => {
  serveRecord(); openRecord();
  expect(screen.getByRole('status')).toHaveTextContent('Loading observation record');
  expect(await screen.findByText('Clear examples')).toBeVisible();
});
it('reports a record failure without showing saved content', async () => {
  serveRecord();
  server.use(http.get('*/api/observations/30', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Observation not found' } }, { status: 404 })));
  openRecord();
  expect(await screen.findByRole('alert')).toHaveTextContent('Observation not found');
  expect(screen.queryByText('Clear examples')).not.toBeInTheDocument();
});
it('loads the assigned record with its saved zero rating and no signing control', async () => {
  serveRecord(); openRecord();
  expect(await screen.findByText('Clear examples')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Clarity: 0 of 2' })).toBeVisible();
  expect(screen.getByText('Good pacing')).toBeVisible();
  expect(screen.queryByRole('button', { name: /sign/i })).not.toBeInTheDocument();
});
it('keeps line breaks in saved comments', async () => {
  serveRecord({ ...detail, otherComments: 'First\nSecond', answers: [{ ...detail.answers[0], comment: 'Line one\n\nLine three' }] }); openRecord();
  const comment = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Line one\n\nLine three');
  expect(comment).toHaveClass('whitespace-pre-line');
  expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'First\nSecond')).toHaveClass('whitespace-pre-line');
});
it('shows the contextual header, status badge, read-only badge and signatures with dates only', async () => {
  serveRecord({ ...detail, observerSignedDate: '2026-09-22' }); openRecord();
  expect(await screen.findByRole('heading', { level: 2, name: 'CS 1337.002 Computer Science I, Mon Sep 21, 2026, 8:30 AM' })).toBeVisible();
  expect(screen.getByText('Observation Template v3, observer Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('Waiting for your signature')).toBeVisible();
  expect(screen.getByText('Read only')).toBeVisible();
  expect(screen.getByText('Observer: Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('signed Sep 22, 2026')).toBeVisible();
  expect(screen.getByText('Observee: Dr. Maya Lin (you)')).toBeVisible();
  expect(screen.getByText('Not signed yet')).toBeVisible();
  expect(screen.queryByText(/\d{1,2}:\d{2} [AP]M.*signed|signed.*\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
});
it('leaves the time out of the header when the section meets twice that weekday', async () => {
  const twice = { ...course, meetings: [course.meetings[0], { ...course.meetings[0], startTime: '14:00', endTime: '15:15' }] };
  serveRecord({ ...detail, section: twice }); openRecord();
  expect(await screen.findByRole('heading', { level: 2, name: 'CS 1337.002 Computer Science I, Mon Sep 21, 2026' })).toBeVisible();
});
it.each([
  ['the observee', faculty.netid, 'My evaluation'],
  ['the observer', observer.netid, 'My assignments'],
])('highlights the sidebar item that led to the record for %s', async (_who, netid, item) => {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'test@example.edu', token: 'demo:test' }));
  serveRecord({ ...detail, observer }, netid);
  server.use(http.get('*/api/cycles/current', () => HttpResponse.json(cycle)));
  renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
    { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/assignments' } }] }], '/faculty/observe/30');
  await screen.findByText('Read only');
  expect(screen.getByRole('link', { name: item })).toHaveClass('font-bold');
  const other = item === 'My evaluation' ? 'My assignments' : 'My evaluation';
  expect(screen.getByRole('link', { name: other })).not.toHaveClass('font-bold');
  sessionStorage.removeItem('assessment-helper.session');
});
it('highlights no sidebar item for a viewer who is neither participant', async () => {
  sessionStorage.setItem('assessment-helper.session', JSON.stringify({ email: 'test@example.edu', token: 'demo:test' }));
  serveRecord(detail, 'zz999');
  server.use(http.get('*/api/cycles/current', () => HttpResponse.json(cycle)));
  renderRoutes([{ element: <AuthProvider mode="demo"><AppShell /></AuthProvider>, children: [
    { path: '/faculty/observe/:observationId', element: <ObservationRecordPage />, handle: { title: 'Observation record', nav: '/faculty/assignments' } }] }], '/faculty/observe/30');
  await screen.findByText('Read only');
  expect(screen.getByRole('link', { name: 'My assignments' })).not.toHaveClass('font-bold');
  expect(screen.getByRole('link', { name: 'My evaluation' })).not.toHaveClass('font-bold');
  sessionStorage.removeItem('assessment-helper.session');
});

it('lets only the observee sign after observer submission and sends the exact saved revision', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let signBodies: unknown[] = [];
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/sign', async ({ request }) => {
      signBodies.push(await request.json());
      current = { ...current, observeeSignedDate: '2026-09-23', status: 'completed' };
      return HttpResponse.json(current);
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(await screen.findByText(/you signed the observation/i)).toBeVisible();
  expect(signBodies).toEqual([{ lastSavedDate: detail.lastSavedDate }]);
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
});

it('refetches a stale observation and requires a separate observee signing action', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let postCount = 0;
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => HttpResponse.json(current)),
    http.post('*/api/observations/30/sign', () => {
      postCount += 1;
      if (postCount === 1) {
        current = { ...current, lastSavedDate: '2026-09-23T11:00:00Z', answers: [{ ...detail.answers[0], rating: 2, comment: 'Updated by observer' }] };
        return HttpResponse.json({ error: { code: 'STALE_FORM', message: 'The observer changed the form after you opened it. Reload it and review it before signing.' } }, { status: 409 });
      }
      current = { ...current, observeeSignedDate: '2026-09-24', status: 'completed' };
      return HttpResponse.json(current);
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(screen.getByText(/latest record has been reloaded/i)).toBeVisible();
  expect(await screen.findByText('Updated by observer')).toBeVisible();
  const reviewed = screen.getByRole('checkbox', { name: /reviewed the updated responses before signing/i });
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
  await user.click(reviewed);
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
  expect(postCount).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Sign' }));
  expect(await screen.findByText(/you signed the observation/i)).toBeVisible();
  expect(postCount).toBe(2);
});

it('reports a failed stale-record refresh and requires a successful retry before signing', async () => {
  let current: ObservationDetail = { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: null, status: 'scheduled' };
  let reads = 0;
  let posts = 0;
  serveRecord(current, faculty.netid);
  server.use(
    http.get('*/api/observations/30', () => {
      reads += 1;
      if (reads === 2) return HttpResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Could not load the latest observation.' } }, { status: 503 });
      if (reads >= 3) current = { ...current, lastSavedDate: '2026-09-23T11:00:00Z', answers: [{ ...detail.answers[0], rating: 2, comment: 'Latest response' }] };
      return HttpResponse.json(current);
    }),
    http.post('*/api/observations/30/sign', () => {
      posts += 1;
      return HttpResponse.json({ error: { code: 'STALE_FORM', message: 'The form changed after it was opened.' } }, { status: 409 });
    }),
  );
  const user = userEvent.setup();
  openRecord();
  await user.click(await screen.findByRole('button', { name: 'Sign' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not reload the latest record/i);

  expect(screen.queryByText(/latest record has been reloaded/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  expect(posts).toBe(1);
  await user.click(screen.getByRole('button', { name: /retry loading latest record/i }));
  expect(await screen.findByText('Latest response')).toBeVisible();
  expect(screen.getByText(/latest record has been reloaded/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /reviewed the updated responses before signing/i }));
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled();
  expect(posts).toBe(1);
});

it('does not offer observee signing to the observer', async () => {
  serveRecord({ ...detail, observer, observerSignedDate: '2026-09-22' }, observer.netid);
  openRecord();
  await screen.findByText('Read only');
  expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
});
