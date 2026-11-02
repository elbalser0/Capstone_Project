import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { faculty, observation, observer } from '../../test/fixtures';
import type { ObservationDetail } from '../../api/types';
import { ObservationFormPage } from './ObservationFormPage';
import { ObservationSignPage } from './ObservationSignPage';
import { clearDraft, draftKey } from './observationDraft';
import { endSignedFormSubmission } from './signedFormSubmission';

const detail: ObservationDetail = {
  ...observation,
  templateVersion: { versionId: 'historical', versionNo: 2 },
  lastSavedDate: '2026-09-22T10:00:00Z',
  otherComments: '',
  reasonNotCompleted: null,
  answers: [
    { questionId: 'q1', title: 'Clarity', wording: 'Was it clear?', ratingMin: 0, ratingMax: 2, minLabel: 'Low', maxLabel: 'High', isRequired: true, rating: null, comment: '' },
    { questionId: 'q2', title: 'Engagement', wording: 'Were students involved?', ratingMin: 1, ratingMax: 3, minLabel: null, maxLabel: null, isRequired: false, rating: null, comment: '' },
  ],
};
const path = '/faculty/observe/30/form';
const fullName = `${observer.firstName} ${observer.lastName}`;

function serve(netid = observer.netid, record = detail, onSubmit: (body: unknown) => void = () => {}, role = 'faculty') {
  server.use(
    http.get('*/api/me', () => HttpResponse.json({ ...observer, netid, email: 'test@example.edu', role, department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/observations/30', () => HttpResponse.json(record)),
    http.post('*/api/observations/30/signed-form', async ({ request }) => {
      onSubmit(await request.json());
      return HttpResponse.json({ ...record, observerSignedDate: '2026-09-23' });
    }),
  );
}

function open(start = path) {
  return renderRoutes([
    { path: '/faculty/observe/:observationId/form', element: <ObservationFormPage /> },
    { path: '/faculty/observe/:observationId/sign', element: <ObservationSignPage /> },
  ], start);
}
afterEach(() => {
  clearDraft(observer.netid, '30');
  endSignedFormSubmission('30');
});

it('keeps the zero rating in review and submits the exact form only after confirmation', async () => {
  const onSubmit = (body: unknown) => expect(body).toEqual({
    answers: [{ questionId: 'q1', rating: 0, comment: 'Clear examples' }],
    otherComments: 'Strong pacing',
  });
  serve(observer.netid, detail, onSubmit);
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole('radio', { name: '0' }));
  await user.type(screen.getByRole('textbox', { name: 'Comment on Clarity' }), 'Clear examples');
  await user.type(screen.getByRole('textbox', { name: /other comments/i }), 'Strong pacing');
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  expect(await screen.findByRole('heading', { name: 'Observer signature' })).toBeVisible();
  expect(screen.getByText('0 of 2')).toBeVisible();
  expect(screen.getByText('Clear examples')).toBeVisible();
  expect(screen.getByRole('button', { name: /sign as observer/i })).toBeDisabled();
  expect(screen.queryByText(/submitted successfully/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByText(/submitted successfully/i)).toBeVisible();
});

it('warns and requires acknowledgement when the server record supersedes a local draft', async () => {
  localStorage.setItem(draftKey(observer.netid, '30'), JSON.stringify({
    versionId: 'historical', lastSavedDate: '2026-09-20T10:00:00Z',
    answers: { q1: { rating: 2, comment: 'Unsubmitted local edit' }, q2: { rating: null, comment: '' } },
    otherComments: 'Unsubmitted local comment',
  }));
  const saved = { ...detail, answers: [{ ...detail.answers[0], rating: 1, comment: 'Saved server answer' }] };
  let submitted: unknown;
  serve(observer.netid, saved, body => { submitted = body; });
  const user = userEvent.setup();
  open('/faculty/observe/30/sign');
  expect(await screen.findByRole('alert')).toHaveTextContent(/server record has changed since this draft was saved/i);
  expect(screen.getByText('Saved server answer')).toBeVisible();
  expect(screen.queryByText('Unsubmitted local edit')).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  const signButton = screen.getByRole('button', { name: /sign as observer/i });
  expect(signButton).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /understand that local draft changes are not included/i }));
  expect(signButton).toBeEnabled();
  await user.click(signButton);
  expect(await screen.findByText(/submitted successfully/i)).toBeVisible();
  expect(submitted).toEqual({
    answers: [{ questionId: 'q1', rating: 1, comment: 'Saved server answer' }],
    otherComments: '',
  });
});

it('keeps required-answer validation at submission, not draft save', async () => {
  let submissions = 0;
  serve(observer.netid, detail, () => { submissions += 1; });
  const user = userEvent.setup();
  open();
  await screen.findByRole('button', { name: /save draft on this device/i });
  await user.click(screen.getByRole('button', { name: /save draft on this device/i }));
  expect(screen.getByText(/Draft saved on this device only/)).toBeVisible();
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  expect(screen.getByRole('button', { name: /sign as observer/i })).toBeDisabled();
  expect(submissions).toBe(0);
});

it('rejects a mismatched typed name without sending a mutation', async () => {
  let submissions = 0;
  serve(observer.netid, detail, () => { submissions += 1; });
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '2' }));
  await user.click(await screen.findByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), 'Someone Else');
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/type your full name as it appears/i);
  expect(submissions).toBe(0);
});

it('reports the server date restriction and keeps the draft available', async () => {
  serve();
  server.use(http.post('*/api/observations/30/signed-form', () => HttpResponse.json({ error: { code: 'NOT_YET_OBSERVED', message: 'The form can be filled in on or after the observation date.' } }, { status: 409 })));
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '2' }));
  await user.click(screen.getByRole('button', { name: /save draft on this device/i }));
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/on or after the observation date/i);
  expect(localStorage.getItem(draftKey(observer.netid, '30'))).not.toBeNull();
});

it('keeps in-memory edits when localStorage is blocked while moving to review and back', async () => {
  clearDraft(observer.netid, '30');
  serve();
  const user = userEvent.setup();
  const view = open();
  await user.type(await screen.findByRole('textbox', { name: 'Comment on Clarity' }), 'Kept in memory');
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('Blocked'); };
  try {
    await user.click(screen.getByRole('button', { name: /save draft on this device/i }));
    await user.click(screen.getByRole('link', { name: /go to signatures/i }));
    expect(await screen.findByText('Kept in memory')).toBeVisible();
    await user.click(screen.getByRole('link', { name: /back to the form/i }));
    expect(await screen.findByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('Kept in memory');
  } finally {
    Storage.prototype.setItem = original;
    view.unmount();
    clearDraft(observer.netid, '30');
  }
});

it('does not resubmit unchanged signed form content', async () => {
  clearDraft(observer.netid, '30');
  let submissions = 0;
  const saved = { ...detail, observerSignedDate: '2026-09-22', answers: [
    { ...detail.answers[0], rating: 0, comment: 'Saved comment' },
    detail.answers[1],
  ] };
  serve(observer.netid, saved, () => { submissions += 1; });
  open('/faculty/observe/30/sign');
  expect(await screen.findByText(/already been submitted/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: /sign as observer/i })).not.toBeInTheDocument();
  expect(submissions).toBe(0);
});

it('allows a changed observer form to be reviewed and resubmitted before the observee signs', async () => {
  clearDraft(observer.netid, '30');
  const saved = { ...detail, observerSignedDate: '2026-09-22', answers: [
    { ...detail.answers[0], rating: 1, comment: 'Original' },
    detail.answers[1],
  ] };
  let submitted: unknown;
  serve(observer.netid, saved, (body) => { submitted = body; });
  localStorage.setItem(draftKey(observer.netid, '30'), JSON.stringify({
    versionId: 'historical', lastSavedDate: detail.lastSavedDate,
    answers: { q1: { rating: 0, comment: 'Revised' }, q2: { rating: null, comment: '' } }, otherComments: '',
  }));
  const user = userEvent.setup();
  open('/faculty/observe/30/sign');
  expect(await screen.findByText(/updates your earlier submission/i)).toBeVisible();
  await user.click(screen.getByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  await screen.findByText(/submitted successfully/i);
  expect(submitted).toEqual({ answers: [{ questionId: 'q1', rating: 0, comment: 'Revised' }], otherComments: '' });
});

it('warns that an optional answer comment needs a rating to be included in submission', async () => {
  let submitted: unknown;
  serve(observer.netid, detail, (body) => { submitted = body; });
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '2' }));
  await user.type(screen.getByRole('textbox', { name: 'Comment on Engagement' }), 'Students asked questions');
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  expect(await screen.findByText('This comment will not be submitted unless you select a rating for Engagement.')).toBeVisible();
  expect(screen.getByText('Students asked questions')).toBeVisible();
  await user.click(screen.getByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  await screen.findByText(/submitted successfully/i);
  expect(submitted).toEqual({ answers: [{ questionId: 'q1', rating: 2, comment: '' }], otherComments: '' });
});

it('ignores a second click while the observer submission is pending', async () => {
  clearDraft(observer.netid, '30');
  let submissions = 0;
  serve(observer.netid, detail, () => { submissions += 1; });
  server.use(http.post('*/api/observations/30/signed-form', async () => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return HttpResponse.json({ ...detail, observerSignedDate: '2026-09-23' });
  }));
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '0' }));
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.dblClick(screen.getByRole('button', { name: /sign as observer/i }));
  expect(screen.getByRole('status')).toHaveTextContent('Submitting your signed observation');
  expect(screen.getByRole('button', { name: /sign as observer/i })).toBeDisabled();
  await waitFor(() => expect(submissions).toBe(1));
});

it('blocks a duplicate submission after navigating away and returning while one is pending', async () => {
  clearDraft(observer.netid, '30');
  let submissions = 0;
  let finishSubmission = () => {};
  serve();
  server.use(http.post('*/api/observations/30/signed-form', () => {
    submissions += 1;
    return new Promise((resolve) => { finishSubmission = () => resolve(HttpResponse.json({
      ...detail, answers: [{ ...detail.answers[0], rating: 2, comment: '' }], observerSignedDate: '2026-09-23',
    })); });
  }));
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '2' }));
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByText(/submitting your signed observation/i)).toBeVisible();
  await user.click(screen.getByRole('link', { name: /back to the form/i }));
  await user.click(await screen.findByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/already in progress/i);
  expect(submissions).toBe(1);
  finishSubmission();
  expect(await screen.findByText(/already been submitted/i)).toBeVisible();
});

it('shows a server permission rejection after observer submission', async () => {
  serve();
  server.use(http.post('*/api/observations/30/signed-form', () => HttpResponse.json({
    error: { code: 'FORBIDDEN', message: 'Only the assigned observer can submit this form.' },
  }, { status: 403 })));
  const user = userEvent.setup();
  open();
  await user.click(within(await screen.findByRole('radiogroup', { name: 'Clarity' })).getByRole('radio', { name: '2' }));
  await user.click(screen.getByRole('link', { name: /go to signatures/i }));
  await user.click(await screen.findByRole('checkbox', { name: /confirm this observation took place/i }));
  await user.type(screen.getByRole('textbox', { name: /type your full name to sign/i }), fullName);
  await user.click(screen.getByRole('button', { name: /sign as observer/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/only the assigned observer can submit/i);
});

it('does not let the observee use the observer submission route', async () => {
  clearDraft(observer.netid, '30');
  serve(faculty.netid);
  open('/faculty/observe/30/sign');
  expect(await screen.findByRole('alert')).toHaveTextContent(/only the assigned observer/i);
  expect(screen.queryByRole('button', { name: /sign as observer/i })).not.toBeInTheDocument();
});

it('does not let a read-only AC viewer use the observer submission route', async () => {
  serve('ac-reader', detail, () => {}, 'AC');
  open('/faculty/observe/30/sign');
  expect(await screen.findByRole('alert')).toHaveTextContent(/only the assigned observer/i);
  expect(screen.queryByRole('button', { name: /sign as observer/i })).not.toBeInTheDocument();
});

it('blocks a record that is already signed by both participants', async () => {
  serve(observer.netid, { ...detail, observerSignedDate: '2026-09-22', observeeSignedDate: '2026-09-23', status: 'completed' });
  open('/faculty/observe/30/sign');
  expect(await screen.findByRole('alert')).toHaveTextContent(/locked or did not happen/i);
  expect(screen.queryByRole('button', { name: /sign as observer/i })).not.toBeInTheDocument();
});

it('blocks signing when the observation did not happen', async () => {
  clearDraft(observer.netid, '30');
  serve(observer.netid, { ...detail, status: 'not_completed' });
  open('/faculty/observe/30/sign');
  expect(await screen.findByRole('alert')).toHaveTextContent(/locked or did not happen/i);
  expect(screen.queryByRole('button', { name: /sign as observer/i })).not.toBeInTheDocument();
});
