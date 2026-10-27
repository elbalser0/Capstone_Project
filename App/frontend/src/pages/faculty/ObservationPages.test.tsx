import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { course, cycle, faculty, observation, observer } from '../../test/fixtures';
import type { Me, ObservationDetail, ObservationRequest, PersonRef } from '../../api/types';
import { ObservationFormPage, SignPage } from './ObservationFormPage';
import { ObservationRecordPage } from './ObservationRecordPage';
import { ObserveRequestsPage } from './ObservePage';

const me = (p: PersonRef): Me => ({
  ...p, email: `${p.firstName.toLowerCase()}@demo.edu`, department: { deptId: '1', deptName: 'Computer Science' }, role: 'faculty',
});

const request: ObservationRequest = {
  signupId: '20', observer, observee: faculty, section: course,
  // Future class dates: dates already past cannot be picked.
  proposedDates: [{ date: '2030-09-23', startTime: '08:30' }, { date: '2030-09-30', startTime: '08:30' }],
  status: 'pending', sentDate: '2026-09-17T12:00:00.000Z', respondedDate: null, expiresAt: '2026-09-19T12:00:00.000Z',
};

const detail: ObservationDetail = {
  ...observation,
  templateVersion: { versionId: '1', versionNo: 1 },
  answers: [{
    questionId: '7', title: 'Content knowledge', wording: 'Accurate, current command of the subject',
    ratingMin: 1, ratingMax: 5, minLabel: 'Poor', maxLabel: 'Excellent', isRequired: true, rating: null, comment: '',
  }],
  otherComments: '',
  lastSavedDate: '2026-09-22T10:00:00.000Z',
  reasonNotCompleted: null,
};

const draftKey = `assessment-helper.observation-draft.${detail.observationId}`;
afterEach(() => localStorage.clear());

function serveMe(person: PersonRef) {
  server.use(http.get('*/api/me', () => HttpResponse.json(me(person))));
}

describe('Observe page (GET /api/me/requests/incoming)', () => {
  function open(incoming: ObservationRequest[] = [request]) {
    serveMe(observer);
    server.use(
      http.get('*/api/me/requests/incoming', () => HttpResponse.json(incoming)),
      http.get('*/api/me/assignments', () => HttpResponse.json([])),
      http.get('*/api/cycles/current', () => HttpResponse.json(cycle)),
    );
    return renderRoutes([{ path: '/faculty/observe', element: <ObserveRequestsPage /> }], '/faculty/observe');
  }

  it('accepts with the picked proposed date', async () => {
    let sent: { url: string; body: unknown } | undefined;
    server.use(http.patch('*/api/signups/:signupId/requests/:observerNetId/confirm', async ({ request: req }) => {
      sent = { url: new URL(req.url).pathname, body: await req.json() };
      return HttpResponse.json({ ...request, status: 'accepted' });
    }));
    open();
    const accept = await screen.findByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Mon Sep 30/));
    await userEvent.click(accept);
    await expect.poll(() => sent).toEqual({ url: '/api/signups/20/requests/er123/confirm', body: { date: '2030-09-30' } });
  });

  it('does not offer a proposed date that has already passed', async () => {
    open([{ ...request, proposedDates: [{ date: '2020-09-21', startTime: '08:30' }, ...request.proposedDates] }]);
    expect(await screen.findByLabelText(/Mon Sep 21, 2020|Mon Sep 21/)).toBeDisabled();
    expect(screen.getByLabelText(/Mon Sep 23/)).toBeEnabled();
  });

  it('declines the request', async () => {
    let path: string | undefined;
    server.use(http.patch('*/api/signups/:signupId/requests/:observerNetId/decline', ({ request: req }) => {
      path = new URL(req.url).pathname;
      return HttpResponse.json({ ...request, status: 'declined' });
    }));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await expect.poll(() => path).toBe('/api/signups/20/requests/er123/decline');
  });

  it('shows the backend reason when accepting is refused', async () => {
    server.use(http.patch('*/api/signups/:signupId/requests/:observerNetId/confirm', () =>
      HttpResponse.json({ error: { code: 'SCHEDULE_CONFLICT', message: 'You teach 3354.501 from 19:00 to 21:45 at that time.' } }, { status: 409 })));
    open();
    await userEvent.click(await screen.findByLabelText(/Mon Sep 23/));
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You teach 3354.501 from 19:00 to 21:45 at that time.');
  });
});

describe('Observation form and signing (POST /api/observations/{id}/signed-form)', () => {
  function open(path: string, data: ObservationDetail = detail) {
    serveMe(observer);
    server.use(http.get('*/api/observations/:observationId', () => HttpResponse.json(data)));
    return renderRoutes([
      { path: '/faculty/observe/:observationId/form', element: <ObservationFormPage /> },
      { path: '/faculty/observe/:observationId/sign', element: <SignPage /> },
      { path: '/faculty/observe/:observationId', element: <p>Record page</p> },
    ], path);
  }

  it('uses the rating scale sent with each question', async () => {
    open('/faculty/observe/30/form');
    expect(await screen.findByRole('radiogroup', { name: 'Content knowledge' })).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByText('1 Poor')).toBeVisible();
  });

  it('sends the saved ratings when the observer signs with their full name', async () => {
    localStorage.setItem(draftKey, JSON.stringify({ answers: { 7: { rating: 4, comment: 'Clear examples' } }, otherComments: 'Good session', savedAt: 1 }));
    let body: unknown;
    server.use(http.post('*/api/observations/:observationId/signed-form', async ({ request: req }) => {
      body = await req.json();
      return HttpResponse.json({ ...detail, observerSignedDate: '2026-09-22' });
    }));
    open('/faculty/observe/30/sign');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.type(screen.getByLabelText('Type your full name to sign'), 'Elena');
    await userEvent.click(screen.getByRole('button', { name: /Sign as observer/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Type your full name as it appears on your account: Elena Ruiz.');
    expect(body).toBeUndefined();

    await userEvent.type(screen.getByLabelText('Type your full name to sign'), ' Ruiz');
    await userEvent.click(screen.getByRole('button', { name: /Sign as observer/ }));
    await expect.poll(() => body).toEqual({ answers: [{ questionId: '7', rating: 4, comment: 'Clear examples' }], otherComments: 'Good session' });
    await expect.poll(() => localStorage.getItem(draftKey)).toBeNull();
  });

  it('sends a rating of 0 when the scale starts at 0', async () => {
    const zeroScale: ObservationDetail = { ...detail, answers: [{ ...detail.answers[0], ratingMin: 0, ratingMax: 4 }] };
    localStorage.setItem(draftKey, JSON.stringify({ answers: { 7: { rating: 0, comment: '' } }, otherComments: '', savedAt: 1 }));
    let body: unknown;
    server.use(http.post('*/api/observations/:observationId/signed-form', async ({ request: req }) => {
      body = await req.json();
      return HttpResponse.json({ ...zeroScale, observerSignedDate: '2026-09-22' });
    }));
    open('/faculty/observe/30/sign', zeroScale);
    expect(await screen.findByText('0 of 4')).toBeVisible();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.type(screen.getByLabelText('Type your full name to sign'), 'Elena Ruiz');
    await userEvent.click(screen.getByRole('button', { name: /Sign as observer/ }));
    await expect.poll(() => body).toEqual({ answers: [{ questionId: '7', rating: 0, comment: '' }], otherComments: '' });
  });

  it('does not offer to sign again when the signed form was not changed', async () => {
    const signed: ObservationDetail = { ...detail, answers: [{ ...detail.answers[0], rating: 5, comment: 'Good' }], observerSignedDate: '2026-09-22' };
    open('/faculty/observe/30/form', signed);
    await userEvent.click(await screen.findByRole('button', { name: 'Go to signatures' }));
    expect(await screen.findByText('Signed Sep 22')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sign as observer/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('shows the signed ratings, not a leftover draft, once the record is locked', async () => {
    localStorage.setItem(draftKey, JSON.stringify({ answers: { 7: { rating: 2, comment: 'Unsent edit' } }, otherComments: '', savedAt: 1 }));
    open('/faculty/observe/30/sign', {
      ...detail, answers: [{ ...detail.answers[0], rating: 5, comment: 'Good' }], status: 'completed',
      observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23',
    });
    expect(await screen.findByText('5 of 5')).toBeVisible();
    expect(screen.queryByText('2 of 5')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign as observer/ })).not.toBeInTheDocument();
  });

  it('sends a locked record to the read-only page', async () => {
    open('/faculty/observe/30/form', { ...detail, status: 'completed', observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23' });
    expect(await screen.findByText('Record page')).toBeVisible();
  });
});

describe('Observation record (POST /api/observations/{id}/sign)', () => {
  const ready: ObservationDetail = { ...detail, answers: [{ ...detail.answers[0], rating: 5, comment: 'Good' }], observerSignedDate: '2026-09-22' };

  function open(person: PersonRef, getDetail: () => ObservationDetail = () => ready) {
    serveMe(person);
    let reads = 0;
    server.use(http.get('*/api/observations/:observationId', () => {
      reads += 1;
      return HttpResponse.json(getDetail());
    }));
    renderRoutes([{ path: '/faculty/observations/:observationId', element: <ObservationRecordPage /> }], '/faculty/observations/30');
    return { reads: () => reads };
  }

  it('lets the observee sign the version they read', async () => {
    let body: unknown;
    server.use(http.post('*/api/observations/:observationId/sign', async ({ request: req }) => {
      body = await req.json();
      return HttpResponse.json({ ...ready, status: 'completed', observeeSignedDate: '2026-09-23' });
    }));
    open(faculty);
    expect(await screen.findByText('Waiting for your signature')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Sign/ }));
    await expect.poll(() => body).toEqual({ lastSavedDate: '2026-09-22T10:00:00.000Z' });
    expect(await screen.findByText('Signed and locked')).toBeVisible();
  });

  it('reloads the record when the observer changed it after it was opened', async () => {
    server.use(http.post('*/api/observations/:observationId/sign', () => HttpResponse.json(
      { error: { code: 'STALE_FORM', message: 'The observer changed the form after you opened it. Reload it and review it before signing.' } },
      { status: 409 },
    )));
    const page = open(faculty);
    await userEvent.click(await screen.findByRole('button', { name: /Sign/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The observer changed the form after you opened it.');
    await expect.poll(page.reads).toBe(2);
  });

  it('gives the observer no sign button, since submitting the form was their signature', async () => {
    open(observer);
    expect(await screen.findByText('Waiting for the observee to sign')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sign/ })).not.toBeInTheDocument();
  });
});
