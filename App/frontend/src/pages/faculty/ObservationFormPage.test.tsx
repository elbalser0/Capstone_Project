import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { faculty, observer, observation } from '../../test/fixtures';
import { ObservationFormPage } from './ObservationFormPage';
import { draftKey } from './observationDraft';

const detail = { ...observation, templateVersion: { versionId: 'historical', versionNo: 2 }, lastSavedDate: '2026-09-22T10:00:00Z', otherComments: '', reasonNotCompleted: null,
  answers: [{ questionId: 'q1', title: 'Clarity', wording: 'Was it clear?', ratingMin: 0, ratingMax: 2, minLabel: 'Low', maxLabel: 'High', isRequired: true, rating: null, comment: '' },
    { questionId: 'q2', title: 'Engagement', wording: 'Were students involved?', ratingMin: 1, ratingMax: 3, minLabel: null, maxLabel: null, isRequired: false, rating: 1, comment: '' }] };
const path = '/faculty/observe/30/form';
function serve(netid = observer.netid, record = detail) {
  server.use(http.get('*/api/me', () => HttpResponse.json({ ...observer, netid, email: 'test@example.edu', role: 'faculty', department: { deptId: '1', deptName: 'CS' } })),
    http.get('*/api/observations/30', () => HttpResponse.json(record)));
}
function open() { return renderRoutes([{ path: '/faculty/observe/:observationId/form', element: <ObservationFormPage /> }], path); }
it('uses assigned-version questions, zero scale and required markers, saving a local draft without submitting', async () => {
  serve(); open(); const user = userEvent.setup();
  expect(await screen.findByText(/Observation Template v2/)).toBeVisible();
  expect(screen.getByRole('radiogroup', { name: /Clarity/ })).toBeVisible();
  expect(screen.getByText('0 Low')).toBeVisible();
  expect(screen.getByText('2 High')).toBeVisible();
  await user.click(screen.getByRole('radio', { name: '0' }));
  await user.type(screen.getByRole('textbox', { name: 'Comment on Clarity' }), 'Well explained');
  await user.click(screen.getByRole('button', { name: 'Save draft on this device' }));
  expect(screen.getByText(/Draft saved on this device only/)).toBeVisible();
  expect(screen.getByRole('radio', { name: '0' })).toBeChecked();
  expect(localStorage.getItem('assessment-helper.observation-draft.v1.er123.30')).toContain('Well explained');
  localStorage.removeItem(draftKey(observer.netid, '30'));
});
it('saves an incomplete draft before required ratings are filled in', async () => {
  const key = draftKey(observer.netid, '30');
  serve(); const view = open(); const user = userEvent.setup();
  await screen.findByText(/Observation Template v2/);
  await user.type(screen.getByRole('textbox', { name: 'Comment on Clarity' }), 'Still observing');
  await user.click(screen.getByRole('button', { name: 'Save draft on this device' }));
  expect(screen.getByText('Draft saved on this device only. Not submitted or signed.')).toBeVisible();
  view.unmount();
  open();
  expect(await screen.findByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('Still observing');
  expect(screen.getByRole('radio', { name: '0' })).not.toBeChecked();
  localStorage.removeItem(key);
});
it('restores a saved zero rating and comment on route reload', async () => {
  const key = draftKey(observer.netid, '30');
  localStorage.setItem(key, JSON.stringify({ versionId: 'historical', lastSavedDate: detail.lastSavedDate, answers: { q1: { rating: 0, comment: 'Stored' }, q2: { rating: 1, comment: '' } }, otherComments: 'Local only' }));
  serve(); open();
  expect(await screen.findByRole('radio', { name: '0' })).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('Stored');
  expect(screen.getByRole('textbox', { name: /other comments/i })).toHaveValue('Local only');
  localStorage.removeItem(key);
});
it('does not replace a newer server revision with an older local draft', async () => {
  const key = draftKey(observer.netid, '30');
  localStorage.setItem(key, JSON.stringify({ versionId: 'historical', lastSavedDate: '2026-09-21T10:00:00Z', answers: { q1: { rating: 0, comment: 'Old local answer' }, q2: { rating: 1, comment: '' } }, otherComments: '' }));
  serve(); open();
  expect(await screen.findByText(/server record has changed/i)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('');
  expect(localStorage.getItem(key)).toContain('Old local answer');
  localStorage.removeItem(key);
});
it('does not offer editing to the observee', async () => {
  serve(faculty.netid); open();
  expect(await screen.findByText(/Only the assigned observer/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Save draft/ })).not.toBeInTheDocument();
});
it('rejects corrupt storage and retains edits if writes are blocked', async () => {
  const key = draftKey(observer.netid, '30');
  localStorage.setItem(key, '{bad');
  serve(); open(); const user = userEvent.setup();
  expect(await screen.findByText(/saved draft could not be read/)).toBeVisible();
  await user.click(screen.getByRole('radio', { name: '0' }));
  await user.type(screen.getByRole('textbox', { name: 'Comment on Clarity' }), 'Unsaved');
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('Blocked'); };
  try {
    await user.click(screen.getByRole('button', { name: 'Save draft on this device' }));
    expect(screen.getByText(/Draft could not be saved/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('Unsaved');
  } finally { Storage.prototype.setItem = original; localStorage.removeItem(key); }
});
it('does not restore another account draft', async () => {
  const key = draftKey('someone-else', '30');
  localStorage.setItem(key, JSON.stringify({ versionId: 'historical', answers: {}, otherComments: 'private note' }));
  serve(); open();
  expect(await screen.findByText(/Observation Template v2/)).toBeVisible();
  expect(screen.queryByDisplayValue('private note')).not.toBeInTheDocument();
  localStorage.removeItem(key);
});
it('blocks editing when both signatures lock the record', async () => {
  serve(observer.netid, { ...detail, observeeSignedDate: '2026-09-22', observerSignedDate: '2026-09-22' }); open();
  expect(await screen.findByText(/locked or did not happen/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Save draft/ })).not.toBeInTheDocument();
});
it('does not restore a draft from a different observation', async () => {
  const key = draftKey(observer.netid, '31');
  localStorage.setItem(key, JSON.stringify({ versionId: 'historical', lastSavedDate: detail.lastSavedDate, answers: { q1: { rating: 0, comment: 'Different observation' }, q2: { rating: 1, comment: '' } }, otherComments: '' }));
  serve(); open();
  expect(await screen.findByRole('textbox', { name: 'Comment on Clarity' })).toHaveValue('');
  localStorage.removeItem(key);
});
it('explains when the assigned form has no questions', async () => {
  serve(observer.netid, { ...detail, answers: [] }); open();
  expect(await screen.findByText('No questions are available for this observation.')).toBeVisible();
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
});
it('reports a missing assigned template without a fallback scale', async () => {
  serve(observer.netid, { ...detail, templateVersion: null } as unknown as typeof detail); open();
  expect(await screen.findByText(/assigned observation form is unavailable/)).toBeVisible();
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
});
it('reports failed observation load instead of a blank editor', async () => {
  serve();
  server.use(http.get('*/api/observations/30', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Record not found' } }, { status: 404 })));
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Record not found');
});
it('follows the R3 layout with context, banner, helper text, endpoint labels, placeholders and hint', async () => {
  serve(); open();
  expect(await screen.findByRole('heading', { level: 2, name: 'Observation: Dr. Maya Lin, CS 1337.002, Mon Sep 21, 8:30 AM' })).toBeVisible();
  expect(screen.getByText('This is your copy of Observation Template v2. Questions and rating ranges are set by the Assessment Committee.')).toBeVisible();
  expect(screen.getByText('Was it clear?')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Clarity (required)' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Engagement' })).toBeVisible();
  expect(screen.getAllByText(/^\d+ (Low|High)$/)).toHaveLength(2);
  expect(screen.getAllByPlaceholderText('Add a comment')).toHaveLength(2);
  expect(screen.getByText('Always the last item on every form')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save draft on this device' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /sign|submit/i })).not.toBeInTheDocument();
});
it('shows the save time only after a local save', async () => {
  const key = draftKey(observer.netid, '30');
  serve(); open(); const user = userEvent.setup();
  await screen.findByText(/Observation Template v2/);
  expect(screen.queryByText(/^Draft saved \d/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save draft on this device' }));
  expect(screen.getByText(/^Draft saved \d{1,2}:\d{2} [AP]M$/)).toBeVisible();
  localStorage.removeItem(key);
});
