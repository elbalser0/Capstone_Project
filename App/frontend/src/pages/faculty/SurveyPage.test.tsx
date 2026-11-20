import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderRoutes } from '../../test/render';
import { server } from '../../test/setup';
import { observation } from '../../test/fixtures';
import { SurveyPage } from './SurveyPage';

const cycle = { cycleId: '4', term: { label: 'Fall 2026' }, phase: 'feedback', surveyOpensDate: '2026-10-01', feedbackDeadline: '2026-11-10' };
const route = () => renderRoutes([{ path: '/faculty/survey', element: <SurveyPage /> }], '/faculty/survey');
const both = { cycleId: '4', open: true, opensDate: '2026-10-01', closesDate: '2026-11-10', eligibleRoles: ['observee', 'observer'], submittedRoles: [] as string[] };
function mySurvey(value: Partial<typeof both> = {}) { server.use(http.get('*/api/me/survey', () => HttpResponse.json({ ...both, ...value }))); }
/** The current cycle, and by default a professor who took part in both roles and has submitted nothing yet. */
function current(value: typeof cycle | null = cycle) { server.use(http.get('*/api/cycles/current', () => HttpResponse.json(value))); mySurvey(); }
async function fillSurvey() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'observer' }));
  await user.click(screen.getByRole('radio', { name: 'no' }));
  await user.type(screen.getByRole('textbox', { name: /Difficulties/ }), 'Scheduling was hard');
  return user;
}

it('gates submission on the current feedback phase', async () => {
  current({ ...cycle, phase: 'closed' }); route();
  expect(await screen.findByText('The survey closed on Nov 10, 2026.')).toBeVisible();
  expect(screen.queryByText(/survey is not open/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Submit survey' })).not.toBeInTheDocument();
});
it('says the survey is not open yet before the window starts', async () => {
  current({ ...cycle, phase: 'observation' }); route();
  expect(await screen.findByText(/The survey is not open\. It is available from/)).toBeVisible();
  expect(screen.queryByText(/survey closed on/i)).not.toBeInTheDocument();
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
  mySurvey(); route();
  expect(await screen.findByRole('alert')).toHaveTextContent('Cycle unavailable');
  expect(screen.queryByText('No current cycle is available.')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'End-of-process survey' })).toBeVisible();
});
it.each([
  ['SURVEY_CLOSED', 409, 'closed'],
  ['NOT_A_PARTICIPANT', 403, 'cannot submit as observer'],
])('preserves draft and explains %s backend failure', async (code, status, text) => {
  current(); server.use(http.post('*/api/cycles/4/survey-responses', () => HttpResponse.json({ error: { code, message: 'Server detail' } }, { status })));
  route(); const user = await fillSurvey();
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.getByRole('textbox', { name: /Difficulties/ })).toHaveValue('Scheduling was hard');
  expect(screen.getByRole('radio', { name: 'observer' })).toBeChecked();
});
it('treats ALREADY_SUBMITTED as submitted for that role', async () => {
  current(); server.use(http.post('*/api/cycles/4/survey-responses', () => HttpResponse.json({ error: { code: 'ALREADY_SUBMITTED', message: 'Server detail' } }, { status: 409 })));
  route(); const user = await fillSurvey();
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  expect(await screen.findByText('You already submitted the survey as observer.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /observer \(submitted\)/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'observee' })).toBeEnabled();
});
it('clears the already-submitted message when the next submit fails differently', async () => {
  current();
  let calls = 0;
  server.use(http.post('*/api/cycles/4/survey-responses', () => (++calls === 1
    ? HttpResponse.json({ error: { code: 'ALREADY_SUBMITTED', message: 'Server detail' } }, { status: 409 })
    : HttpResponse.json({ error: { code: 'FAILED', message: 'Server down' } }, { status: 500 }))));
  route(); const user = await fillSurvey();
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  expect(await screen.findByText('You already submitted the survey as observer.')).toBeVisible();
  await user.click(screen.getByRole('radio', { name: 'observee' }));
  await user.click(screen.getByRole('radio', { name: 'no' }));
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
  expect(screen.queryByText('You already submitted the survey as observer.')).not.toBeInTheDocument();
});
it('rejects oversized files before sending and permits retry with a valid attachment', async () => {
  current(); const received = vi.fn();
  server.use(http.post('*/api/cycles/4/survey-responses', async ({ request }) => { received(await request.text()); return HttpResponse.json({ responseId: '1' }, { status: 201 }); }));
  route(); const user = await fillSurvey();
  await user.upload(screen.getByLabelText(/Trouble file/), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.txt'));
  expect(screen.getByRole('alert')).toHaveTextContent('10 MiB');
  expect(screen.getByRole('button', { name: 'Submit survey' })).toBeDisabled();
  // Node 24's fetch drops the contents of a jsdom File when it encodes the body, so the file itself is checked where the app adds it.
  const append = vi.spyOn(FormData.prototype, 'append');
  const details = new File(['details'], 'details.txt');
  await user.upload(screen.getByLabelText(/Trouble file/), details);
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  await screen.findByText('Your observer response was submitted.');
  expect(received).toHaveBeenCalledTimes(1);
  expect(append.mock.calls.filter(([name]) => name === 'troubleFile').map(([, value]) => value)).toEqual([details]);
  append.mockRestore();
  expect(received.mock.calls[0][0]).toContain('name="troubleFile"');
});

it('asks the server which roles were already submitted, so a reload keeps them marked', async () => {
  current(); const asked = vi.fn();
  server.use(http.get('*/api/me/survey', ({ request }) => { asked(new URL(request.url).searchParams.get('cycleId')); return HttpResponse.json({ ...both, submittedRoles: ['observer'] }); }));
  route();
  expect(await screen.findByRole('radio', { name: 'observer (submitted)' })).toBeDisabled();
  expect(asked).toHaveBeenCalledWith('4');
  // Only observee is left, so it is picked already.
  expect(screen.getByRole('radio', { name: 'observee' })).toBeChecked();
});
it('offers only the roles the server accepts', async () => {
  current(); mySurvey({ eligibleRoles: ['observee'] });
  route();
  expect(await screen.findByRole('radio', { name: 'observee' })).toBeChecked();
  expect(screen.queryByRole('radio', { name: /observer/ })).not.toBeInTheDocument();
  expect(screen.getByText('One response as observee.')).toBeVisible();
});
it('says thank you instead of showing the form once every role is in', async () => {
  current(); mySurvey({ submittedRoles: ['observee', 'observer'] });
  route();
  expect(await screen.findByText('You have submitted the survey for both of your roles. Thank you.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit survey' })).not.toBeInTheDocument();
});
it('says there is no survey for someone who took part in neither role', async () => {
  current(); mySurvey({ eligibleRoles: [] });
  route();
  expect(await screen.findByText(/You were not an observee or an observer in this cycle/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Submit survey' })).not.toBeInTheDocument();
});
it('falls back to both roles with a note when the status read fails', async () => {
  current(); server.use(http.get('*/api/me/survey', () => HttpResponse.json({ error: { code: 'UNAVAILABLE', message: 'Status down' } }, { status: 503 })));
  route();
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check which roles you already submitted");
  expect(screen.getByRole('radio', { name: 'observer' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: 'observee' })).toBeEnabled();
});

const timing = 'The survey opens after the observation deadline. It does not wait for signatures.';
it('shows the intro, numbered questions, the closing date and the timing note while the survey is open', async () => {
  current({ ...cycle, term: { label: 'Fall 2026', termId: '1' } } as typeof cycle); route();
  expect(await screen.findByText('Tell the Assessment Committee how the Fall 2026 process went.')).toBeVisible();
  expect(screen.getByText(timing)).toBeVisible();
  expect(screen.getByText('Survey closes')).toBeVisible();
  expect(screen.getByText('Nov 10, 2026', { selector: 'p' })).toBeVisible();
  expect(await screen.findByText(/^1\. /)).toBeVisible();
  expect(screen.getByText(/^2\. Difficulties/)).toBeVisible();
  expect(screen.getByText(/^3\. Additional feedback/)).toBeVisible();
});
it('shows the intro and the timing note while the survey is closed', async () => {
  current({ ...cycle, phase: 'closed' }); route();
  expect(await screen.findByText('Tell the Assessment Committee how the Fall 2026 process went.')).toBeVisible();
  expect(screen.getByText(timing)).toBeVisible();
  expect(screen.getByText('Survey closes')).toBeVisible();
});
it('shows the professor\'s own observation for this term in the summary card', async () => {
  current({ ...cycle, term: { label: 'Fall 2026', termId: '1' } } as typeof cycle);
  server.use(http.get('*/api/me/observations', () => HttpResponse.json([observation])));
  route();
  expect(await screen.findByText('Your observation')).toBeVisible();
  expect(screen.getByText('CS 1337.002, Mon Sep 21, 8:30 AM')).toBeVisible();
  expect(screen.getByText('Observer: Dr. Elena Ruiz')).toBeVisible();
  expect(screen.getByText('Record not fully signed')).toBeVisible();
});
it('leaves the observation card out when the observation belongs to another term or cannot be read', async () => {
  current({ ...cycle, term: { label: 'Fall 2026', termId: '9' } } as typeof cycle);
  server.use(http.get('*/api/me/observations', () => HttpResponse.json([observation])));
  route();
  expect(await screen.findByText('Survey closes')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('Your observation')).not.toBeInTheDocument());
});
it('submits the same multipart fields as before the layout change', async () => {
  current(); let keys: string[] = [];
  server.use(http.post('*/api/cycles/4/survey-responses', async ({ request }) => { keys = [...(await request.formData()).keys()]; return HttpResponse.json({ responseId: '1' }, { status: 201 }); }));
  route(); const user = await fillSurvey();
  await user.type(screen.getByRole('textbox', { name: /Additional feedback/ }), 'More time');
  await user.click(screen.getByRole('button', { name: 'Submit survey' }));
  await screen.findByText('Your observer response was submitted.');
  expect(keys).toEqual(['respondentRole', 'processOk', 'difficulties', 'additionalFeedback']);
});
