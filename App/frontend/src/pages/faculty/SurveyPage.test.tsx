import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { SurveyPage } from './SurveyPage';

const cycle = { cycleId: '4', term: { label: 'Fall 2026' }, phase: 'feedback', surveyOpensDate: '2026-10-01', feedbackDeadline: '2026-11-10' };
const route = () => renderRoutes([{ path: '/faculty/survey', element: <SurveyPage /> }], '/faculty/survey');
function current(value: typeof cycle | null = cycle) { server.use(http.get('*/api/cycles/current', () => HttpResponse.json(value))); }
async function fillSurvey() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'observer' }));
  await user.click(screen.getByRole('radio', { name: 'no' }));
  await user.type(screen.getByRole('textbox', { name: /Difficulties/ }), 'Scheduling was hard');
  return user;
}

it('gates submission on the current feedback phase', async () => {
  current({ ...cycle, phase: 'closed' }); route();
  expect(await screen.findByText(/survey is not open/i)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit survey' })).not.toBeInTheDocument();
});
it('submits explicitly selected role and negative answer once as multipart, disabling while pending', async () => {
  current();
  let resolve!: (value: Response) => void;
  const received = vi.fn();
  server.use(http.post('*/api/cycles/4/survey-responses', async ({ request }) => {
    received(Object.fromEntries((await request.formData()).entries()));
    return new Promise<Response>((done) => { resolve = done; });
  }));
  route(); const user = await fillSurvey();
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  await waitFor(() => expect(received).toHaveBeenCalledTimes(1));
  expect(received.mock.calls[0][0]).toMatchObject({ respondentRole: 'observer', processOk: 'false', difficulties: 'Scheduling was hard' });
  expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'observee' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: /Difficulties/ })).toBeDisabled();
  resolve(HttpResponse.json({ responseId: '42' }, { status: 201 }));
  expect(await screen.findByText('Your observer response was submitted.')).toBeVisible();
  expect(screen.getByRole('radio', { name: /observer/i })).toBeDisabled();
  expect(received).toHaveBeenCalledTimes(1);
});
it('shows no cycle without presenting a form', async () => {
  current(null); route();
  expect(await screen.findByText('No current cycle is available.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit survey' })).not.toBeInTheDocument();
});
it('recovers from a cycle-load error without calling it an empty result', async () => {
  let attempts = 0;
  server.use(http.get('*/api/cycles/current', () => ++attempts === 1
    ? HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'Cycle unavailable' } }, { status: 503 })
    : HttpResponse.json(cycle)));
  route();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cycle unavailable');
  expect(screen.queryByText('No current cycle is available.')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'End-of-process survey' })).toBeVisible();
});
it.each([
  ['SURVEY_CLOSED', 409, 'closed'],
  ['NOT_A_PARTICIPANT', 403, 'cannot submit as observer'],
  ['ALREADY_SUBMITTED', 409, 'Already submitted for observer'],
])('preserves draft and explains %s backend failure', async (code, status, text) => {
  current(); server.use(http.post('*/api/cycles/4/survey-responses', () => HttpResponse.json({ error: { code, message: 'Server detail' } }, { status })));
  route(); const user = await fillSurvey();
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.getByRole('textbox', { name: /Difficulties/ })).toHaveValue('Scheduling was hard');
  expect(screen.getByRole('radio', { name: 'observer' })).toBeChecked();
});
it('rejects oversized files before sending and permits retry with a valid attachment', async () => {
  current(); const received = vi.fn();
  server.use(http.post('*/api/cycles/4/survey-responses', async ({ request }) => { received(await request.text()); return HttpResponse.json({ responseId: '1' }, { status: 201 }); }));
  route(); const user = await fillSurvey();
  await user.upload(screen.getByLabelText(/Trouble file/), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.txt'));
  expect(screen.getByRole('alert')).toHaveTextContent('10 MiB');
  expect(screen.getByRole('button', { name: 'Submit survey' })).toBeDisabled();
  await user.upload(screen.getByLabelText(/Trouble file/), new File(['details'], 'details.txt'));
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  await screen.findByText('Your observer response was submitted.');
  // MSW's jsdom File bridge serializes the filename as "blob"; native-browser QA checks the filename.
  expect(received.mock.calls[0][0]).toContain('details');
  expect(received.mock.calls[0][0]).toContain('name="troubleFile"');
});
